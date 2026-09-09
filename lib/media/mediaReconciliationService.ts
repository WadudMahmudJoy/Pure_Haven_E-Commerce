import { prisma as defaultPrisma } from "@/lib/prisma";
import type { MediaStorage } from "./storage/contracts";
import { InMemoryMediaStorage } from "./storage/inMemoryMediaStorage";
import {
  DefaultMediaLifecycleService,
  type MediaLifecycleService,
} from "./mediaLifecycleService";

export type ReconciliationSummary = Readonly<{
  stalePendingRecovered: number;
  staleProcessingRecovered: number;
  cleanupCandidatesMarked: number;
  cleanupClaims: number;
  cleanupCompleted: number;
  cleanupFailed: number;
  stagingCleaned: number;
}>;

export interface MediaReconciliationService {
  runBatch(limit: number): Promise<ReconciliationSummary>;
}

export class DefaultMediaReconciliationService implements MediaReconciliationService {
  private readonly privateStorage: MediaStorage;
  private readonly publicStorage: MediaStorage;
  private readonly lifecycleService: MediaLifecycleService;
  private readonly scopedActorScope?: string;

  constructor(
    private readonly prismaClient: typeof defaultPrisma = defaultPrisma,
    privateStorage?: MediaStorage,
    publicStorage?: MediaStorage,
    lifecycleService?: MediaLifecycleService,
    scopedActorScope?: string
  ) {
    this.privateStorage = privateStorage ?? new InMemoryMediaStorage();
    this.publicStorage = publicStorage ?? new InMemoryMediaStorage();
    this.lifecycleService =
      lifecycleService ??
      new DefaultMediaLifecycleService(
        prismaClient,
        this.privateStorage,
        this.publicStorage
      );
    this.scopedActorScope = scopedActorScope;
  }

