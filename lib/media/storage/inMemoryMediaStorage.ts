import * as crypto from "node:crypto";
import {
  type MediaStorage,
  type PutImmutableInput,
  type StoredObjectMetadata,
  MediaStorageError,
} from "./contracts";

function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

type StoredRecord = {
  bytes: Uint8Array;
  metadata: StoredObjectMetadata;
};

export class InMemoryMediaStorage implements MediaStorage {
  private readonly objects = new Map<string, StoredRecord>();

  async putImmutable(input: PutImmutableInput): Promise<StoredObjectMetadata> {
    const actualSha = sha256(input.bytes);
    if (actualSha !== input.checksumSha256) {
      throw new MediaStorageError("INTEGRITY_MISMATCH", "checksum mismatch");
    }

    const existing = this.objects.get(input.objectKey);
    if (existing) {
      if (existing.metadata.checksumSha256 !== actualSha) {
        throw new MediaStorageError("INTEGRITY_MISMATCH", "immutable key conflict");
      }
      return existing.metadata;
    }

    const metadata: StoredObjectMetadata = {
      objectKey: input.objectKey,
      byteSize: BigInt(input.bytes.byteLength),
      contentType: input.contentType,
      checksumSha256: actualSha,
      ...(input.cacheControl ? { cacheControl: input.cacheControl } : {}),
    };

    this.objects.set(input.objectKey, {
      bytes: new Uint8Array(input.bytes),
      metadata,
    });

    return metadata;
  }

  async headObject(objectKey: string): Promise<StoredObjectMetadata | null> {
    const record = this.objects.get(objectKey);
    return record ? record.metadata : null;
  }

  async getObject(objectKey: string): Promise<Uint8Array> {
    const record = this.objects.get(objectKey);
    if (!record) {
      throw new MediaStorageError("NOT_FOUND", `Object not found: ${objectKey}`);
    }
    return new Uint8Array(record.bytes);
  }

  async deleteObject(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
}

