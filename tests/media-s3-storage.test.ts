import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  defineMediaStorageContract,
  computeSha256,
} from "./helpers/mediaStorageContract";
import {
  S3CompatibleMediaStorage,
  type S3CompatibleStorageOptions,
  type AtomicS3Client,
} from "../lib/media/storage/s3CompatibleMediaStorage";
import {
  MediaStorageError,
  type PutImmutableInput,
  type StoredObjectMetadata,
} from "../lib/media/storage/contracts";

import type { PutObjectCommandInput } from "@aws-sdk/client-s3";

type StoredS3Item = {
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
  metadata: Record<string, string>;
  contentLength: number;
};

class FakeAtomicS3Client implements AtomicS3Client {
  public readonly objects = new Map<string, StoredS3Item>();
  public lastPutInput: PutObjectCommandInput | null = null;
  public unconditionalPutCount = 0;
  public conditionalPutCount = 0;
  public sendCallCount = 0;
  public injectedError: Error | null = null;

  async send<TOutput = unknown>(command: unknown): Promise<TOutput> {
    this.sendCallCount++;
    if (this.injectedError) {
      const err = this.injectedError;
      this.injectedError = null;
      throw err;
    }

    const cmd = command as { input?: Record<string, unknown>; constructor?: { name?: string } };
    const name = cmd.constructor?.name || "";
    const input = cmd.input as (PutObjectCommandInput & { Key?: string; Bucket?: string }) | undefined;

    if (command instanceof PutObjectCommand || name === "PutObjectCommand") {
      this.lastPutInput = input ?? null;
      if (!input?.IfNoneMatch) {
        this.unconditionalPutCount++;
      } else {
        this.conditionalPutCount++;
      }

      const key = `${input?.Bucket}/${input?.Key}`;
      if (input?.IfNoneMatch === "*" && this.objects.has(key)) {
        const err = new Error("At least one of the pre-conditions you specified did not hold");
        err.name = "PreconditionFailed";
        (err as unknown as { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode: 412 };
        throw err;
      }

      const rawBody = input?.Body;
      let bodyBytes: Uint8Array;
      if (rawBody instanceof Uint8Array) {
        bodyBytes = rawBody;
      } else if (typeof rawBody === "string") {
        bodyBytes = new TextEncoder().encode(rawBody);
      } else if (Buffer.isBuffer(rawBody)) {
        bodyBytes = new Uint8Array(rawBody);
      } else {
        bodyBytes = new Uint8Array(0);
      }
      this.objects.set(key, {
        body: new Uint8Array(bodyBytes),
        contentType: input?.ContentType || "application/octet-stream",
        cacheControl: input?.CacheControl,
        metadata: input?.Metadata || {},
        contentLength: bodyBytes.byteLength,
      });

      return {
        $metadata: { httpStatusCode: 200 },
        ETag: '"simulated-etag"',
      } as unknown as TOutput;
    }

    if (command instanceof HeadObjectCommand || name === "HeadObjectCommand") {
      const key = `${input?.Bucket}/${input?.Key}`;
      const item = this.objects.get(key);
      if (!item) {
        const err = new Error("Not Found");
        err.name = "NotFound";
        (err as unknown as { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return {
        $metadata: { httpStatusCode: 200 },
        ContentLength: item.contentLength,
        ContentType: item.contentType,
        CacheControl: item.cacheControl,
        Metadata: item.metadata,
        ETag: '"simulated-etag"',
      } as unknown as TOutput;
    }

    if (command instanceof GetObjectCommand || name === "GetObjectCommand") {
      const key = `${input?.Bucket}/${input?.Key}`;
      const item = this.objects.get(key);
      if (!item) {
        const err = new Error("The specified key does not exist.");
        err.name = "NoSuchKey";
        (err as unknown as { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return {
        $metadata: { httpStatusCode: 200 },
        Body: {
          transformToByteArray: async () => item.body,
        },
        ContentLength: item.contentLength,
        ContentType: item.contentType,
        Metadata: item.metadata,
      } as unknown as TOutput;
    }

    if (command instanceof DeleteObjectCommand || name === "DeleteObjectCommand") {
      const key = `${input?.Bucket}/${input?.Key}`;
      this.objects.delete(key);
      return {
        $metadata: { httpStatusCode: 204 },
      } as unknown as TOutput;
    }

    throw new Error(`Unsupported fake command: ${name}`);
  }
}

describe("S3CompatibleMediaStorage & Atomic Create Semantics", () => {
  const options: S3CompatibleStorageOptions = {
    region: "auto",
    bucket: "test-bucket",
    endpoint: "https://example-storage.local",
    credentials: {
      accessKeyId: "test-key-id",
      secretAccessKey: "test-secret-key",
    },
  };

  // 1. Shared MediaStorage contract compliance using the S3 adapter with fake client
  defineMediaStorageContract("S3CompatibleMediaStorage (Adapter)", () => {
    const fake = new FakeAtomicS3Client();
    return new S3CompatibleMediaStorage(options, fake);
  });

  // 2. Atomic conditional create verification
  describe("Atomic Conditional Create", () => {
    let fake: FakeAtomicS3Client;
    let storage: S3CompatibleMediaStorage;

    beforeEach(() => {
      fake = new FakeAtomicS3Client();
      storage = new S3CompatibleMediaStorage(options, fake);
    });

    it("sends conditional IfNoneMatch: * on initial putImmutable and never issues unconditional PUT", async () => {
      const bytes = new TextEncoder().encode("content A");
      const sha = computeSha256(bytes);
      await storage.putImmutable({
        objectKey: "test/atomic.txt",
        bytes,
        contentType: "text/plain",
        checksumSha256: sha,
      });

      assert.strictEqual(fake.lastPutInput?.IfNoneMatch, "*", "IfNoneMatch must be set to *");
      assert.strictEqual(fake.unconditionalPutCount, 0, "No unconditional PUT is allowed");
      assert.strictEqual(fake.conditionalPutCount, 1, "Conditional PUT count must be 1");
    });

    it("recovers idempotently from PreconditionFailed if existing object matches SHA-256 and byteSize", async () => {
      const bytes = new TextEncoder().encode("same content");
      const sha = computeSha256(bytes);
      const input: PutImmutableInput = {
        objectKey: "test/idempotent.txt",
        bytes,
        contentType: "text/plain",
        checksumSha256: sha,
      };

      const first = await storage.putImmutable(input);
      const second = await storage.putImmutable(input);

      assert.strictEqual(second.objectKey, first.objectKey);
      assert.strictEqual(second.checksumSha256, first.checksumSha256);
      assert.strictEqual(second.byteSize, first.byteSize);
      assert.strictEqual(fake.unconditionalPutCount, 0, "Must never overwrite existing object");
    });

    it("rejects with CONFLICT/INTEGRITY_MISMATCH when PreconditionFailed reveals different content and never overwrites", async () => {
      const bytesA = new TextEncoder().encode("original content");
      const shaA = computeSha256(bytesA);
      await storage.putImmutable({
        objectKey: "test/conflict.txt",
        bytes: bytesA,
        contentType: "text/plain",
        checksumSha256: shaA,
      });

      const bytesB = new TextEncoder().encode("colliding content");
      const shaB = computeSha256(bytesB);

      let caught: MediaStorageError | null = null;
      try {
        await storage.putImmutable({
          objectKey: "test/conflict.txt",
          bytes: bytesB,
          contentType: "text/plain",
          checksumSha256: shaB,
        });
      } catch (err: unknown) {
        if (err instanceof MediaStorageError) caught = err;
      }

      assert.ok(caught, "Conflicting putImmutable must reject");
      assert.ok(
        caught.code === "CONFLICT" || caught.code === "INTEGRITY_MISMATCH",
        `Expected CONFLICT or INTEGRITY_MISMATCH, got ${caught.code}`
      );
      assert.strictEqual(fake.unconditionalPutCount, 0, "Must never overwrite on conflict");

      // Verify original bytes remain intact
      const stored = await storage.getObject("test/conflict.txt");
      assert.deepStrictEqual(Buffer.from(stored), Buffer.from(bytesA));
    });

    it("pre-verifies SHA-256 before making any S3 client calls", async () => {
      const bytes = new TextEncoder().encode("unaltered bytes");
      const corruptedSha = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

      let caught: MediaStorageError | null = null;
      try {
        await storage.putImmutable({
          objectKey: "test/bad-sha.txt",
          bytes,
          contentType: "text/plain",
          checksumSha256: corruptedSha,
        });
      } catch (err: unknown) {
        if (err instanceof MediaStorageError) caught = err;
      }

      assert.ok(caught);
      assert.strictEqual(caught.code, "INTEGRITY_MISMATCH");
      assert.strictEqual(fake.sendCallCount, 0, "Must make zero network/client calls on checksum mismatch");
    });
  });

  // 3. Error mapping and information leakage prevention
  describe("Error Mapping & Information Leakage Prevention", () => {
    let fake: FakeAtomicS3Client;
    let storage: S3CompatibleMediaStorage;

    beforeEach(() => {
      fake = new FakeAtomicS3Client();
      storage = new S3CompatibleMediaStorage(options, fake);
    });

    it("maps AccessDenied to AUTHORIZATION without leaking credentials or bucket in message", async () => {
      const err = Object.assign(new Error("Access Denied to secret-bucket"), {
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
      });
      fake.injectedError = err;

      await assert.rejects(
        storage.headObject("private/obj.txt"),
        (e: unknown) => {
          assert.ok(e instanceof MediaStorageError);
          assert.strictEqual(e.code, "AUTHORIZATION");
          assert.strictEqual(e.message.includes("secret-bucket"), false);
          assert.strictEqual(e.message.includes("test-secret-key"), false);
          return true;
        }
      );
    });

    it("maps SlowDown / TooManyRequests to RATE_LIMITED", async () => {
      const err = Object.assign(new Error("Slow Down"), {
        name: "SlowDown",
        $metadata: { httpStatusCode: 429 },
      });
      fake.injectedError = err;

      await assert.rejects(
        storage.headObject("private/obj.txt"),
        (e: unknown) => e instanceof MediaStorageError && e.code === "RATE_LIMITED"
      );
    });

    it("maps RequestTimeout to TIMEOUT", async () => {
      const err = Object.assign(new Error("Connection timeout"), {
        name: "TimeoutError",
      });
      fake.injectedError = err;

      await assert.rejects(
        storage.headObject("private/obj.txt"),
        (e: unknown) => e instanceof MediaStorageError && e.code === "TIMEOUT"
      );
    });
  });

  // 4. Concurrency race safety
  describe("Concurrency Race Safety", () => {
    it("CASE A — SAME KEY + SAME CONTENT/SHA: concurrent puts resolve with both operations fulfilling idempotently and zero overwrites", async () => {
      const fake = new FakeAtomicS3Client();
      const storage = new S3CompatibleMediaStorage(options, fake);
      const key = "race/concurrent-same-content.bin";

      const bytes = new Uint8Array([10, 20, 30, 40, 50]);
      const sha = computeSha256(bytes);

      const [resA, resB] = await Promise.allSettled([
        storage.putImmutable({
          objectKey: key,
          bytes,
          contentType: "application/octet-stream",
          checksumSha256: sha,
        }),
        storage.putImmutable({
          objectKey: key,
          bytes,
          contentType: "application/octet-stream",
          checksumSha256: sha,
        }),
      ]);

      const fulfilled = [resA, resB].filter((r) => r.status === "fulfilled");
      const rejected = [resA, resB].filter((r) => r.status === "rejected");

      assert.strictEqual(fulfilled.length, 2, "Both concurrent operations must succeed");
      assert.strictEqual(rejected.length, 0, "Neither operation should reject");

      const metaA = (resA as PromiseFulfilledResult<StoredObjectMetadata>).value;
      const metaB = (resB as PromiseFulfilledResult<StoredObjectMetadata>).value;
      assert.strictEqual(metaA.objectKey, key);
      assert.strictEqual(metaB.objectKey, key);
      assert.strictEqual(metaA.checksumSha256, sha);
      assert.strictEqual(metaB.checksumSha256, sha);
      assert.strictEqual(metaA.byteSize, BigInt(bytes.byteLength));
      assert.strictEqual(metaB.byteSize, BigInt(bytes.byteLength));

      // Assert no unconditional overwrite occurred
      assert.strictEqual(fake.unconditionalPutCount, 0, "No unconditional overwrite occurred");

      // Verify stored bytes match expected
      const stored = await storage.getObject(key);
      assert.deepStrictEqual(Buffer.from(stored), Buffer.from(bytes));
    });

    it("CASE B — SAME KEY + DIFFERENT CONTENT/SHA: concurrent puts resolve with 1 winner and loser rejected with conflict", async () => {
      const fake = new FakeAtomicS3Client();
      const storage = new S3CompatibleMediaStorage(options, fake);
      const key = "race/concurrent-diff-content.bin";

      const bytesA = new Uint8Array([1, 3, 5, 7, 9]);
      const bytesB = new Uint8Array([2, 4, 6, 8, 10]);

      const [resA, resB] = await Promise.allSettled([
        storage.putImmutable({
          objectKey: key,
          bytes: bytesA,
          contentType: "application/octet-stream",
          checksumSha256: computeSha256(bytesA),
        }),
        storage.putImmutable({
          objectKey: key,
          bytes: bytesB,
          contentType: "application/octet-stream",
          checksumSha256: computeSha256(bytesB),
        }),
      ]);

      const fulfilled = [resA, resB].filter((r) => r.status === "fulfilled");
      const rejected = [resA, resB].filter((r) => r.status === "rejected");

      assert.strictEqual(fulfilled.length, 1, "Exactly one put must win");
      assert.strictEqual(rejected.length, 1, "The competing put must be rejected");

      const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(rejectedError instanceof MediaStorageError);
      assert.ok(
        rejectedError.code === "CONFLICT" || rejectedError.code === "INTEGRITY_MISMATCH"
      );

      const stored = await storage.getObject(key);
      const winner = (fulfilled[0] as PromiseFulfilledResult<StoredObjectMetadata>).value;
      assert.strictEqual(computeSha256(stored), winner.checksumSha256);
      assert.strictEqual(fake.unconditionalPutCount, 0, "No unconditional overwrite occurred");
    });
  });
});
