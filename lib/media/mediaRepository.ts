import type {
  Prisma,
  ManagedMedia,
  MediaProcessingRun,
} from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

export type MediaDbClient = Prisma.TransactionClient | typeof defaultPrisma;

export interface MediaRepository {
  createOrLoadScopedIngest(
    input: {
      mediaId: string;
      actorScope: string;
      idempotencyKey: string;
      sha256: string;
      byteSize: bigint;
      mimeType: string;
      stagingProviderKey: string;
      stagingObjectKey: string;
      originalFilename?: string | null;
      profileVersion: string;
      profileDefinitionHash: string;
    },
    tx?: MediaDbClient
  ): Promise<{ media: ManagedMedia; isNew: boolean }>;

  updateStagingState(
    mediaId: string,
    state: "ALLOCATED" | "PRESENT" | "CLEANUP_PENDING" | "DELETED",
    tx?: MediaDbClient
  ): Promise<ManagedMedia>;

  resetInitialRunForRetry(
    mediaId: string,
    tx?: MediaDbClient
  ): Promise<ManagedMedia>;

  findManagedMediaById(
    mediaId: string,
    tx?: MediaDbClient
  ): Promise<ManagedMedia | null>;

  findProcessingRun(
    mediaId: string,
    profileVersion: string,
    tx?: MediaDbClient
  ): Promise<MediaProcessingRun | null>;
}

export class PrismaMediaRepository implements MediaRepository {
  constructor(private readonly client: typeof defaultPrisma = defaultPrisma) {}

  async createOrLoadScopedIngest(
    input: {
      mediaId: string;
      actorScope: string;
      idempotencyKey: string;
      sha256: string;
      byteSize: bigint;
      mimeType: string;
      stagingProviderKey: string;
      stagingObjectKey: string;
      originalFilename?: string | null;
      profileVersion: string;
      profileDefinitionHash: string;
    },
    tx?: MediaDbClient
  ): Promise<{ media: ManagedMedia; isNew: boolean }> {
    const db = tx ?? this.client;

    const existing = await db.managedMedia.findUnique({
      where: {
        ingestActorScope_ingestPurpose_ingestIdempotencyKey: {
          ingestActorScope: input.actorScope,
          ingestPurpose: "PRODUCT_IMAGE",
          ingestIdempotencyKey: input.idempotencyKey,
        },
      },
    });

    if (existing) {
      return { media: existing, isNew: false };
    }

    try {
      const media = await (db as typeof defaultPrisma).$transaction(async (innerTx) => {
        const created = await innerTx.managedMedia.create({
          data: {
            id: input.mediaId,
            mediaType: "IMAGE",
            lifecycleState: "PENDING",
            ingestPurpose: "PRODUCT_IMAGE",
            ingestActorScope: input.actorScope,
            ingestIdempotencyKey: input.idempotencyKey,
            ingestSha256: input.sha256,
            ingestByteSize: input.byteSize,
            ingestMimeType: input.mimeType,
            originalFilename: input.originalFilename,
            stagingProviderKey: input.stagingProviderKey,
            stagingObjectKey: input.stagingObjectKey,
            stagingState: "ALLOCATED",
            processingRuns: {
              create: {
                profileVersion: input.profileVersion,
                profileDefinitionHash: input.profileDefinitionHash,
                state: "PENDING",
              },
            },
          },
        });
        return created;
      });

      return { media, isNew: true };
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "P2002") {
        const found = await db.managedMedia.findUnique({
          where: {
            ingestActorScope_ingestPurpose_ingestIdempotencyKey: {
              ingestActorScope: input.actorScope,
              ingestPurpose: "PRODUCT_IMAGE",
              ingestIdempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (found) {
          return { media: found, isNew: false };
        }
      }
      throw err;
    }
  }

  async updateStagingState(
    mediaId: string,
    state: "ALLOCATED" | "PRESENT" | "CLEANUP_PENDING" | "DELETED",
    tx?: MediaDbClient
  ): Promise<ManagedMedia> {
    const db = tx ?? this.client;
    return db.managedMedia.update({
      where: { id: mediaId },
      data: { stagingState: state },
    });
  }

  async resetInitialRunForRetry(
    mediaId: string,
    tx?: MediaDbClient
  ): Promise<ManagedMedia> {
    const db = tx ?? this.client;
    return (db as typeof defaultPrisma).$transaction(async (innerTx) => {
      await innerTx.mediaProcessingRun.updateMany({
        where: { managedMediaId: mediaId, state: "FAILED" },
        data: {
          state: "PENDING",
          failurePhase: null,
          failureCode: null,
          startedAt: null,
          lastHeartbeatAt: null,
          leaseExpiresAt: null,
        },
      });

      return innerTx.managedMedia.update({
        where: { id: mediaId },
        data: {
          lifecycleState: "PENDING",
          failurePhase: null,
          failureCode: null,
        },
      });
    });
  }

  async findManagedMediaById(
    mediaId: string,
    tx?: MediaDbClient
  ): Promise<ManagedMedia | null> {
    const db = tx ?? this.client;
    return db.managedMedia.findUnique({
      where: { id: mediaId },
    });
  }

  async findProcessingRun(
    mediaId: string,
    profileVersion: string,
    tx?: MediaDbClient
  ): Promise<MediaProcessingRun | null> {
    const db = tx ?? this.client;
    return db.mediaProcessingRun.findUnique({
      where: {
        managedMediaId_profileVersion: {
          managedMediaId: mediaId,
          profileVersion,
        },
      },
    });
  }
}
