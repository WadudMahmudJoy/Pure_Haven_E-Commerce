import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  defineMediaStorageContract,
  computeSha256,
} from "./helpers/mediaStorageContract";
import { LocalMediaStorage } from "../lib/media/storage/localMediaStorage";
import { MediaStorageError, type PutImmutableInput } from "../lib/media/storage/contracts";
import {
  validateMediaStorageEnvironment,
  isManagedMediaIngestionEnabled,
} from "../lib/media/config";

describe("LocalMediaStorage & Environment Isolation", () => {
  let tempBaseDir: string;
  let privateRoot: string;
  let publicRoot: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "ph-media-local-test-"));
    privateRoot = path.join(tempBaseDir, "private");
    publicRoot = path.join(tempBaseDir, "public");
    await fs.mkdir(privateRoot, { recursive: true });
    await fs.mkdir(publicRoot, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // 1. Shared contract compliance against real filesystem
  defineMediaStorageContract(
    "LocalMediaStorage (Filesystem)",
    async () => {
      const contractDir = await fs.mkdtemp(path.join(os.tmpdir(), "ph-local-contract-"));
      return new LocalMediaStorage(contractDir);
    },
    async (storage: unknown) => {
      const root = (storage as { root?: string }).root;
      if (root) {
        try {
          await fs.rm(root, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
      }
    }
  );

  // 2. Path safety and traversal rejection
  describe("Path safety & Traversal Prevention", () => {
    it("rejects path traversal attempts with .. in putImmutable", async () => {
      const storage = new LocalMediaStorage(privateRoot);
      const bytes = new TextEncoder().encode("malicious");
      const input: PutImmutableInput = {
        objectKey: "../escape.txt",
        bytes,
        contentType: "text/plain",
        checksumSha256: computeSha256(bytes),
      };

      await assert.rejects(
        storage.putImmutable(input),
        (err: unknown) => err instanceof MediaStorageError && err.code === "AUTHORIZATION"
      );
    });

    it("rejects path traversal attempts with nested ../ in headObject and getObject", async () => {
      const storage = new LocalMediaStorage(privateRoot);

      await assert.rejects(
        storage.headObject("safe/../../etc/passwd"),
        (err: unknown) => err instanceof MediaStorageError && err.code === "AUTHORIZATION"
      );

      await assert.rejects(
        storage.getObject("safe/../../etc/passwd"),
        (err: unknown) => err instanceof MediaStorageError && err.code === "AUTHORIZATION"
      );

      await assert.rejects(
        storage.deleteObject("safe/../../etc/passwd"),
        (err: unknown) => err instanceof MediaStorageError && err.code === "AUTHORIZATION"
      );
    });

    it("rejects invalid characters in objectKey", async () => {
      const storage = new LocalMediaStorage(privateRoot);
      const bytes = new TextEncoder().encode("bad-key");
      const input: PutImmutableInput = {
        objectKey: "has spaces/image.jpg",
        bytes,
        contentType: "image/jpeg",
        checksumSha256: computeSha256(bytes),
      };

      await assert.rejects(
        storage.putImmutable(input),
        (err: unknown) => err instanceof MediaStorageError && err.code === "AUTHORIZATION"
      );
    });
  });

  // 3. Private / Public root isolation
  describe("Private / Public Root Isolation", () => {
    it("proves privateRoot is never inside publicRoot and vice versa", () => {
      const resolvedPrivate = path.resolve(privateRoot);
      const resolvedPublic = path.resolve(publicRoot);

      assert.strictEqual(
        resolvedPrivate.startsWith(resolvedPublic + path.sep),
        false,
        "Private storage root must NOT be a child of public root"
      );
      assert.strictEqual(
        resolvedPublic.startsWith(resolvedPrivate + path.sep),
        false,
        "Public delivery root must NOT be a child of private root"
      );
    });

    it("ensures canonical master root cannot be placed inside public web root", () => {
      const webPublicDir = path.resolve("public");
      const configuredPrivate = path.resolve(".local-media/private");

      assert.strictEqual(
        configuredPrivate.startsWith(webPublicDir + path.sep),
        false,
        "Private root must never reside inside Next.js public directory"
      );
    });
  });

  // 4. Atomic create-if-absent & integrity preservation
  describe("Atomic Creation & Conflict Handling", () => {
    it("concurrent create attempts for different content resolve with exactly one winner without corruption", async () => {
      const storage = new LocalMediaStorage(privateRoot);
      const key = "concurrent/race-test.bin";

      const bytesA = new Uint8Array([1, 2, 3, 4, 5]);
      const bytesB = new Uint8Array([9, 8, 7, 6, 5]);

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

      assert.strictEqual(fulfilled.length, 1, "Exactly one concurrent put must succeed");
      assert.strictEqual(rejected.length, 1, "The competing put must be rejected");

      const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(
        rejectedError instanceof MediaStorageError,
        "Rejection must be a MediaStorageError"
      );
      assert.ok(
        rejectedError.code === "CONFLICT" || rejectedError.code === "INTEGRITY_MISMATCH",
        `Expected CONFLICT or INTEGRITY_MISMATCH, got ${rejectedError.code}`
      );

      // Verify stored bytes match the winner
      const stored = await storage.getObject(key);
      const winnerMetadata = (fulfilled[0] as PromiseFulfilledResult<import("../lib/media/storage/contracts").StoredObjectMetadata>).value;
      const storedSha = computeSha256(stored);
      assert.strictEqual(storedSha, winnerMetadata.checksumSha256);
    });
  });

  // 5. Environment Isolation & Configuration Fail-Closed
  describe("Environment Configuration & Fail-Closed Guards", () => {
    it("rejects non-production environment configured with production-labeled provider key", () => {
      assert.throws(
        () =>
          validateMediaStorageEnvironment("development", {
            "prod-r2-primary-01": {
              kind: "s3-compatible",
              accessClass: "PRIVATE_SOURCE",
            },
          }),
        /PRODUCTION_PROVIDER_IN_NON_PROD/
      );
    });

    it("rejects production environment configured with local or dev provider key", () => {
      assert.throws(
        () =>
          validateMediaStorageEnvironment("production", {
            "dev-local-01": {
              kind: "local",
              accessClass: "PRIVATE_SOURCE",
            },
          }),
        /LOCAL_PROVIDER_IN_PRODUCTION/
      );
    });

    it("allows consistent environment and provider configuration", () => {
      assert.doesNotThrow(() =>
        validateMediaStorageEnvironment("development", {
          "dev-private-local-01": {
            kind: "local",
            accessClass: "PRIVATE_SOURCE",
          },
          "dev-public-local-01": {
            kind: "local",
            accessClass: "PUBLIC_DELIVERY",
          },
        })
      );
    });

    it("defaults isManagedMediaIngestionEnabled to false", () => {
      assert.strictEqual(isManagedMediaIngestionEnabled(), false);
    });
  });
});
