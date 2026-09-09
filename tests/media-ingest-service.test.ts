import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyAndGetLocalDisposableDatabase } from "./helpers/disposableDbGuard";
import { PrismaMediaRepository } from "../lib/media/mediaRepository";
import {
  DefaultMediaIngestService,
  type StartProductImageIngestInput,
} from "../lib/media/mediaIngestService";
import { InMemoryMediaStorage } from "../lib/media/storage/inMemoryMediaStorage";
import { PRODUCT_IMAGE_PROFILE_V1, hashProcessingProfile } from "../lib/media/processingProfile";
import type { PrismaClient } from "../generated/prisma/client";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Task 15: Durable ManagedMedia Ingestion & Private Staging", () => {
  let prisma: PrismaClient;
  let repository: PrismaMediaRepository;
  let privateStorage: InMemoryMediaStorage;
  let service: DefaultMediaIngestService;

  const actorScope = "admin-test-actor-uuid-123";
  const bytesA = new Uint8Array(Buffer.from("dummy-image-payload-a-content"));
  const bytesB = new Uint8Array(Buffer.from("dummy-image-payload-b-different-content"));

  before(async () => {
    const ctx = verifyAndGetLocalDisposableDatabase();
    assert.ok(
      ["127.0.0.1", "localhost"].includes(ctx.redacted.host),
      "Safety violation: Target must be local"
    );
    assert.equal(ctx.redacted.port, 55439, "Target must be on expected port 55439");

    await ctx.ensurePhase6Schema();
    prisma = ctx.createPrisma();
    await prisma.$connect();

    repository = new PrismaMediaRepository(prisma);
    privateStorage = new InMemoryMediaStorage();
    service = new DefaultMediaIngestService(
      repository,
      privateStorage,
      "local-dev-staging",
      PRODUCT_IMAGE_PROFILE_V1
    );
  });

  after(async () => {
    if (prisma) {
      // Clean up records created by this test run
      await prisma.mediaObject.deleteMany({});
      await prisma.mediaProcessingRun.deleteMany({});
      await prisma.productImage.deleteMany({
        where: { managedMedia: { ingestActorScope: actorScope } },
      });
      await prisma.managedMedia.deleteMany({
        where: { ingestActorScope: actorScope },
      });
      await prisma.$disconnect();
    }
  });

  function makeInput(key: string, bytes: Uint8Array, filename = "test.jpg"): StartProductImageIngestInput {
    return {
      actorScope,
      idempotencyKey: key,
      bytes,
      declaredMimeType: "image/jpeg",
      originalFilename: filename,
    };
  }

  it("allocates ManagedMedia in PENDING state with deterministic staging and PRESENT state", async () => {
    const key = `key-initial-alloc-${Date.now()}`;
    const result = await service.startProductImageIngest(makeInput(key, bytesA, "upload.jpg"));

    assert.ok(result.mediaId, "Must return mediaId");
    assert.equal(result.lifecycleState, "PENDING");
    assert.equal(result.attachable, false);

    // Verify DB record
    const media = await prisma.managedMedia.findUnique({
      where: { id: result.mediaId },
      include: { processingRuns: true },
    });

    assert.ok(media, "ManagedMedia record must exist");
    assert.equal(media.lifecycleState, "PENDING");
    assert.equal(media.stagingState, "PRESENT");
    assert.equal(media.stagingProviderKey, "local-dev-staging");
    assert.equal(media.stagingObjectKey, `staging/${result.mediaId}/source`);
    assert.equal(media.ingestSha256, sha256(bytesA));
    assert.equal(media.ingestByteSize, BigInt(bytesA.byteLength));
    assert.equal(media.originalFilename, "upload.jpg");

    // Verify initial MediaProcessingRun was created
    assert.equal(media.processingRuns.length, 1);
    const initialRun = media.processingRuns[0];
    assert.equal(initialRun.state, "PENDING");
    assert.equal(initialRun.profileVersion, PRODUCT_IMAGE_PROFILE_V1.version);

    // Verify physical staging object in storage
    const head = await privateStorage.headObject(media.stagingObjectKey);
    assert.ok(head, "Staging object must exist in storage");
    assert.equal(head.checksumSha256, sha256(bytesA));
  });

  it("handles idempotent resume: same key + same bytes returns existing mediaId", async () => {
    const key = `key-idempotent-resume-${Date.now()}`;
    const first = await service.startProductImageIngest(makeInput(key, bytesA));
    const second = await service.startProductImageIngest(makeInput(key, bytesA));

    assert.equal(first.mediaId, second.mediaId);
    assert.equal(second.lifecycleState, "PENDING");

    // Ensure only 1 record exists in DB
    const count = await prisma.managedMedia.count({
      where: { ingestActorScope: actorScope, ingestIdempotencyKey: key },
    });
    assert.equal(count, 1);
  });

  it("rejects conflict: same key + different bytes throws CONFLICT", async () => {
    const key = `key-conflict-${Date.now()}`;
    const first = await service.startProductImageIngest(makeInput(key, bytesA));
    assert.ok(first.mediaId);

    await assert.rejects(
      () => service.startProductImageIngest(makeInput(key, bytesB)),
      /CONFLICT/
    );
  });

  it("handles concurrent same-key + same-bytes requests and resolves to exactly one identity", async () => {
    const key = `key-concurrent-${Date.now()}`;
    const [res1, res2] = await Promise.all([
      service.startProductImageIngest(makeInput(key, bytesA)),
      service.startProductImageIngest(makeInput(key, bytesA)),
    ]);

    assert.equal(res1.mediaId, res2.mediaId);

    const count = await prisma.managedMedia.count({
      where: { ingestActorScope: actorScope, ingestIdempotencyKey: key },
    });
    assert.equal(count, 1);
  });

  it("recovers from simulated crash between staging write and PRESENT state", async () => {
    const key = `key-crash-recovery-${Date.now()}`;
    const initial = await service.startProductImageIngest(makeInput(key, bytesA));

    // Simulate crash: DB left at ALLOCATED while physical staging exists
    await prisma.managedMedia.update({
      where: { id: initial.mediaId },
      data: { stagingState: "ALLOCATED" },
    });

    // Subsequent call with same key must detect intact staging and reconcile to PRESENT
    const recovered = await service.startProductImageIngest(makeInput(key, bytesA));
    assert.equal(recovered.mediaId, initial.mediaId);

    const media = await prisma.managedMedia.findUnique({
      where: { id: initial.mediaId },
    });
    assert.equal(media?.stagingState, "PRESENT");
  });

  it("re-queues retryable FAILED initial ingest with same key and intact staging to PENDING", async () => {
    const key = `key-retry-failed-${Date.now()}`;
    const initial = await service.startProductImageIngest(makeInput(key, bytesA));

    // Simulate a retryable failure (e.g. storage timeout during initial run)
    await prisma.managedMedia.update({
      where: { id: initial.mediaId },
      data: {
        lifecycleState: "FAILED",
        failurePhase: "STORAGE",
        failureCode: "MEDIA_STORAGE_UNAVAILABLE",
      },
    });
    await prisma.mediaProcessingRun.updateMany({
      where: { managedMediaId: initial.mediaId },
      data: {
        state: "FAILED",
        failurePhase: "STORAGE",
        failureCode: "MEDIA_STORAGE_UNAVAILABLE",
      },
    });

    // Ingest with same key and same bytes should re-arm the run to PENDING
    const retried = await service.startProductImageIngest(makeInput(key, bytesA));
    assert.equal(retried.mediaId, initial.mediaId);
    assert.equal(retried.lifecycleState, "PENDING");

    const media = await prisma.managedMedia.findUnique({
      where: { id: initial.mediaId },
      include: { processingRuns: true },
    });
    assert.equal(media?.lifecycleState, "PENDING");
    assert.equal(media?.failureCode, null);
    assert.equal(media?.processingRuns[0]?.state, "PENDING");
  });

  it("handles high concurrency repetition (10 concurrent requests for same key)", async () => {
    const key = `key-high-concurrency-${Date.now()}`;
    const promises = Array.from({ length: 10 }, () =>
      service.startProductImageIngest(makeInput(key, bytesA))
    );

    const results = await Promise.all(promises);
    const firstId = results[0].mediaId;

    for (const res of results) {
      assert.equal(res.mediaId, firstId);
      assert.equal(res.lifecycleState, "PENDING");
    }

    const count = await prisma.managedMedia.count({
      where: { ingestActorScope: actorScope, ingestIdempotencyKey: key },
    });
    assert.equal(count, 1);
  });

  it("Item 5: fails closed for NON-RETRYABLE failure: same key + same bytes does NOT reset FAILED state or re-arm run", async () => {
    const key = `key-nonretryable-failed-${Date.now()}`;
    const initial = await service.startProductImageIngest(makeInput(key, bytesA));

    // Simulate a non-retryable failure (e.g. UNSUPPORTED_FORMAT or CORRUPTED_PAYLOAD during processing)
    await prisma.managedMedia.update({
      where: { id: initial.mediaId },
      data: {
        lifecycleState: "FAILED",
        failurePhase: "PROCESSING",
        failureCode: "UNSUPPORTED_FORMAT",
      },
    });
    await prisma.mediaProcessingRun.updateMany({
      where: { managedMediaId: initial.mediaId },
      data: {
        state: "FAILED",
        failurePhase: "PROCESSING",
        failureCode: "UNSUPPORTED_FORMAT",
      },
    });

    // Verify BEFORE STATE
    const beforeMedia = await prisma.managedMedia.findUnique({
      where: { id: initial.mediaId },
      include: { processingRuns: true },
    });
    assert.equal(beforeMedia?.lifecycleState, "FAILED");
    assert.equal(beforeMedia?.failureCode, "UNSUPPORTED_FORMAT");
    assert.equal(beforeMedia?.processingRuns[0]?.state, "FAILED");

    // RETRY ATTEMPT: Ingest with same key and same bytes must FAIL CLOSED
    const retried = await service.startProductImageIngest(makeInput(key, bytesA));
    assert.equal(retried.mediaId, initial.mediaId);
    assert.equal(retried.lifecycleState, "FAILED");
    assert.equal(retried.attachable, false);

    // Verify AFTER STATE: lifecycleState remains FAILED, failureCode preserved, run state remains FAILED
    const afterMedia = await prisma.managedMedia.findUnique({
      where: { id: initial.mediaId },
      include: { processingRuns: true },
    });
    assert.equal(afterMedia?.lifecycleState, "FAILED");
    assert.equal(afterMedia?.failureCode, "UNSUPPORTED_FORMAT");
    assert.equal(afterMedia?.processingRuns[0]?.state, "FAILED");
  });

  it("Item 6: pins profileVersion and profileDefinitionHash to immutable profile and preserves hash across retries", async () => {
    const key = `key-profile-pinning-${Date.now()}`;
    const expectedProfileVersion = PRODUCT_IMAGE_PROFILE_V1.version; // "product-image-v1"
    const expectedProfileHash = hashProcessingProfile(PRODUCT_IMAGE_PROFILE_V1);

    // 1. Initial Ingest
    const initial = await service.startProductImageIngest(makeInput(key, bytesA));
    assert.ok(initial.mediaId);

    const initialRun = await prisma.mediaProcessingRun.findFirst({
      where: { managedMediaId: initial.mediaId },
    });
    assert.ok(initialRun, "MediaProcessingRun must exist");
    assert.equal(initialRun.profileVersion, expectedProfileVersion);
    assert.equal(initialRun.profileDefinitionHash, expectedProfileHash);

    // 2. Retry / Idempotent call
    const retried = await service.startProductImageIngest(makeInput(key, bytesA));
    assert.equal(retried.mediaId, initial.mediaId);

    const retriedRun = await prisma.mediaProcessingRun.findFirst({
      where: { managedMediaId: initial.mediaId },
    });
    assert.ok(retriedRun);
    assert.equal(retriedRun.profileVersion, expectedProfileVersion);
    assert.equal(retriedRun.profileDefinitionHash, expectedProfileHash);
  });
});
