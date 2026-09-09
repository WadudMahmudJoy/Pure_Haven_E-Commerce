import { createHash, randomUUID } from "node:crypto";
import type { MediaRepository } from "./mediaRepository";
import type { MediaStorage } from "./storage/contracts";
import {
  type ProductImageProcessingProfile,
  PRODUCT_IMAGE_PROFILE_V1,
  hashProcessingProfile,
} from "./processingProfile";
import { canAttachManagedMedia, type ManagedMediaLifecycleState } from "./domain";

export type StartProductImageIngestInput = Readonly<{
  actorScope: string;
  idempotencyKey: string;
  bytes: Uint8Array;
  declaredMimeType: string;
  originalFilename?: string;
}>;

export type MediaIngestResult = Readonly<{
  mediaId: string;
  lifecycleState: ManagedMediaLifecycleState;
  attachable: boolean;
}>;

export interface MediaIngestService {
  startProductImageIngest(input: StartProductImageIngestInput): Promise<MediaIngestResult>;
}

export function isRetryableInitialIngestFailure(failureCode?: string | null): boolean {
  if (!failureCode) return false;
  const retryableCodes = new Set([
    "MEDIA_STORAGE_UNAVAILABLE",
    "STORAGE_WRITE_FAILED",
    "TIMEOUT",
    "TRANSIENT_FAILURE",
    "RATE_LIMITED",
  ]);
  return retryableCodes.has(failureCode);
}

export class DefaultMediaIngestService implements MediaIngestService {
  constructor(
    private readonly repository: MediaRepository,
    private readonly privateStorage: MediaStorage,
    private readonly stagingProviderKey: string,
    private readonly profile: ProductImageProcessingProfile = PRODUCT_IMAGE_PROFILE_V1
  ) {}

  async startProductImageIngest(
    input: StartProductImageIngestInput
  ): Promise<MediaIngestResult> {
    const byteSize = BigInt(input.bytes.byteLength);
    const sha = createHash("sha256").update(input.bytes).digest("hex");
    const newMediaId = randomUUID();
    const stagingObjectKey = `staging/${newMediaId}/source`;

    // 1. Transactionally allocate or load scoped ingest record
    const { media, isNew } = await this.repository.createOrLoadScopedIngest({
      mediaId: newMediaId,
      actorScope: input.actorScope,
      idempotencyKey: input.idempotencyKey,
      sha256: sha,
      byteSize,
      mimeType: input.declaredMimeType,
      stagingProviderKey: this.stagingProviderKey,
      stagingObjectKey,
      originalFilename: input.originalFilename ? input.originalFilename.slice(0, 255) : null,
      profileVersion: this.profile.version,
      profileDefinitionHash: hashProcessingProfile(this.profile),
    });

    // 2. If existing operation found, check SHA-256 match
    if (!isNew) {
      if (media.ingestSha256 !== sha) {
        throw new Error(
          `CONFLICT: Idempotency key '${input.idempotencyKey}' already used with different file content`
        );
      }

      // Check retryable failure state
      if (
        media.lifecycleState === "FAILED" &&
        isRetryableInitialIngestFailure(media.failureCode)
      ) {
        const head = await this.privateStorage.headObject(media.stagingObjectKey);
        if (!head || head.checksumSha256 !== sha) {
          throw new Error("RETRY_STAGING_UNAVAILABLE: Staging object missing or corrupted for retry");
        }
        const resetMedia = await this.repository.resetInitialRunForRetry(media.id);
        return {
          mediaId: resetMedia.id,
          lifecycleState: resetMedia.lifecycleState,
          attachable: canAttachManagedMedia(
            resetMedia.lifecycleState,
            resetMedia.deliveryDisabledAt
          ),
        };
      }

      // If existing staging was not yet marked PRESENT, verify/write
      if (media.stagingState === "ALLOCATED") {
        const head = await this.privateStorage.headObject(media.stagingObjectKey);
        if (!head) {
          await this.privateStorage.putImmutable({
            objectKey: media.stagingObjectKey,
            bytes: input.bytes,
            contentType: input.declaredMimeType,
            checksumSha256: sha,
          });
        }
        await this.repository.updateStagingState(media.id, "PRESENT");
      }

      return {
        mediaId: media.id,
        lifecycleState: media.lifecycleState,
        attachable: canAttachManagedMedia(media.lifecycleState, media.deliveryDisabledAt),
      };
    }

    // 3. New record: write to private object storage (deterministic staging)
    await this.privateStorage.putImmutable({
      objectKey: media.stagingObjectKey,
      bytes: input.bytes,
      contentType: input.declaredMimeType,
      checksumSha256: sha,
    });

    // 4. Verify HEAD after PUT and mark PRESENT
    const head = await this.privateStorage.headObject(media.stagingObjectKey);
    if (!head || head.checksumSha256 !== sha) {
      throw new Error("STAGING_INTEGRITY_MISMATCH: Staging object checksum could not be verified");
    }

    const updated = await this.repository.updateStagingState(media.id, "PRESENT");

    return {
      mediaId: updated.id,
      lifecycleState: updated.lifecycleState,
      attachable: canAttachManagedMedia(updated.lifecycleState, updated.deliveryDisabledAt),
    };
  }
}
