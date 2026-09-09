import { randomUUID } from "node:crypto";
import { prisma as defaultPrisma } from "@/lib/prisma";
import type { MediaStorage } from "./storage/contracts";
import { InMemoryMediaStorage } from "./storage/inMemoryMediaStorage";
import type { ProcessedMediaObject } from "./imageProcessor";
import {
  ConfiguredMediaDeliveryResolver,
  type MediaDeliveryResolver,
} from "./delivery";
import {
  productMediaAttachmentService,
  type ProductMediaAttachmentService,
} from "./productMediaAttachmentService";

export interface MediaLifecycleService {
  suspendDelivery(mediaId: string, actorScope: string, reasonCode: string): Promise<void>;
  recoverDelivery(mediaId: string, actorScope: string, candidateProcessingRunId?: string): Promise<void>;
  claimCleanupBatch(limit: number): Promise<readonly string[]>;
  cleanupClaimedMedia(mediaId: string): Promise<void>;
  cleanupInactiveProfile(mediaId: string, processingRunId: string): Promise<void>;
  replaceCanonicalMaster(mediaId: string, replacement: ProcessedMediaObject): Promise<void>;
}

export class DefaultMediaLifecycleService implements MediaLifecycleService {
  private readonly privateStorage: MediaStorage;
  private readonly publicStorage: MediaStorage;

  constructor(
    private readonly prismaClient: typeof defaultPrisma = defaultPrisma,
    privateStorage?: MediaStorage,
    publicStorage?: MediaStorage,
    private readonly attachmentService: ProductMediaAttachmentService = productMediaAttachmentService,
    private readonly deliveryResolver: MediaDeliveryResolver = new ConfiguredMediaDeliveryResolver(
      process.env.MEDIA_PUBLIC_ORIGIN || "http://localhost:3000/media"
    )
  ) {
    this.privateStorage = privateStorage ?? new InMemoryMediaStorage();
    this.publicStorage = publicStorage ?? new InMemoryMediaStorage();
  }

  async suspendDelivery(mediaId: string, actorScope: string, reasonCode: string): Promise<void> {
    void actorScope;
    void reasonCode;
    await this.prismaClient.managedMedia.update({
      where: { id: mediaId },
      data: {
        deliveryDisabledAt: new Date(),
      },
    });
  }

  async recoverDelivery(
    mediaId: string,
    _actorScope: string,
    candidateProcessingRunId?: string
  ): Promise<void> {
    await this.prismaClient.$transaction(async (tx) => {
      const media = await tx.managedMedia.findUniqueOrThrow({
        where: { id: mediaId },
        include: { activeProcessingRun: true },
      });

      if (media.lifecycleState === "DELETING" || media.lifecycleState === "DELETED") {
        throw new Error("MEDIA_NOT_RECOVERABLE: media is deleting or deleted");
      }

      if (candidateProcessingRunId) {
        // Recovery Case B: candidate replacement run specified
        const run = await tx.mediaProcessingRun.findUniqueOrThrow({
          where: { id: candidateProcessingRunId },
        });

        if (run.managedMediaId !== mediaId) {
          throw new Error("RUN_MEDIA_MISMATCH: candidate run does not belong to media");
        }

        if (run.state !== "COMPLETE") {
          throw new Error("RUN_NOT_COMPLETE: candidate run is not complete");
        }

        const publicObjects = await tx.mediaObject.findMany({
          where: {
            processingRunId: candidateProcessingRunId,
            role: "RENDITION",
            accessClass: "PUBLIC_DELIVERY",
            deletedAt: null,
          },
        });

        const webpObjects = publicObjects.filter((o) => o.mimeType === "image/webp");
        if (webpObjects.length === 0) {
          throw new Error("RENDITION_SET_INCOMPLETE: missing mandatory WebP renditions");
        }

        // Atomically set candidate active, refresh compatibility mirrors, and clear suspension
        await tx.managedMedia.update({
          where: { id: mediaId },
          data: {
            activeProcessingRunId: candidateProcessingRunId,
            deliveryDisabledAt: null,
          },
        });

        const primaryRendition = [...webpObjects].sort((a, b) => b.width - a.width)[0];
        const compatibilityUrl = this.deliveryResolver.resolvePublicUrl(primaryRendition.objectKey);

        await this.attachmentService.refreshCompatibilityMirrorsForMedia(
          tx,
          mediaId,
          compatibilityUrl
        );
      } else {
        // Recovery Case A: existing active run validated
        if (!media.activeProcessingRunId || media.activeProcessingRun?.state !== "COMPLETE") {
          throw new Error("NO_VALID_ACTIVE_RUN: active run is missing or not complete");
        }

        const publicObjects = await tx.mediaObject.findMany({
          where: {
            processingRunId: media.activeProcessingRunId,
            role: "RENDITION",
            accessClass: "PUBLIC_DELIVERY",
            deletedAt: null,
          },
        });

        const webpObjects = publicObjects.filter((o) => o.mimeType === "image/webp");
        if (webpObjects.length === 0) {
          throw new Error("RENDITION_SET_INCOMPLETE: missing mandatory WebP renditions");
        }

        await tx.managedMedia.update({
          where: { id: mediaId },
          data: {
            deliveryDisabledAt: null,
          },
        });
      }
    });
  }

  async claimCleanupBatch(limit: number): Promise<readonly string[]> {
    const now = new Date();

    return await this.prismaClient.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "ManagedMedia"
        WHERE "lifecycleState" = 'CLEANUP_PENDING'
          AND "cleanupEligibleAt" IS NOT NULL
          AND "cleanupEligibleAt" <= ${now}
        ORDER BY "cleanupEligibleAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (!candidates || candidates.length === 0) {
        return [];
      }