  async runBatch(limit: number): Promise<ReconciliationSummary> {
    const now = new Date();
    let stalePendingRecovered = 0;
    let staleProcessingRecovered = 0;
    let cleanupCandidatesMarked = 0;
    let cleanupClaims = 0;
    let cleanupCompleted = 0;
    let cleanupFailed = 0;
    let stagingCleaned = 0;

    // 1. Reconcile crashed staging: ALLOCATED with physical staging object
    const allocatedStaging = await this.prismaClient.managedMedia.findMany({
      where: {
        stagingState: "ALLOCATED",
        ...(this.scopedActorScope ? { ingestActorScope: this.scopedActorScope } : {}),
      },
      take: limit,
      orderBy: { createdAt: "asc" },
    });

    for (const media of allocatedStaging) {
      try {
        const head = await this.privateStorage.headObject(media.stagingObjectKey);
        if (head) {
          // Physical object exists. Check SHA and byteSize
          let matches = true;
          if (head.checksumSha256 && head.checksumSha256 !== media.ingestSha256) {
            matches = false;
          }
          if (head.byteSize !== media.ingestByteSize) {
            matches = false;
          }

          if (!matches) {
            // Integrity mismatch: fail closed
            await this.prismaClient.managedMedia.update({
              where: { id: media.id },
              data: {
                lifecycleState: "FAILED",
                failurePhase: "INGEST",
                failureCode: "INTEGRITY_MISMATCH",
              },
            });
          } else {
            // Valid match: advance stagingState to PRESENT
            await this.prismaClient.managedMedia.update({
              where: { id: media.id },
              data: {
                stagingState: "PRESENT",
              },
            });
            stalePendingRecovered++;
          }
        }
      } catch (err) {
        console.error(`Error checking staging object for media ${media.id}:`, err);
      }
    }

    // 2. Reconcile stale PROCESSING runs
    const staleRuns = await this.prismaClient.mediaProcessingRun.findMany({
      where: {
        state: "PROCESSING",
        leaseExpiresAt: {
          not: null,
          lt: now,
        },
        ...(this.scopedActorScope ? { managedMedia: { ingestActorScope: this.scopedActorScope } } : {}),
      },
      take: limit,
      orderBy: { leaseExpiresAt: "asc" },
    });

    for (const run of staleRuns) {
      try {
        if (run.attemptCount < 3) {
          // Reset to PENDING for retry
          await this.prismaClient.mediaProcessingRun.update({
            where: { id: run.id },
            data: {
              state: "PENDING",
              startedAt: null,
              leaseExpiresAt: null,
            },
          });
          staleProcessingRecovered++;
        } else {
          // Exceeded max retry attempts: fail run
          await this.prismaClient.mediaProcessingRun.update({
            where: { id: run.id },
            data: {
              state: "FAILED",
              failurePhase: "PROCESSING",
              failureCode: "LEASE_TIMEOUT",
            },
          });
          await this.prismaClient.managedMedia.updateMany({
            where: { id: run.managedMediaId, lifecycleState: "PROCESSING" },
            data: {
              lifecycleState: "FAILED",
              failurePhase: "PROCESSING",
              failureCode: "LEASE_TIMEOUT",
            },
          });
          staleProcessingRecovered++;
        }
      } catch (err) {
        console.error(`Error recovering stale run ${run.id}:`, err);
      }
    }

    // 3. Reconcile re-attached CLEANUP_PENDING media (owner restored)
    const cleanupPendingMedia = await this.prismaClient.managedMedia.findMany({
      where: {
        lifecycleState: "CLEANUP_PENDING",
        ...(this.scopedActorScope ? { ingestActorScope: this.scopedActorScope } : {}),
      },
      take: limit,
      orderBy: { updatedAt: "asc" },
    });

    for (const media of cleanupPendingMedia) {
      try {
        const refCount = await this.prismaClient.productImage.count({
          where: { managedMediaId: media.id },
        });

        if (refCount > 0) {
          // Owner exists! Restore to READY
          await this.prismaClient.managedMedia.update({
            where: { id: media.id },
            data: {
              lifecycleState: "READY",
              unreferencedAt: null,
              cleanupEligibleAt: null,
            },
          });
        }
      } catch (err) {
        console.error(`Error checking cleanup pending media ${media.id}:`, err);
      }
    }

    // 4. Mark zero-ref READY media for cleanup (grace period)
    const readyCandidates = await this.prismaClient.managedMedia.findMany({
      where: {
        lifecycleState: "READY",
        unreferencedAt: null,
        ...(this.scopedActorScope ? { ingestActorScope: this.scopedActorScope } : {}),
      },
      take: limit,
      orderBy: { createdAt: "asc" },
    });

    for (const media of readyCandidates) {
      try {
        const refCount = await this.prismaClient.productImage.count({
          where: { managedMediaId: media.id },
        });

        if (refCount === 0) {
          // Schedule cleanup with 7-day grace period
          const eligibleAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          await this.prismaClient.managedMedia.update({
            where: { id: media.id },
            data: {
              lifecycleState: "CLEANUP_PENDING",
              unreferencedAt: now,
              cleanupEligibleAt: eligibleAt,
            },
          });
          cleanupCandidatesMarked++;
        }
      } catch (err) {
        console.error(`Error checking unreferenced media ${media.id}:`, err);
      }
    }

    // 5. Clean leftover staging on READY media
    const readyWithStaging = await this.prismaClient.managedMedia.findMany({
      where: {
        lifecycleState: "READY",
        stagingState: "PRESENT",
        ...(this.scopedActorScope ? { ingestActorScope: this.scopedActorScope } : {}),
      },
      take: limit,
      orderBy: { createdAt: "asc" },
    });

    for (const media of readyWithStaging) {
      try {
        await this.privateStorage.deleteObject(media.stagingObjectKey);
        await this.prismaClient.managedMedia.update({
          where: { id: media.id },
          data: { stagingState: "DELETED" },
        });
        stagingCleaned++;
      } catch (err) {
        console.error(`Error cleaning leftover staging for media ${media.id}:`, err);
      }
    }

    // 6. Claim and execute cleanup batch
    try {
      const claimedIds = await this.lifecycleService.claimCleanupBatch(limit);
      cleanupClaims = claimedIds.length;

      for (const mediaId of claimedIds) {
        try {
          await this.lifecycleService.cleanupClaimedMedia(mediaId);
          const check = await this.prismaClient.managedMedia.findUnique({
            where: { id: mediaId },
            select: { lifecycleState: true },
          });
          if (check?.lifecycleState === "DELETED") {
            cleanupCompleted++;
          } else {
            cleanupFailed++;
          }
        } catch {
          cleanupFailed++;
        }
      }
    } catch (err) {
      console.error("Error running cleanup batch in reconciliation:", err);
    }

    return {
      stalePendingRecovered,
      staleProcessingRecovered,
      cleanupCandidatesMarked,
      cleanupClaims,
      cleanupCompleted,
      cleanupFailed,
      stagingCleaned,
    };
  }
}

export const mediaReconciliationService = new DefaultMediaReconciliationService();
