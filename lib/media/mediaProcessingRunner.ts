import { createHash, randomUUID } from "node:crypto";
import type { ManagedMediaLifecycleState } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import type { MediaStorage } from "./storage/contracts";
import { MediaStorageError } from "./storage/contracts";
import { InMemoryMediaStorage } from "./storage/inMemoryMediaStorage";
import {
  DefaultImageProcessor,
  type ImageProcessor,
  type CanonicalMasterInput,
} from "./imageProcessor";
import {
  PRODUCT_IMAGE_PROFILE_V1,
  hashProcessingProfile,
} from "./processingProfile";
import {
  ConfiguredMediaDeliveryResolver,
  type MediaDeliveryResolver,
} from "./delivery";
import {
  productMediaAttachmentService,
  type ProductMediaAttachmentService,
} from "./productMediaAttachmentService";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type RenditionObjectToPersist = {
  id: string;
  role: "RENDITION" | "MASTER";
  accessClass: "PUBLIC_DELIVERY" | "PRIVATE_SOURCE";
  variantKey: string;
  storageProviderKey: string;
  objectKey: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: bigint;
  checksumSha256: string;
};

export interface MediaProcessingRunner {
  runMedia(
    mediaId: string,
    budgetMs?: number
  ): Promise<Readonly<{ completed: boolean; state: ManagedMediaLifecycleState }>>;

  runBatch(
    limit: number,
    execute?: boolean
  ): Promise<Readonly<{ claimed: number; completed: number; failed: number }>>;

  requestProfileRegeneration(
    mediaId: string,
    profileVersion: string,
    actorScope: string
  ): Promise<Readonly<{ processingRunId: string }>>;

  activateProcessingRun(mediaId: string, processingRunId: string): Promise<void>;
}

export class DefaultMediaProcessingRunner implements MediaProcessingRunner {
  private readonly privateStorage: MediaStorage;
  private readonly publicStorage: MediaStorage;

  constructor(
    private readonly prismaClient: typeof defaultPrisma = defaultPrisma,
    privateStorage?: MediaStorage,
    publicStorage?: MediaStorage,
    private readonly imageProcessor: ImageProcessor = new DefaultImageProcessor(),
    private readonly deliveryResolver: MediaDeliveryResolver = new ConfiguredMediaDeliveryResolver(
      process.env.MEDIA_PUBLIC_ORIGIN || "http://localhost:3000/media"
    ),
    private readonly attachmentService: ProductMediaAttachmentService = productMediaAttachmentService,
    private readonly scopedActorScope?: string
  ) {
    this.privateStorage = privateStorage ?? new InMemoryMediaStorage();
    this.publicStorage = publicStorage ?? new InMemoryMediaStorage();
  }

  private getStorageForAccessClass(accessClass: "PRIVATE_SOURCE" | "PUBLIC_DELIVERY"): MediaStorage {
    return accessClass === "PRIVATE_SOURCE" ? this.privateStorage : this.publicStorage;
  }

  async runBatch(
    limit: number,
    execute: boolean = true
  ): Promise<Readonly<{ claimed: number; completed: number; failed: number }>> {
    const now = new Date();
    const leaseDurationMs = 60_000;
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

    // 1. Transactionally claim eligible runs using FOR UPDATE SKIP LOCKED
    const claimedRuns = await this.prismaClient.$transaction(async (tx) => {
      const candidates = this.scopedActorScope
        ? await tx.$queryRaw<Array<{ id: string; managedMediaId: string }>>`
            SELECT r.id, r."managedMediaId"
            FROM "MediaProcessingRun" r
            JOIN "ManagedMedia" m ON r."managedMediaId" = m.id
            WHERE m."ingestActorScope" = ${this.scopedActorScope}
              AND (r.state = 'PENDING'
               OR (r.state = 'PROCESSING' AND r."leaseExpiresAt" IS NOT NULL AND r."leaseExpiresAt" < ${now}))
            ORDER BY r."createdAt" ASC
            LIMIT ${limit}
            FOR UPDATE OF r SKIP LOCKED
          `
        : await tx.$queryRaw<Array<{ id: string; managedMediaId: string }>>`
            SELECT id, "managedMediaId"
            FROM "MediaProcessingRun"
            WHERE state = 'PENDING'
               OR (state = 'PROCESSING' AND "leaseExpiresAt" IS NOT NULL AND "leaseExpiresAt" < ${now})
            ORDER BY "createdAt" ASC
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          `;

      if (!candidates || candidates.length === 0) {
        return [];
      }

      const ids = candidates.map((c) => c.id);
      await tx.mediaProcessingRun.updateMany({
        where: { id: { in: ids } },
        data: {
          state: "PROCESSING",
          startedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt,
          attemptCount: { increment: 1 },
        },
      });

      return candidates;
    });

    if (!execute) {
      return {
        claimed: claimedRuns.length,
        completed: 0,
        failed: 0,
      };
    }

    let completed = 0;
    let failed = 0;

    for (const run of claimedRuns) {
      try {
        await this.executeRun(run.id, run.managedMediaId);
        completed++;
      } catch (err) {
        failed++;
        console.error(`Error executing processing run ${run.id}:`, err);
      }
    }

    return {
      claimed: claimedRuns.length,
      completed,
      failed,
    };
  }

