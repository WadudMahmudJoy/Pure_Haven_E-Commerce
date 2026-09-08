import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import {
  type MediaStorage,
  type PutImmutableInput,
  MediaStorageError,
} from "../../lib/media/storage/contracts";

export function computeSha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function defineMediaStorageContract(
  suiteName: string,
  factory: () => Promise<MediaStorage> | MediaStorage,
  cleanup?: (storage: MediaStorage) => Promise<void> | void
): void {
  describe(`MediaStorage Contract — ${suiteName}`, () => {
    let storage: MediaStorage;

    it("1. put absent object creates object and returns accurate metadata", async () => {
      storage = await factory();
      const bytes = new TextEncoder().encode("test payload 1");
      const sha = computeSha256(bytes);
      const input: PutImmutableInput = {
        objectKey: "test/obj-1.txt",
        bytes,
        contentType: "text/plain",
        checksumSha256: sha,
      };

      const result = await storage.putImmutable(input);
      assert.strictEqual(result.objectKey, "test/obj-1.txt");
      assert.strictEqual(result.byteSize, BigInt(bytes.byteLength));
      assert.strictEqual(result.contentType, "text/plain");
      assert.strictEqual(result.checksumSha256, sha);

      const fetched = await storage.getObject("test/obj-1.txt");
      assert.deepStrictEqual(Buffer.from(fetched), Buffer.from(bytes));
      if (cleanup) await cleanup(storage);
    });

    it("2. put same immutable identity with same content/checksum succeeds idempotently", async () => {
      storage = await factory();
      const bytes = new TextEncoder().encode("identical bytes");
      const sha = computeSha256(bytes);
      const input: PutImmutableInput = {
        objectKey: "test/idempotent.txt",
        bytes,
        contentType: "text/plain",
        checksumSha256: sha,
      };

      const first = await storage.putImmutable(input);
      const second = await storage.putImmutable(input);
      assert.strictEqual(first.objectKey, second.objectKey);
      assert.strictEqual(first.byteSize, second.byteSize);
      assert.strictEqual(first.checksumSha256, second.checksumSha256);
      if (cleanup) await cleanup(storage);
    });

    it("3. put same immutable identity with different content/checksum throws CONFLICT or INTEGRITY_MISMATCH without overwriting", async () => {
      storage = await factory();
      const bytesA = new TextEncoder().encode("original content");
      const shaA = computeSha256(bytesA);
      await storage.putImmutable({
        objectKey: "test/immutable-conflict.txt",
        bytes: bytesA,
        contentType: "text/plain",
        checksumSha256: shaA,
      });

      const bytesB = new TextEncoder().encode("different colliding content");
      const shaB = computeSha256(bytesB);

      let caught: MediaStorageError | null = null;
      try {
        await storage.putImmutable({
          objectKey: "test/immutable-conflict.txt",
          bytes: bytesB,
          contentType: "text/plain",
          checksumSha256: shaB,
        });
      } catch (err: unknown) {
        if (err instanceof MediaStorageError) {
          caught = err;
        } else {
          throw err;
        }
      }

      assert.ok(caught, "Conflicting putImmutable must reject with MediaStorageError");
      assert.ok(
        caught.code === "CONFLICT" || caught.code === "INTEGRITY_MISMATCH",
        `Expected error code CONFLICT or INTEGRITY_MISMATCH, got ${caught.code}`
      );

      // Verify original bytes were preserved and not overwritten
      const preserved = await storage.getObject("test/immutable-conflict.txt");
      assert.deepStrictEqual(Buffer.from(preserved), Buffer.from(bytesA), "Existing bytes must remain unchanged");
      if (cleanup) await cleanup(storage);
    });

    it("4. headObject returns exact expected metadata for existing object", async () => {
      storage = await factory();
      const bytes = new TextEncoder().encode("head test data");
      const sha = computeSha256(bytes);
      await storage.putImmutable({
        objectKey: "test/head-exists.txt",
        bytes,
        contentType: "text/plain",
        checksumSha256: sha,
      });

      const meta = await storage.headObject("test/head-exists.txt");
      assert.ok(meta, "headObject must return metadata for existing object");
      assert.strictEqual(meta.objectKey, "test/head-exists.txt");
      assert.strictEqual(meta.byteSize, BigInt(bytes.byteLength));
      assert.strictEqual(meta.contentType, "text/plain");
      assert.strictEqual(meta.checksumSha256, sha);
      if (cleanup) await cleanup(storage);
    });

    it("5. headObject returns null for missing object", async () => {
      storage = await factory();
      const meta = await storage.headObject("non/existent/key.txt");
      assert.strictEqual(meta, null, "headObject must return null for missing key");
      if (cleanup) await cleanup(storage);
    });

    it("6. getObject returns exact stored bytes for existing object", async () => {
      storage = await factory();
      const bytes = new Uint8Array([0x00, 0xff, 0x42, 0x13, 0x37]);
      const sha = computeSha256(bytes);
      await storage.putImmutable({
        objectKey: "test/binary.bin",
        bytes,
        contentType: "application/octet-stream",
        checksumSha256: sha,
      });

      const result = await storage.getObject("test/binary.bin");
      assert.deepStrictEqual(Buffer.from(result), Buffer.from(bytes));
      if (cleanup) await cleanup(storage);
    });

    it("7. getObject throws typed NOT_FOUND for missing object", async () => {
      storage = await factory();
      let caught: MediaStorageError | null = null;
      try {
        await storage.getObject("missing/object.txt");
      } catch (err: unknown) {
        if (err instanceof MediaStorageError) {
          caught = err;
        }
      }
      assert.ok(caught, "getObject on missing key must throw MediaStorageError");
      assert.strictEqual(caught.code, "NOT_FOUND");
      if (cleanup) await cleanup(storage);
    });

    it("8. deleteObject deletes existing object successfully", async () => {
      storage = await factory();
      const bytes = new TextEncoder().encode("delete me");
      await storage.putImmutable({
        objectKey: "test/to-delete.txt",
        bytes,
        contentType: "text/plain",
        checksumSha256: computeSha256(bytes),
      });

      await storage.deleteObject("test/to-delete.txt");
      const meta = await storage.headObject("test/to-delete.txt");
      assert.strictEqual(meta, null, "headObject must return null after deletion");
      if (cleanup) await cleanup(storage);
    });

    it("9. deleteObject on already missing object succeeds idempotently", async () => {
      storage = await factory();
      // Should not throw
      await storage.deleteObject("missing/already-deleted.txt");
      if (cleanup) await cleanup(storage);
    });

    it("10. input with corrupted checksum throws INTEGRITY_MISMATCH on putImmutable", async () => {
      storage = await factory();
      const bytes = new TextEncoder().encode("actual bytes");
      const corruptedSha = "0000000000000000000000000000000000000000000000000000000000000000";

      let caught: MediaStorageError | null = null;
      try {
        await storage.putImmutable({
          objectKey: "test/corrupted.txt",
          bytes,
          contentType: "text/plain",
          checksumSha256: corruptedSha,
        });
      } catch (err: unknown) {
        if (err instanceof MediaStorageError) {
          caught = err;
        }
      }
      assert.ok(caught, "Corrupted checksum must reject with MediaStorageError");
      assert.strictEqual(caught.code, "INTEGRITY_MISMATCH");
      if (cleanup) await cleanup(storage);
    });
  });
}
