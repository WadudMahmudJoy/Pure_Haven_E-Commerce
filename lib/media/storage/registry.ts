import type { MediaStorage } from "./contracts";
import { MediaStorageError } from "./contracts";
import type { MediaProviderConfig } from "../config";
import { LocalMediaStorage } from "./localMediaStorage";
import { S3CompatibleMediaStorage } from "./s3CompatibleMediaStorage";

export function createMediaStorage(config: MediaProviderConfig): MediaStorage {
  if (config.kind === "local") {
    if (!config.root) {
      throw new MediaStorageError("UNAVAILABLE", "Local media storage requires a root directory");
    }
    return new LocalMediaStorage(config.root);
  }

  if (config.kind === "s3-compatible") {
    if (!config.bucket) {
      throw new MediaStorageError("UNAVAILABLE", "S3-compatible storage requires a bucket name");
    }
    return new S3CompatibleMediaStorage({
      region: config.region || "auto",
      bucket: config.bucket,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials:
        process.env.PHASE6_R2_ACCESS_KEY_ID && process.env.PHASE6_R2_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.PHASE6_R2_ACCESS_KEY_ID,
              secretAccessKey: process.env.PHASE6_R2_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  throw new MediaStorageError("UNAVAILABLE", "Unsupported media storage kind");
}

export class MediaStorageRegistry {
  private readonly providers = new Map<string, MediaStorage>();

  register(providerKey: string, storage: MediaStorage): void {
    if (this.providers.has(providerKey)) {
      throw new MediaStorageError(
        "CONFLICT",
        `Storage provider already registered for key: ${providerKey}`
      );
    }
    this.providers.set(providerKey, storage);
  }

  get(providerKey: string): MediaStorage {
    const storage = this.providers.get(providerKey);
    if (!storage) {
      throw new MediaStorageError(
        "NOT_FOUND",
        `No storage provider registered for key: ${providerKey}`
      );
    }
    return storage;
  }

  has(providerKey: string): boolean {
    return this.providers.has(providerKey);
  }

  clear(): void {
    this.providers.clear();
  }
}

export const defaultMediaStorageRegistry = new MediaStorageRegistry();