  async runMedia(
    mediaId: string,
    budgetMs?: number
  ): Promise<Readonly<{ completed: boolean; state: ManagedMediaLifecycleState }>> {
    void budgetMs;
    const media = await this.prismaClient.managedMedia.findUniqueOrThrow({
      where: { id: mediaId },
      include: { processingRuns: { orderBy: { createdAt: "desc" } } },
    });

    if (media.lifecycleState === "READY" && media.activeProcessingRunId) {
      return { completed: true, state: "READY" };
    }

    // Find the latest pending or processing run
    const activeOrPendingRun = media.processingRuns.find(
      (r) => r.state === "PENDING" || r.state === "PROCESSING"
    );

    if (!activeOrPendingRun) {
      return { completed: false, state: media.lifecycleState };
    }

    const now = new Date();
    // Lease authority check: if it is already processing with a valid unexpired lease
    if (
      activeOrPendingRun.state === "PROCESSING" &&
      activeOrPendingRun.leaseExpiresAt &&
      activeOrPendingRun.leaseExpiresAt > now
    ) {
      throw new Error("LEASE_CONFLICT: run is currently leased by another worker");
    }

    // Acquire lease for this runner
    const leaseDurationMs = 60_000;
    await this.prismaClient.mediaProcessingRun.update({
      where: { id: activeOrPendingRun.id },
      data: {
        state: "PROCESSING",
        startedAt: now,
        lastHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
        attemptCount: { increment: 1 },
      },
    });

    await this.executeRun(activeOrPendingRun.id, mediaId);

    const refreshed = await this.prismaClient.managedMedia.findUniqueOrThrow({
      where: { id: mediaId },
    });
    return {
      completed: refreshed.lifecycleState === "READY",
      state: refreshed.lifecycleState,
    };
  }

