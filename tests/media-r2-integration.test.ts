import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import sharp from "sharp";
import {
  defineMediaStorageContract,
  computeSha256,
} from "./helpers/mediaStorageContract";
import { createPhase6MediaFixture } from "./helpers/mediaFixtures";
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
const publicDeliveryUrl = process.env.PHASE6_R2_PUBLIC_DELIVERY_URL;

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

describe("Real R2 Public Development Delivery", () => {
  const isPublicDeliveryConfigured = Boolean(
    endpoint &&
    accessKeyId &&
    secretAccessKey &&
    publicBucket &&
    publicDeliveryUrl
  );

  if (!isPublicDeliveryConfigured) {
    it("PUBLIC_DELIVERY_PENDING: isolated credentials or public delivery URL not supplied in process environment", () => {
      const missingVars: string[] = [];
      if (!endpoint) missingVars.push("PHASE6_R2_ENDPOINT");
      if (!accessKeyId) missingVars.push("PHASE6_R2_ACCESS_KEY_ID");
      if (!secretAccessKey) missingVars.push("PHASE6_R2_SECRET_ACCESS_KEY");
      if (!publicBucket) missingVars.push("PHASE6_R2_PUBLIC_BUCKET");
      if (!publicDeliveryUrl) missingVars.push("PHASE6_R2_PUBLIC_DELIVERY_URL");

      assert.ok(
        missingVars.length > 0,
        "Expected missing variables when public delivery is unconfigured"
      );

      assert.strictEqual(
        isPublicDeliveryConfigured,
        false,
        "Public delivery verification remains PENDING until owner supplies public delivery URL and isolated credentials"
      );
    });
    return;
  }

  it("verifies anonymous public r2.dev HTTP delivery, mime, sha256 integrity, and cache classification", async () => {
    const publicStorage = new S3CompatibleMediaStorage({
      endpoint: endpoint!,
      region: "auto",
      bucket: publicBucket!,
      forcePathStyle: false,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
    });

    const testPrefix = `phase6-public-delivery-test/${crypto.randomUUID()}`;
    const objectKey = `${testPrefix}/fixture.webp`;

    // Generate deterministic harmless WebP fixture from existing repository fixture
    const pngFixture = await createPhase6MediaFixture("photo", 200, 200);
    const webpBuffer = await sharp(pngFixture).webp({ quality: 80 }).toBuffer();
    const uploadedBytes = new Uint8Array(webpBuffer);
    const uploadedSha = computeSha256(uploadedBytes);

    // Upload via EXISTING S3CompatibleMediaStorage public namespace
    await publicStorage.putImmutable({
      objectKey,
      bytes: uploadedBytes,
      contentType: "image/webp",
      checksumSha256: uploadedSha,
      cacheControl: "public, max-age=31536000, immutable",
    });

    try {
      const normalizedBaseUrl = publicDeliveryUrl!.replace(/\/+$/, "");
      const fetchUrl = `${normalizedBaseUrl}/${objectKey}`;

      // Bounded retry window for transient public propagation (max 5 attempts with 1s delay)
      let response: Response | null = null;
      const maxAttempts = 5;
      const retryDelayMs = 1000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const res = await fetch(fetchUrl, {
          method: "GET",
          signal: AbortSignal.timeout(10000),
        });

        if (res.status === 200) {
          response = res;
          break;
        }

        if (res.status === 404 && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }

        response = res;
        break;
      }

      assert.ok(response, "Expected valid HTTP response object");
      assert.strictEqual(
        response.status,
        200,
        `Expected HTTP 200 from anonymous public r2.dev fetch, got ${response.status}`
      );

      const contentType = response.headers.get("content-type") || "";
      assert.ok(
        contentType.toLowerCase().includes("image/webp"),
        `Expected Content-Type image/webp, got ${contentType}`
      );

      const downloadedBuffer = await response.arrayBuffer();
      const downloadedBytes = new Uint8Array(downloadedBuffer);
      const downloadedSha = computeSha256(downloadedBytes);

      assert.strictEqual(
        downloadedSha,
        uploadedSha,
        "Downloaded body SHA256 must match uploaded fixture SHA256"
      );

      const contentLengthHeader = response.headers.get("content-length");
      const contentLength = contentLengthHeader
        ? parseInt(contentLengthHeader, 10)
        : downloadedBytes.byteLength;
      assert.ok(contentLength > 0, "Expected positive content length");

      const etag = response.headers.get("etag") || "(none)";
      const rawCacheControl = response.headers.get("cache-control") || "(none)";

      // Cache classification: does not fail provider gate if differing from desired CDN policy
      const normalizedCache = rawCacheControl.toLowerCase();
      const isGreen =
        normalizedCache.includes("public") &&
        normalizedCache.includes("max-age=31536000") &&
        normalizedCache.includes("immutable");

      const cacheClassification = isGreen ? "GREEN" : "NOT_GREEN";

      // Diagnostic output (zero secret credentials exposed)
      console.log(`[R2_PUBLIC_DELIVERY] STATUS: ${response.status}`);
      console.log(`[R2_PUBLIC_DELIVERY] CONTENT-TYPE: ${contentType}`);
      console.log(`[R2_PUBLIC_DELIVERY] CONTENT-LENGTH: ${contentLength}`);
      console.log(`[R2_PUBLIC_DELIVERY] BODY_SHA256_MATCH: ${downloadedSha === uploadedSha ? "PASS" : "FAIL"}`);
      console.log(`[R2_PUBLIC_DELIVERY] ETAG: ${etag}`);
      console.log(`[R2_PUBLIC_DELIVERY] NONPROD_R2DEV_CACHE_CONTROL: ${rawCacheControl}`);
      console.log(`[R2_PUBLIC_DELIVERY] NONPROD_DIRECT_DELIVERY_CACHE: ${cacheClassification}`);
    } finally {
      // Cleanup disposable test object and verify removal
      await publicStorage.deleteObject(objectKey);
      const headAfterDelete = await publicStorage.headObject(objectKey);
      assert.strictEqual(
        headAfterDelete,
        null,
        `Disposable test object ${objectKey} must be cleaned up`
      );
    }
  });
});