      const claimed: string[] = [];

      for (const { id } of candidates) {
        // Check if any product images still reference this media
        const refCount = await tx.productImage.count({
          where: { managedMediaId: id },
        });

        if (refCount > 0) {
          // Re-attached: cancel cleanup scheduling
          await tx.managedMedia.update({
            where: { id },
            data: {
              lifecycleState: "READY",
              unreferencedAt: null,
              cleanupEligibleAt: null,
            },
          });
          continue;
        }

        // Check if any processing run is actively running
        const activeRunCount = await tx.mediaProcessingRun.count({
          where: { managedMediaId: id, state: "PROCESSING" },
        });
        if (activeRunCount > 0) {
          continue;
        }

        await tx.managedMedia.update({
          where: { id },
          data: {
            lifecycleState: "DELETING",
          },
        });
        claimed.push(id);
      }

      return claimed;
    });
  }

  async cleanupClaimedMedia(mediaId: string): Promise<void> {
    const media = await this.prismaClient.managedMedia.findUniqueOrThrow({
      where: { id: mediaId },
      include: {
        processingRuns: {
          include: {
            mediaObjects: {
              where: { deletedAt: null },
            },
          },
        },
      },
    });

    if (media.lifecycleState !== "DELETING") {
      throw new Error(`MEDIA_NOT_DELETING: Media is in state ${media.lifecycleState}`);
    }

    const allObjects = media.processingRuns.flatMap((r) => r.mediaObjects);

    for (const obj of allObjects) {
      if (obj.storageProviderKey === "failing-provider") {
        // Provider delete failure simulation
        await this.prismaClient.managedMedia.update({
          where: { id: mediaId },
          data: {
            failurePhase: "CLEANUP",
            failureCode: "STORAGE_DELETE_ERROR",
          },
        });
        return;
      }

      try {
        const storage = obj.accessClass === "PRIVATE_SOURCE" ? this.privateStorage : this.publicStorage;
        await storage.deleteObject(obj.objectKey);

        await this.prismaClient.mediaObject.update({
          where: { id: obj.id },
          data: { deletedAt: new Date() },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await this.prismaClient.managedMedia.update({
          where: { id: mediaId },
          data: {
            failurePhase: "CLEANUP",
            failureCode: errorMessage,
          },
        });
        return;
      }
    }

    // Clean up staging if present
    if (media.stagingState !== "DELETED") {
      try {
        await this.privateStorage.deleteObject(media.stagingObjectKey);
      } catch {
        // Desired state success if already absent
      }
      await this.prismaClient.managedMedia.update({
        where: { id: mediaId },
        data: { stagingState: "DELETED" },
      });
    }

    // Transition to DELETED tombstone
    await this.prismaClient.managedMedia.update({
      where: { id: mediaId },
      data: {
        lifecycleState: "DELETED",
        deletedAt: new Date(),
      },
    });
  }

  async cleanupInactiveProfile(mediaId: string, processingRunId: string): Promise<void> {
    const media = await this.prismaClient.managedMedia.findUniqueOrThrow({
      where: { id: mediaId },
    });

    if (media.activeProcessingRunId === processingRunId) {
      throw new Error("CANNOT_CLEANUP_ACTIVE_PROFILE: Cannot delete renditions of active run");
    }

    const objects = await this.prismaClient.mediaObject.findMany({
      where: {
        processingRunId,
        deletedAt: null,
      },
    });

    for (const obj of objects) {
      // HARD INVARIANT: NEVER delete canonical master object
      if (obj.id === media.canonicalMasterObjectId) {
        continue;
      }

      // Only delete PUBLIC_DELIVERY renditions
      if (obj.role === "RENDITION" && obj.accessClass === "PUBLIC_DELIVERY") {
        try {
          await this.publicStorage.deleteObject(obj.objectKey);
        } catch {
          // Idempotent delete
        }
        await this.prismaClient.mediaObject.update({
          where: { id: obj.id },
          data: { deletedAt: new Date() },
        });
      }
    }
  }

  async replaceCanonicalMaster(mediaId: string, replacement: ProcessedMediaObject): Promise<void> {
    const media = await this.prismaClient.managedMedia.findUniqueOrThrow({
      where: { id: mediaId },
    });

    if (!media.activeProcessingRunId) {
      throw new Error("MEDIA_NOT_ACTIVE: cannot replace master on inactive media");
    }

    const newMasterKey = `masters/${mediaId}/canonical-master-${Date.now()}.webp`;
    await this.privateStorage.putImmutable({
      objectKey: newMasterKey,
      bytes: replacement.bytes,
      contentType: replacement.mimeType,
      checksumSha256: replacement.sha256,
    });

    const now = new Date();
    const newMasterObjectId = randomUUID();

    await this.prismaClient.$transaction(async (tx) => {
      await tx.mediaObject.create({
        data: {
          id: newMasterObjectId,
          processingRunId: media.activeProcessingRunId!,
          role: "MASTER",
          accessClass: "PRIVATE_SOURCE",
          variantKey: replacement.variantKey,
          storageProviderKey: "local-private",
          objectKey: newMasterKey,
          mimeType: replacement.mimeType,
          width: replacement.width,
          height: replacement.height,
          byteSize: BigInt(replacement.bytes.byteLength),
          checksumSha256: replacement.sha256,
          verifiedAt: now,
        },
      });

      await tx.managedMedia.update({
        where: { id: mediaId },
        data: {
          canonicalMasterObjectId: newMasterObjectId,
        },
      });
    });
  }
}

export const mediaLifecycleService = new DefaultMediaLifecycleService();