  private async executeRun(runId: string, mediaId: string): Promise<void> {
    const media = await this.prismaClient.managedMedia.findUniqueOrThrow({
      where: { id: mediaId },
    });
    const run = await this.prismaClient.mediaProcessingRun.findUniqueOrThrow({
      where: { id: runId },
    });

    const isInitialRun = !media.canonicalMasterObjectId;

    try {
      if (isInitialRun) {
        // Initial run: read from private staging
        const storage = this.getStorageForAccessClass("PRIVATE_SOURCE");
        const stagedBytes = await storage.getObject(media.stagingObjectKey);

        const actualSha = sha256(stagedBytes);
        if (actualSha !== media.ingestSha256) {
          throw new MediaStorageError(
            "INTEGRITY_MISMATCH",
            `Staging checksum mismatch for media ${mediaId}`
          );
        }

        // Process canonical master and delivery renditions
        const processed = await this.imageProcessor.processInitialProductImage(
          { bytes: stagedBytes, declaredMimeType: media.ingestMimeType },
          PRODUCT_IMAGE_PROFILE_V1
        );

        // Put canonical master
        const master = processed.canonicalMaster;
        const masterKey = `masters/${media.id}/canonical-master.webp`;
        await storage.putImmutable({
          objectKey: masterKey,
          bytes: master.bytes,
          contentType: master.mimeType,
          checksumSha256: master.sha256,
        });

        // Put renditions to public delivery storage
        const pubStorage = this.getStorageForAccessClass("PUBLIC_DELIVERY");
        const renditionObjectsToPersist: RenditionObjectToPersist[] = [];

        for (const rendition of processed.renditions) {
          const ext = rendition.mimeType === "image/avif" ? "avif" : "webp";
          const renditionKey = `renditions/${media.id}/${rendition.variantKey}.${ext}`;
          await pubStorage.putImmutable({
            objectKey: renditionKey,
            bytes: rendition.bytes,
            contentType: rendition.mimeType,
            checksumSha256: rendition.sha256,
          });

          renditionObjectsToPersist.push({
            id: randomUUID(),
            role: rendition.role,
            accessClass: rendition.accessClass,
            variantKey: rendition.variantKey,
            storageProviderKey: "local-public",
            objectKey: renditionKey,
            mimeType: rendition.mimeType,
            width: rendition.width,
            height: rendition.height,
            byteSize: BigInt(rendition.bytes.byteLength),
            checksumSha256: rendition.sha256,
          });
        }

        const now = new Date();
        const masterObjectId = randomUUID();

        // Atomically commit master, renditions, run COMPLETE, and media READY
        await this.prismaClient.$transaction(async (tx) => {
          // Persist master MediaObject
          await tx.mediaObject.create({
            data: {
              id: masterObjectId,
              processingRunId: run.id,
              role: master.role,
              accessClass: master.accessClass,
              variantKey: master.variantKey,
              storageProviderKey: "local-private",
              objectKey: masterKey,
              mimeType: master.mimeType,
              width: master.width,
              height: master.height,
              byteSize: BigInt(master.bytes.byteLength),
              checksumSha256: master.sha256,
              verifiedAt: now,
            },
          });

          // Persist rendition MediaObjects
          for (const rObj of renditionObjectsToPersist) {
            await tx.mediaObject.create({
              data: {
                id: rObj.id,
                processingRunId: run.id,
                role: rObj.role,
                accessClass: rObj.accessClass,
                variantKey: rObj.variantKey,
                storageProviderKey: rObj.storageProviderKey,
                objectKey: rObj.objectKey,
                mimeType: rObj.mimeType,
                width: rObj.width,
                height: rObj.height,
                byteSize: rObj.byteSize,
                checksumSha256: rObj.checksumSha256,
                verifiedAt: now,
              },
            });
          }

          // Complete run
          await tx.mediaProcessingRun.update({
            where: { id: run.id },
            data: {
              state: "COMPLETE",
              completedAt: now,
              leaseExpiresAt: null,
            },
          });

          // Atomically establish master, active run, and READY lifecycle
          await tx.managedMedia.update({
            where: { id: media.id },
            data: {
              canonicalMasterObjectId: masterObjectId,
              activeProcessingRunId: run.id,
              lifecycleState: "READY",
            },
          });
        });

        // Outside transaction: cleanup staging
        try {
          await storage.deleteObject(media.stagingObjectKey);
          await this.prismaClient.managedMedia.update({
            where: { id: media.id },
            data: { stagingState: "DELETED" },
          });
        } catch {
          // Non-blocking staging cleanup; reconciliation will clean up leftover staging
        }
      } else {
        // Regeneration candidate run: read existing canonical master
        const masterObj = await this.prismaClient.mediaObject.findUniqueOrThrow({
          where: { id: media.canonicalMasterObjectId! },
        });

        const privStorage = this.getStorageForAccessClass("PRIVATE_SOURCE");
        const masterBytes = await privStorage.getObject(masterObj.objectKey);
        const masterInput: CanonicalMasterInput = {
          bytes: masterBytes,
          mimeType: masterObj.mimeType,
          width: masterObj.width,
          height: masterObj.height,
          sha256: masterObj.checksumSha256,
        };

        const renditions = await this.imageProcessor.generateDeliveryRenditions(
          masterInput,
          PRODUCT_IMAGE_PROFILE_V1
        );

        const pubStorage = this.getStorageForAccessClass("PUBLIC_DELIVERY");
        const renditionObjectsToPersist: RenditionObjectToPersist[] = [];

        for (const rendition of renditions) {
          const ext = rendition.mimeType === "image/avif" ? "avif" : "webp";
          const renditionKey = `renditions/${media.id}/${rendition.variantKey}.${ext}`;
          await pubStorage.putImmutable({
            objectKey: renditionKey,
            bytes: rendition.bytes,
            contentType: rendition.mimeType,
            checksumSha256: rendition.sha256,
          });

          renditionObjectsToPersist.push({
            id: randomUUID(),
            role: rendition.role,
            accessClass: rendition.accessClass,
            variantKey: rendition.variantKey,
            storageProviderKey: "local-public",
            objectKey: renditionKey,
            mimeType: rendition.mimeType,
            width: rendition.width,
            height: rendition.height,
            byteSize: BigInt(rendition.bytes.byteLength),
            checksumSha256: rendition.sha256,
          });
        }

        const now = new Date();
        await this.prismaClient.$transaction(async (tx) => {
          for (const rObj of renditionObjectsToPersist) {
            await tx.mediaObject.create({
              data: {
                id: rObj.id,
                processingRunId: run.id,
                role: rObj.role,
                accessClass: rObj.accessClass,
                variantKey: rObj.variantKey,
                storageProviderKey: rObj.storageProviderKey,
                objectKey: rObj.objectKey,
                mimeType: rObj.mimeType,
                width: rObj.width,
                height: rObj.height,
                byteSize: rObj.byteSize,
                checksumSha256: rObj.checksumSha256,
                verifiedAt: now,
              },
            });
          }

          // Complete the candidate run without activating it! (COMPLETE != ACTIVE)
          await tx.mediaProcessingRun.update({
            where: { id: run.id },
            data: {
              state: "COMPLETE",
              completedAt: now,
              leaseExpiresAt: null,
            },
          });
        });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isIntegrity = errorMessage.includes("INTEGRITY_MISMATCH");

      await this.prismaClient.mediaProcessingRun.update({
        where: { id: run.id },
        data: {
          state: "FAILED",
          failurePhase: "PROCESSING",
          failureCode: isIntegrity ? "INTEGRITY_MISMATCH" : "PROCESSING_ERROR",
          leaseExpiresAt: null,
        },
      });

      if (isInitialRun) {
        await this.prismaClient.managedMedia.update({
          where: { id: media.id },
          data: {
            lifecycleState: "FAILED",
            failurePhase: "PROCESSING",
            failureCode: isIntegrity ? "INTEGRITY_MISMATCH" : "PROCESSING_ERROR",
          },
        });
      }

      throw err;
    }
  }

  async requestProfileRegeneration(
    mediaId: string,
    profileVersion: string,
    actorScope: string
  ): Promise<Readonly<{ processingRunId: string }>> {
    void actorScope;
    const media = await this.prismaClient.managedMedia.findUniqueOrThrow({
      where: { id: mediaId },
    });

    if (media.lifecycleState === "DELETING" || media.lifecycleState === "DELETED") {
      throw new Error("MEDIA_NOT_REGENERATABLE: Media is deleting or deleted");
    }

    const runId = randomUUID();
    const run = await this.prismaClient.mediaProcessingRun.create({
      data: {
        id: runId,
        managedMediaId: mediaId,
        profileVersion,
        profileDefinitionHash: hashProcessingProfile(PRODUCT_IMAGE_PROFILE_V1),
        state: "PENDING",
      },
    });

    return { processingRunId: run.id };
  }

  async activateProcessingRun(mediaId: string, processingRunId: string): Promise<void> {
    await this.prismaClient.$transaction(async (tx) => {
      const media = await tx.managedMedia.findUniqueOrThrow({
        where: { id: mediaId },
      });

      if (media.deliveryDisabledAt !== null) {
        throw new Error("MEDIA_DELIVERY_DISABLED: cannot activate while delivery is suspended");
      }

      if (media.lifecycleState === "DELETING" || media.lifecycleState === "DELETED") {
        throw new Error("MEDIA_NOT_ACTIVATABLE: media is deleting or deleted");
      }

      const run = await tx.mediaProcessingRun.findUniqueOrThrow({
        where: { id: processingRunId },
      });

      if (run.managedMediaId !== mediaId) {
        throw new Error("RUN_MEDIA_MISMATCH: run does not belong to media");
      }

      if (run.state !== "COMPLETE") {
        throw new Error("RUN_NOT_COMPLETE: candidate run is not complete");
      }

      const publicObjects = await tx.mediaObject.findMany({
        where: {
          processingRunId,
          role: "RENDITION",
          accessClass: "PUBLIC_DELIVERY",
          deletedAt: null,
        },
      });

      const webpObjects = publicObjects.filter((o) => o.mimeType === "image/webp");
      if (webpObjects.length === 0) {
        throw new Error("RENDITION_SET_INCOMPLETE: missing mandatory WebP renditions");
      }

      // Update active processing run
      await tx.managedMedia.update({
        where: { id: mediaId },
        data: {
          activeProcessingRunId: processingRunId,
        },
      });

      // Largest WebP rendition for compatibility mirror
      const primaryRendition = [...webpObjects].sort((a, b) => b.width - a.width)[0];
      const compatibilityUrl = this.deliveryResolver.resolvePublicUrl(primaryRendition.objectKey);

      await this.attachmentService.refreshCompatibilityMirrorsForMedia(
        tx,
        mediaId,
        compatibilityUrl
      );
    });
  }
}

export const mediaProcessingRunner = new DefaultMediaProcessingRunner();
