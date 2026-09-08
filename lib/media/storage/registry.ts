import type { MediaStorage } from "./contracts";
import { MediaStorageError } from "./contracts";

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
