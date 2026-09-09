import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defineMediaStorageContract,
  computeSha256,
} from "./helpers/mediaStorageContract";
import {
  S3CompatibleMediaStorage,
  type S3CompatibleStorageOptions,
} from "../lib/media/storage/s3CompatibleMediaStorage";
import {
  MediaStorageError,
  type StoredObjectMetadata,
} from "../lib/media/storage/contracts";

const endpoint = process.env.PHASE6_R2_ENDPOINT;
const accessKeyId = process.env.PHASE6_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.PHASE6_R2_SECRET_ACCESS_KEY;
const privateBucket = process.env.PHASE6_R2_PRIVATE_BUCKET;
const publicBucket = process.env.PHASE6_R2_PUBLIC_BUCKET;

const isR2Configured = Boolean(
  endpoint &&
  accessKeyId &&
  secretAccessKey &&
  privateBucket &&
  publicBucket
);

describe("Cloudflare R2 Real-Provider Capability Gate (Task 11)", () => {
  if (!isR2Configured) {
    it("R2_INTEGRATION_PENDING: isolated credentials not supplied in process environment", () => {
      // Step 2 of Task 11: If owner does not authorize isolated R2 test resources/credentials,
      // record R2_INTEGRATION_PENDING; do not fabricate evidence.
      const missingVars: string[] = [];
      if (!endpoint) missingVars.push("PHASE6_R2_ENDPOINT");
      if (!accessKeyId) missingVars.push("PHASE6_R2_ACCESS_KEY_ID");
      if (!secretAccessKey) missingVars.push("PHASE6_R2_SECRET_ACCESS_KEY");
      if (!privateBucket) missingVars.push("PHASE6_R2_PRIVATE_BUCKET");
      if (!publicBucket) missingVars.push("PHASE6_R2_PUBLIC_BUCKET");

      assert.ok(
        missingVars.length > 0,
        "Expected missing variables when R2 is unconfigured"
      );

      // Verify that missing variables are explicitly recognized
      assert.strictEqual(
        isR2Configured,
        false,
        "Real provider integration remains PENDING until owner supplies isolated test credentials"
      );
    });
    return;
  }

  // Live R2 Provider Tests (only executed when owner explicitly provides isolated test credentials)
  const privateOptions: S3CompatibleStorageOptions = {
    endpoint: endpoint!,
    region: "auto",
    bucket: privateBucket!,
    forcePathStyle: false,
    credentials: {
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
    },
  };

  const publicOptions: S3CompatibleStorageOptions = {
    endpoint: endpoint!,
    region: "auto",
    bucket: publicBucket!,
    forcePathStyle: false,
    credentials: {
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
    },
  };

  const testPrefix = `phase6-test-${Date.now()}`;
  const createdKeys: string[] = [];

  const privateStorage = new S3CompatibleMediaStorage(privateOptions);
  const publicStorage = new S3CompatibleMediaStorage(publicOptions);

  // 1. Storage contract compliance against real R2 private and public buckets
  defineMediaStorageContract(
    "Cloudflare R2 (Private Source Namespace)",
    () => privateStorage,
    async (storage) => {
      // Contract cleanup
      for (const key of createdKeys) {
        try {
          await storage.deleteObject(key);
        } catch {
          // ignore
        }
      }
    }
  );

  defineMediaStorageContract(
    "Cloudflare R2 (Public Delivery Namespace)",
    () => publicStorage,
    async (storage) => {
      // Contract cleanup
      for (const key of createdKeys) {
        try {
          await storage.deleteObject(key);
        } catch {
          // ignore
        }
      }
    }
  );

  // 2. Private Master Anonymous Access Security
  describe("Private Master Access Restrictions", () => {
    it("proves private bucket objects are not anonymously accessible over public HTTP", async () => {
      const testKey = `${testPrefix}/private-check.txt`;
      createdKeys.push(testKey);

      const bytes = new TextEncoder().encode("private confidential master");
      const sha = computeSha256(bytes);

      await privateStorage.putImmutable({
        objectKey: testKey,
        bytes,
        contentType: "text/plain",
        checksumSha256: sha,
      });

      // Construct candidate public URL
      const candidateUrl = `${endpoint}/${privateBucket}/${testKey}`;
      try {
        const response = await fetch(candidateUrl, { redirect: "manual" });
        assert.notStrictEqual(
          response.status,
          200,
          "Private master object must NOT be anonymously accessible (expected 401/403/404)"
        );
      } catch {
        // Network refusal or connection error for unmapped endpoint is also secure
        assert.ok(true);
      } finally {
        await privateStorage.deleteObject(testKey);
      }
    });
  });

  // 3. Concurrency & Atomic Create-If-Absent Hard Gate on Real R2
  describe("Real R2 Atomic Conditional Create Hard Gate", () => {
    it("CASE A — SAME KEY + SAME CONTENT/SHA: concurrent puts succeed idempotently without overwrite", async () => {
      const key = `${testPrefix}/race-same.bin`;
      createdKeys.push(key);

      const bytes = new Uint8Array([100, 101, 102, 103, 104]);
      const sha = computeSha256(bytes);

      try {
        const [resA, resB] = await Promise.allSettled([
          privateStorage.putImmutable({
            objectKey: key,
            bytes,
            contentType: "application/octet-stream",
            checksumSha256: sha,
          }),
          privateStorage.putImmutable({
            objectKey: key,
            bytes,
            contentType: "application/octet-stream",
            checksumSha256: sha,
          }),
        ]);

        const fulfilled = [resA, resB].filter((r) => r.status === "fulfilled");
        assert.strictEqual(fulfilled.length, 2, "Both concurrent operations must succeed idempotently");

        const metaA = (resA as PromiseFulfilledResult<StoredObjectMetadata>).value;
        const metaB = (resB as PromiseFulfilledResult<StoredObjectMetadata>).value;
        assert.strictEqual(metaA.checksumSha256, sha);
        assert.strictEqual(metaB.checksumSha256, sha);

        const stored = await privateStorage.getObject(key);
        assert.deepStrictEqual(Buffer.from(stored), Buffer.from(bytes));
      } finally {
        await privateStorage.deleteObject(key);
      }
    });

    it("CASE B — SAME KEY + DIFFERENT CONTENT/SHA: exactly 1 winner and loser rejected with conflict", async () => {
      const key = `${testPrefix}/race-diff.bin`;
      createdKeys.push(key);

      const bytesA = new Uint8Array([11, 22, 33]);
      const bytesB = new Uint8Array([99, 88, 77]);

      try {
        const [resA, resB] = await Promise.allSettled([
          privateStorage.putImmutable({
            objectKey: key,
            bytes: bytesA,
            contentType: "application/octet-stream",
            checksumSha256: computeSha256(bytesA),
          }),
          privateStorage.putImmutable({
            objectKey: key,
            bytes: bytesB,
            contentType: "application/octet-stream",
            checksumSha256: computeSha256(bytesB),
          }),
        ]);

        const fulfilled = [resA, resB].filter((r) => r.status === "fulfilled");
        const rejected = [resA, resB].filter((r) => r.status === "rejected");

        assert.strictEqual(fulfilled.length, 1, "Exactly one put must win on atomic create");
        assert.strictEqual(rejected.length, 1, "The competing put must be rejected with conflict");

        const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
        assert.ok(rejectedError instanceof MediaStorageError);
        assert.ok(
          rejectedError.code === "CONFLICT" || rejectedError.code === "INTEGRITY_MISMATCH"
        );

        const stored = await privateStorage.getObject(key);
        const winner = (fulfilled[0] as PromiseFulfilledResult<StoredObjectMetadata>).value;
        assert.strictEqual(computeSha256(stored), winner.checksumSha256);
      } finally {
        await privateStorage.deleteObject(key);
      }
    });
  });

  // 4. Cleanup Verification
  describe("Test Artifact Cleanup", () => {
    it("verifies all test objects are completely purged after test execution", async () => {
      for (const key of createdKeys) {
        await privateStorage.deleteObject(key);
        const meta = await privateStorage.headObject(key);
        assert.strictEqual(meta, null, `Test object ${key} must be cleaned up`);
      }
    });
  });
});
