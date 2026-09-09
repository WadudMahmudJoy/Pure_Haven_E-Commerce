import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { verifyAndGetLocalDisposableDatabase } from "./helpers/disposableDbGuard";
import { DefaultMediaProcessingRunner, type MediaProcessingRunner } from "../lib/media/mediaProcessingRunner";
import { DefaultMediaLifecycleService, type MediaLifecycleService } from "../lib/media/mediaLifecycleService";
import { DefaultMediaReconciliationService, type MediaReconciliationService } from "../lib/media/mediaReconciliationService";
import { DefaultProductMediaAttachmentService, type ProductMediaAttachmentService } from "../lib/media/productMediaAttachmentService";
import { DefaultImageProcessor } from "../lib/media/imageProcessor";
import { InMemoryMediaStorage } from "../lib/media/storage/inMemoryMediaStorage";
import { PRODUCT_IMAGE_PROFILE_V1, hashProcessingProfile } from "../lib/media/processingProfile";
import { canAttachManagedMedia } from "../lib/media/domain";
import { createPhase6MediaFixture } from "./helpers/mediaFixtures";
import type { PrismaClient } from "../generated/prisma/client";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Task 17: Processing Runner, Lifecycle, Suspension, Reconciliation & Cleanup", () => {
  let prisma: PrismaClient;
  let privateStorage: InMemoryMediaStorage;
  let publicStorage: InMemoryMediaStorage;
  let imageProcessor: DefaultImageProcessor;
  let runner: MediaProcessingRunner;
  let lifecycle: MediaLifecycleService;
  let reconciliation: MediaReconciliationService;
  let attachment: ProductMediaAttachmentService;

  const actorScope = "admin-task17-actor-id";
  const profileHash = hashProcessingProfile(PRODUCT_IMAGE_PROFILE_V1);

  before(async () => {
    const ctx = verifyAndGetLocalDisposableDatabase();
    assert.ok(
      ["127.0.0.1", "localhost"].includes(ctx.redacted.host),
      "Safety violation: Target must be local"
    );
    assert.equal(ctx.redacted.port, 55439, "Target must be on local port 55439");

    await ctx.ensurePhase6Schema();
    prisma = ctx.createPrisma();
    await prisma.$connect();

    privateStorage = new InMemoryMediaStorage();
    publicStorage = new InMemoryMediaStorage();
    imageProcessor = new DefaultImageProcessor();
    attachment = new DefaultProductMediaAttachmentService(prisma);
    runner = new DefaultMediaProcessingRunner(prisma, privateStorage, publicStorage, imageProcessor, undefined, attachment, actorScope);
    lifecycle = new DefaultMediaLifecycleService(prisma, privateStorage, publicStorage, attachment);
    reconciliation = new DefaultMediaReconciliationService(prisma, privateStorage, publicStorage, lifecycle, actorScope);
  });

  after(async () => {
    if (prisma) {
      await prisma.managedMedia.updateMany({
        where: { ingestActorScope: actorScope },
        data: { canonicalMasterObjectId: null, activeProcessingRunId: null },
      });
      await prisma.productImage.deleteMany({
        where: { managedMedia: { ingestActorScope: actorScope } },
      });
      await prisma.mediaObject.deleteMany({
        where: { processingRun: { managedMedia: { ingestActorScope: actorScope } } },
      });
      await prisma.mediaProcessingRun.deleteMany({
        where: { managedMedia: { ingestActorScope: actorScope } },
      });
      await prisma.managedMedia.deleteMany({
        where: { ingestActorScope: actorScope },
      });
      await prisma.$disconnect();
    }
  });

  // Helper to create a clean test ManagedMedia record with initial MediaProcessingRun
  async function createTestMedia(opts?: {
    lifecycleState?: "PENDING" | "PROCESSING" | "READY" | "CLEANUP_PENDING" | "DELETING" | "DELETED" | "FAILED";
    stagingState?: "ALLOCATED" | "PRESENT" | "CLEANUP_PENDING" | "DELETED";
    runState?: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
    leaseExpiresAt?: Date | null;
    attemptCount?: number;
    deliveryDisabledAt?: Date | null;
    unreferencedAt?: Date | null;
    cleanupEligibleAt?: Date | null;
    deletedAt?: Date | null;
    failurePhase?: "INGEST" | "PROCESSING" | "STORAGE" | "CLEANUP" | null;
    failureCode?: string | null;
    sourceBytes?: Uint8Array;
  }) {
    const mediaId = randomUUID();
    const runId = randomUUID();
    const rawBytes = opts?.sourceBytes ?? (await createPhase6MediaFixture("photo", 400, 300));
    const contentSha = sha256(rawBytes);
    const stagingKey = `staging/${mediaId}/source`;

    if (opts?.stagingState === "PRESENT") {
      await privateStorage.putImmutable({
        objectKey: stagingKey,
        bytes: rawBytes,
        contentType: "image/png",
        checksumSha256: contentSha,
      });
    }

    const media = await prisma.managedMedia.create({
      data: {
        id: mediaId,
        mediaType: "IMAGE",
        lifecycleState: opts?.lifecycleState ?? "PENDING",
        ingestPurpose: "PRODUCT_IMAGE",
        ingestActorScope: actorScope,
        ingestIdempotencyKey: `idemp-${mediaId}`,
        ingestSha256: contentSha,
        ingestByteSize: BigInt(rawBytes.byteLength),
        ingestMimeType: "image/png",
        stagingProviderKey: "local-private",
        stagingObjectKey: stagingKey,
        stagingState: opts?.stagingState ?? "PRESENT",
        deliveryDisabledAt: opts?.deliveryDisabledAt ?? null,
        unreferencedAt: opts?.unreferencedAt ?? null,
        cleanupEligibleAt: opts?.cleanupEligibleAt ?? null,
        deletedAt: opts?.deletedAt ?? null,
        failurePhase: opts?.failurePhase ?? null,
        failureCode: opts?.failureCode ?? null,
        processingRuns: {
          create: {
            id: runId,
            profileVersion: "product-image-v1",
            profileDefinitionHash: profileHash,
            state: opts?.runState ?? "PENDING",
            attemptCount: opts?.attemptCount ?? 0,
            startedAt: (opts?.runState === "PROCESSING" || opts?.runState === "COMPLETE") ? new Date() : null,
            completedAt: opts?.runState === "COMPLETE" ? new Date() : null,
            leaseExpiresAt: opts?.runState === "PROCESSING" ? (opts?.leaseExpiresAt ?? new Date(Date.now() + 60_000)) : (opts?.leaseExpiresAt ?? null),
          },
        },
      },
      include: {
        processingRuns: true,
      },
    });

    return { media, run: media.processingRuns[0], rawBytes, contentSha, stagingKey };
  }

  // 1. ATOMIC LEASE CLAIM
  it("1. ATOMIC LEASE CLAIM — two competing workers attempt same run; exactly one acquires authority", async () => {
    const { run } = await createTestMedia({ runState: "PENDING" });

    // Both workers attempt to claim a batch of 1
    const [batchA, batchB] = await Promise.all([
      runner.runBatch(1, false),
      runner.runBatch(1, false),
    ]);

    // The sum of claimed runs for this run must be exactly 1
    assert.equal(batchA.claimed + batchB.claimed, 1, "Exactly one worker must acquire the lease");

    const updatedRun = await prisma.mediaProcessingRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    assert.equal(updatedRun.state, "PROCESSING");
    assert.ok(updatedRun.leaseExpiresAt !== null, "Lease must have an expiration timestamp");
  });

  // 2. HEALTHY LEASE
  it("2. HEALTHY LEASE — unexpired healthy lease cannot be stolen", async () => {
    const futureDate = new Date(Date.now() + 60_000);
    const { run } = await createTestMedia({
      runState: "PROCESSING",
      leaseExpiresAt: futureDate,
      attemptCount: 1,
    });

    const batch = await runner.runBatch(1, false);
    assert.equal(batch.claimed, 0, "Healthy unexpired lease must not be claimed");

    const unchanged = await prisma.mediaProcessingRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    assert.equal(unchanged.state, "PROCESSING");
    assert.equal(unchanged.leaseExpiresAt?.getTime(), futureDate.getTime());
  });

  // 3. EXPIRED LEASE
  it("3. EXPIRED LEASE — expired eligible lease can be reclaimed according to retry policy", async () => {
    const pastDate = new Date(Date.now() - 10_000);
    const { run } = await createTestMedia({
      runState: "PROCESSING",
      leaseExpiresAt: pastDate,
      attemptCount: 1,
    });

    const batch = await runner.runBatch(1, false);
    assert.equal(batch.claimed, 1, "Expired lease must be eligible for reclamation");

    const reclaimed = await prisma.mediaProcessingRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    assert.equal(reclaimed.state, "PROCESSING");
    assert.ok(reclaimed.leaseExpiresAt!.getTime() > Date.now(), "Reclaimed run must receive new lease deadline");
    assert.equal(reclaimed.attemptCount, 2, "Attempt count must increment on retry");
  });

  // 4. LEASE OWNER AUTHORITY
  it("4. LEASE OWNER AUTHORITY — non-owner cannot complete or fail another worker's leased run", async () => {
    const futureDate = new Date(Date.now() + 60_000);
    const { media } = await createTestMedia({
      runState: "PROCESSING",
      leaseExpiresAt: futureDate,
    });

    // An execution attempt by a runner that does not hold the lease should be rejected
    await assert.rejects(
      runner.runMedia(media.id),
      /LEASE_CONFLICT|NOT_LEASE_HOLDER/
    );
  });

  // 5. INITIAL PROCESSING
  it("5. INITIAL PROCESSING — PRESENT staging + pinned PENDING run produces complete inventory", async () => {
    const { media, run } = await createTestMedia({
      lifecycleState: "PENDING",
      stagingState: "PRESENT",
      runState: "PENDING",
    });

    const result = await runner.runMedia(media.id);
    assert.equal(result.completed, true);
    assert.equal(result.state, "READY");

    const objects = await prisma.mediaObject.findMany({
      where: { processingRunId: run.id },
    });
    assert.ok(objects.length > 0, "Must create MediaObject rows");

    // Canonical master
    const master = objects.find((o) => o.role === "MASTER");
    assert.ok(master, "Must create canonical MASTER");
    assert.equal(master!.accessClass, "PRIVATE_SOURCE");

    // Renditions
    const renditions = objects.filter((o) => o.role === "RENDITION");
    assert.ok(renditions.length >= 1, "Must generate renditions");
    for (const r of renditions) {
      assert.equal(r.accessClass, "PUBLIC_DELIVERY");
    }
  });

  // 6. INCOMPLETE INVENTORY
  it("6. INCOMPLETE INVENTORY — cannot transition to active READY delivery", async () => {
    const { media, run } = await createTestMedia({
      lifecycleState: "PENDING",
      runState: "COMPLETE",
    });

    // Zero MediaObjects exist for this run -> inventory is incomplete
    await assert.rejects(
      runner.activateProcessingRun(media.id, run.id),
      /RENDITION_SET_INCOMPLETE|MISSING_MANDATORY_WEBP/
    );

    const mediaAfter = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.notEqual(mediaAfter.lifecycleState, "READY");
    assert.equal(mediaAfter.activeProcessingRunId, null);
  });

  // 7. INITIAL ACTIVATION
  it("7. INITIAL ACTIVATION — complete valid inventory atomically establishes master, activeRun, and READY", async () => {
    const { media, run } = await createTestMedia({
      lifecycleState: "PENDING",
      stagingState: "PRESENT",
      runState: "PENDING",
    });

    await runner.runMedia(media.id);

    const readyMedia = await prisma.managedMedia.findUniqueOrThrow({
      where: { id: media.id },
      include: { canonicalMasterObject: true, activeProcessingRun: true },
    });

    assert.equal(readyMedia.lifecycleState, "READY");
    assert.equal(readyMedia.activeProcessingRunId, run.id);
    assert.ok(readyMedia.canonicalMasterObjectId !== null, "Must set canonicalMasterObjectId");
    assert.equal(readyMedia.canonicalMasterObject?.role, "MASTER");
    assert.equal(readyMedia.activeProcessingRun?.state, "COMPLETE");
  });

  // 8. COMPLETE != ACTIVE
  it("8. COMPLETE != ACTIVE — merely marking future run COMPLETE cannot replace active run", async () => {
    // Media has active v1 run
    const { media, run: v1Run } = await createTestMedia({
      lifecycleState: "READY",
      runState: "COMPLETE",
    });
    await prisma.managedMedia.update({
      where: { id: media.id },
      data: { activeProcessingRunId: v1Run.id },
    });

    // Request a v2 run
    const v2 = await runner.requestProfileRegeneration(media.id, "product-image-v2", actorScope);
    assert.notEqual(v2.processingRunId, v1Run.id);

    // Simulate v2 run completing without activation
    await prisma.mediaProcessingRun.update({
      where: { id: v2.processingRunId },
      data: { state: "COMPLETE", completedAt: new Date() },
    });

    const mediaCheck = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.equal(mediaCheck.activeProcessingRunId, v1Run.id, "Active run MUST remain v1RunId");
    assert.equal(mediaCheck.lifecycleState, "READY");
  });

  // 9. REGENERATION FAILURE
  it("9. REGENERATION FAILURE — failed future profile run leaves previous active run intact and media READY", async () => {
    const { media, run: v1Run } = await createTestMedia({
      lifecycleState: "READY",
      runState: "COMPLETE",
    });
    await prisma.managedMedia.update({
      where: { id: media.id },
      data: { activeProcessingRunId: v1Run.id },
    });

    const v2 = await runner.requestProfileRegeneration(media.id, "product-image-v2", actorScope);

    // Mark v2 as FAILED
    await prisma.mediaProcessingRun.update({
      where: { id: v2.processingRunId },
      data: {
        state: "FAILED",
        failurePhase: "PROCESSING",
        failureCode: "PROCESSING_CRASH",
      },
    });

    const mediaCheck = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.equal(mediaCheck.lifecycleState, "READY", "Media must remain READY");
    assert.equal(mediaCheck.activeProcessingRunId, v1Run.id, "Active run must remain v1");
  });

  // 10. SUSPENDED NORMAL ACTIVATION
  it("10. SUSPENDED NORMAL ACTIVATION — normal activation must fail while deliveryDisabledAt != null", async () => {
    const { media, run } = await createTestMedia({
      lifecycleState: "READY",
      runState: "COMPLETE",
      deliveryDisabledAt: new Date(),
    });

    await assert.rejects(
      runner.activateProcessingRun(media.id, run.id),
      /MEDIA_DELIVERY_DISABLED/
    );
  });

  // 11. RECOVERY CASE A
  it("11. RECOVERY CASE A — existing safe active inventory validated before suspension clears", async () => {
    const { media, run } = await createTestMedia({
      lifecycleState: "READY",
      runState: "COMPLETE",
      deliveryDisabledAt: new Date(),
    });

    // Populate a valid WebP public rendition
    await prisma.mediaObject.create({
      data: {
        id: randomUUID(),
        processingRunId: run.id,
        role: "RENDITION",
        accessClass: "PUBLIC_DELIVERY",
        variantKey: "webp-800",
        storageProviderKey: "local-public",
        objectKey: `renditions/${media.id}/webp-800.webp`,
        mimeType: "image/webp",
        width: 800,
        height: 600,
        byteSize: BigInt(12345),
        checksumSha256: "abc123sha",
      },
    });

    await prisma.managedMedia.update({
      where: { id: media.id },
      data: { activeProcessingRunId: run.id },
    });

    // Privileged recovery Case A (no candidate specified)
    await lifecycle.recoverDelivery(media.id, actorScope);

    const recovered = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.equal(recovered.deliveryDisabledAt, null, "Suspension must be cleared");
    assert.equal(recovered.activeProcessingRunId, run.id);
  });

  // 12. RECOVERY CASE B
  it("12. RECOVERY CASE B — atomic candidate activation + compatibility refresh + suspension clear", async () => {
    const { media, run: oldRun } = await createTestMedia({
      lifecycleState: "READY",
      runState: "COMPLETE",
      deliveryDisabledAt: new Date(),
    });
    await prisma.managedMedia.update({
      where: { id: media.id },
      data: { activeProcessingRunId: oldRun.id },
    });

    // Create candidate run v2
    const v2 = await runner.requestProfileRegeneration(media.id, "product-image-v2-recovery", actorScope);
    await prisma.mediaObject.create({
      data: {
        id: randomUUID(),
        processingRunId: v2.processingRunId,
        role: "RENDITION",
        accessClass: "PUBLIC_DELIVERY",
        variantKey: "webp-1200",
        storageProviderKey: "local-public",
        objectKey: `renditions/${media.id}/webp-1200.webp`,
        mimeType: "image/webp",
        width: 1200,
        height: 900,
        byteSize: BigInt(23456),
        checksumSha256: "v2webp1200sha",
      },
    });
    await prisma.mediaProcessingRun.update({
      where: { id: v2.processingRunId },
      data: { state: "COMPLETE", completedAt: new Date() },
    });

    // Normal activation while suspended MUST still be blocked
    await assert.rejects(
      runner.activateProcessingRun(media.id, v2.processingRunId),
      /MEDIA_DELIVERY_DISABLED/
    );

    // Privileged recovery Case B (candidate specified)
    await lifecycle.recoverDelivery(media.id, actorScope, v2.processingRunId);

    const recovered = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.equal(recovered.deliveryDisabledAt, null, "Suspension must be cleared");
    assert.equal(recovered.activeProcessingRunId, v2.processingRunId, "Candidate must become active");
  });

  // 13. CLEANUP_PENDING
  it("13. CLEANUP_PENDING — zero-reference READY media schedules grace-period cleanup", async () => {
    const { media } = await createTestMedia({
      lifecycleState: "READY",
      runState: "COMPLETE",
    });

    // Zero ProductImage rows refer to this media. Run reconciliation batch
    const summary = await reconciliation.runBatch(10);
    assert.ok(summary.cleanupCandidatesMarked >= 1, "Must mark zero-ref media for cleanup");

    const updated = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.equal(updated.lifecycleState, "CLEANUP_PENDING");
    assert.ok(updated.unreferencedAt !== null, "Must set unreferencedAt");
    assert.ok(updated.cleanupEligibleAt !== null, "Must set cleanupEligibleAt");
  });

  // 14. REATTACH DURING GRACE
  it("14. REATTACH DURING GRACE — valid new reference cancels/repairs cleanup scheduling", async () => {
    const { media } = await createTestMedia({
      lifecycleState: "CLEANUP_PENDING",
      unreferencedAt: new Date(Date.now() - 3600_000),
      cleanupEligibleAt: new Date(Date.now() + 3600_000), // in grace
    });

    // Create a product and attach a ProductImage to this media
    const product = await prisma.product.create({
      data: {
        name: `Test Product ${media.id}`,
        description: "Test description",
        price: 100,
        stock: 5,
        category: "Skincare",
        image: "https://example.com/test.webp",
      },
    });

    await prisma.productImage.create({
      data: {
        productId: product.id,
        managedMediaId: media.id,
        url: "https://example.com/preview.webp",
        sortOrder: 0,
        sourceKind: "MANAGED",
      },
    });

    // Reconciliation notices the new reference
    await reconciliation.runBatch(10);

    const restored = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.equal(restored.lifecycleState, "READY");
    assert.equal(restored.unreferencedAt, null);
    assert.equal(restored.cleanupEligibleAt, null);

    // Clean up product
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });

  // 15. DELETING
  it("15. DELETING — nonattachable point of no return", async () => {
    const { media } = await createTestMedia({
      lifecycleState: "DELETING",
    });

    const attachable = canAttachManagedMedia(
      media.lifecycleState,
      media.deliveryDisabledAt
    );
    assert.equal(attachable, false, "DELETING state must be strictly nonattachable");
  });

  // 16. CANONICAL MASTER PROTECTION
  it("16. CANONICAL MASTER PROTECTION — inactive-profile cleanup NEVER deletes canonical master", async () => {
    const { media, run: v1Run } = await createTestMedia({
      lifecycleState: "READY",
      runState: "COMPLETE",
    });

    // Create master object owned by v1Run
    const masterObj = await prisma.mediaObject.create({
      data: {
        id: randomUUID(),
        processingRunId: v1Run.id,
        role: "MASTER",
        accessClass: "PRIVATE_SOURCE",
        variantKey: "master",
        storageProviderKey: "local-private",
        objectKey: `masters/${media.id}/canonical-master.webp`,
        mimeType: "image/webp",
        width: 1500,
        height: 1000,
        byteSize: BigInt(50000),
        checksumSha256: "mastersha123",
      },
    });

    // Create rendition owned by v1Run
    const renditionObj = await prisma.mediaObject.create({
      data: {
        id: randomUUID(),
        processingRunId: v1Run.id,
        role: "RENDITION",
        accessClass: "PUBLIC_DELIVERY",
        variantKey: "webp-800",
        storageProviderKey: "local-public",
        objectKey: `renditions/${media.id}/webp-800.webp`,
        mimeType: "image/webp",
        width: 800,
        height: 600,
        byteSize: BigInt(20000),
        checksumSha256: "renditionsha123",
      },
    });

    await prisma.managedMedia.update({
      where: { id: media.id },
      data: {
        canonicalMasterObjectId: masterObj.id,
      },
    });

    // Now media activates v2 run
    const v2 = await runner.requestProfileRegeneration(media.id, "product-image-v2-cleanup", actorScope);
    await prisma.mediaProcessingRun.update({
      where: { id: v2.processingRunId },
      data: { state: "COMPLETE", completedAt: new Date() },
    });
    await prisma.mediaObject.create({
      data: {
        id: randomUUID(),
        processingRunId: v2.processingRunId,
        role: "RENDITION",
        accessClass: "PUBLIC_DELIVERY",
        variantKey: "webp-800",
        storageProviderKey: "local-public",
        objectKey: `renditions/${media.id}/v2-webp-800.webp`,
        mimeType: "image/webp",
        width: 800,
        height: 600,
        byteSize: BigInt(21000),
        checksumSha256: "v2renditionsha123",
      },
    });
    await runner.activateProcessingRun(media.id, v2.processingRunId);

    // Clean up inactive v1 profile
    await lifecycle.cleanupInactiveProfile(media.id, v1Run.id);

    // Canonical master MUST still exist and not be deleted
    const masterAfter = await prisma.mediaObject.findUniqueOrThrow({
      where: { id: masterObj.id },
    });
    assert.equal(masterAfter.deletedAt, null, "Canonical master MUST NEVER be deleted by inactive profile cleanup");

    // Obsolete rendition SHOULD be deleted/tombstoned
    const renditionAfter = await prisma.mediaObject.findUniqueOrThrow({
      where: { id: renditionObj.id },
    });
    assert.ok(renditionAfter.deletedAt !== null, "Obsolete rendition should be deleted");
  });

  // 17. ORDINARY CLEANUP HISTORY
  it("17. ORDINARY CLEANUP HISTORY — does not hard-delete ManagedMedia, Run, or Object rows", async () => {
    const pastEligible = new Date(Date.now() - 3600_000);
    const { media, run } = await createTestMedia({
      lifecycleState: "CLEANUP_PENDING",
      unreferencedAt: pastEligible,
      cleanupEligibleAt: pastEligible,
    });

    const obj = await prisma.mediaObject.create({
      data: {
        id: randomUUID(),
        processingRunId: run.id,
        role: "RENDITION",
        accessClass: "PUBLIC_DELIVERY",
        variantKey: "webp-800",
        storageProviderKey: "local-public",
        objectKey: `renditions/${media.id}/to-cleanup.webp`,
        mimeType: "image/webp",
        width: 800,
        height: 600,
        byteSize: BigInt(1000),
        checksumSha256: "sha1000",
      },
    });

    // Claim for cleanup
    const claimed = await lifecycle.claimCleanupBatch(1);
    assert.ok(claimed.includes(media.id));

    // Execute physical cleanup
    await lifecycle.cleanupClaimedMedia(media.id);

    // Database metadata history MUST still exist!
    const mediaRow = await prisma.managedMedia.findUnique({ where: { id: media.id } });
    assert.ok(mediaRow !== null, "ManagedMedia row must NOT be hard-deleted");
    assert.equal(mediaRow?.lifecycleState, "DELETED");
    assert.ok(mediaRow?.deletedAt !== null, "deletedAt must be recorded");

    const runRow = await prisma.mediaProcessingRun.findUnique({ where: { id: run.id } });
    assert.ok(runRow !== null, "MediaProcessingRun row must NOT be hard-deleted");

    const objectRow = await prisma.mediaObject.findUnique({ where: { id: obj.id } });
    assert.ok(objectRow !== null, "MediaObject row must NOT be hard-deleted");
    assert.ok(objectRow?.deletedAt !== null, "MediaObject tombstone deletedAt must be recorded");
  });

  // 18. MISSING STORAGE OBJECT DELETE
  it("18. MISSING STORAGE OBJECT DELETE — missing physical object succeeds idempotently", async () => {
    // Physical object does not exist in publicStorage
    const key = "renditions/non-existent-key.webp";
    await assert.doesNotReject(
      publicStorage.deleteObject(key),
      "Deleting missing physical object must succeed idempotently"
    );
  });

  // 19. STORAGE DELETE FAILURE
  it("19. STORAGE DELETE FAILURE — provider delete error records failurePhase=CLEANUP and remains retryable", async () => {
    const pastEligible = new Date(Date.now() - 3600_000);
    const { media, run } = await createTestMedia({
      lifecycleState: "DELETING",
      unreferencedAt: pastEligible,
      cleanupEligibleAt: pastEligible,
    });

    // Inject failing storage object or simulate delete error
    await prisma.mediaObject.create({
      data: {
        id: randomUUID(),
        processingRunId: run.id,
        role: "RENDITION",
        accessClass: "PUBLIC_DELIVERY",
        variantKey: "webp-error",
        storageProviderKey: "failing-provider",
        objectKey: `renditions/${media.id}/failing.webp`,
        mimeType: "image/webp",
        width: 800,
        height: 600,
        byteSize: BigInt(1000),
        checksumSha256: "failsha",
      },
    });

    await lifecycle.cleanupClaimedMedia(media.id);

    const mediaCheck = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.equal(mediaCheck.failurePhase, "CLEANUP", "Must record failurePhase=CLEANUP");
    assert.ok(mediaCheck.failureCode !== null, "Must record failureCode");
    assert.equal(mediaCheck.lifecycleState, "DELETING", "Must remain in DELETING for retry");
  });

  // 20. STAGING RECONCILIATION
  it("20. STAGING RECONCILIATION — ALLOCATED + deterministic physical staging object + matching SHA/size -> PRESENT", async () => {
    const rawBytes = await createPhase6MediaFixture("photo", 300, 200);
    const contentSha = sha256(rawBytes);
    const mediaId = randomUUID();
    const stagingKey = `staging/${mediaId}/source`;

    // Write physical staging object to privateStorage
    await privateStorage.putImmutable({
      objectKey: stagingKey,
      bytes: rawBytes,
      contentType: "image/jpeg",
      checksumSha256: contentSha,
    });

    // DB record crashed in ALLOCATED state
    await prisma.managedMedia.create({
      data: {
        id: mediaId,
        mediaType: "IMAGE",
        lifecycleState: "PENDING",
        ingestPurpose: "PRODUCT_IMAGE",
        ingestActorScope: actorScope,
        ingestIdempotencyKey: `crash-${mediaId}`,
        ingestSha256: contentSha,
        ingestByteSize: BigInt(rawBytes.byteLength),
        ingestMimeType: "image/jpeg",
        stagingProviderKey: "local-private",
        stagingObjectKey: stagingKey,
        stagingState: "ALLOCATED",
      },
    });

    const summary = await reconciliation.runBatch(10);
    assert.ok(summary.stalePendingRecovered >= 1, "Must reconcile crashed ALLOCATED staging");

    const reconciled = await prisma.managedMedia.findUniqueOrThrow({ where: { id: mediaId } });
    assert.equal(reconciled.stagingState, "PRESENT", "Staging state must transition to PRESENT");
  });

  // 21. STAGING INTEGRITY MISMATCH
  it("21. STAGING INTEGRITY MISMATCH — ALLOCATED staging object with mismatched SHA fails closed", async () => {
    const rawBytes = await createPhase6MediaFixture("photo", 300, 200);
    const mediaId = randomUUID();
    const stagingKey = `staging/${mediaId}/source`;

    // Staging contains corrupted/different bytes
    await privateStorage.putImmutable({
      objectKey: stagingKey,
      bytes: new Uint8Array(Buffer.from("tampered-staging-bytes")),
      contentType: "image/jpeg",
      checksumSha256: sha256(new Uint8Array(Buffer.from("tampered-staging-bytes"))),
    });

    await prisma.managedMedia.create({
      data: {
        id: mediaId,
        mediaType: "IMAGE",
        lifecycleState: "PENDING",
        ingestPurpose: "PRODUCT_IMAGE",
        ingestActorScope: actorScope,
        ingestIdempotencyKey: `tampered-${mediaId}`,
        ingestSha256: sha256(rawBytes), // expects original
        ingestByteSize: BigInt(rawBytes.byteLength),
        ingestMimeType: "image/jpeg",
        stagingProviderKey: "local-private",
        stagingObjectKey: stagingKey,
        stagingState: "ALLOCATED",
      },
    });

    await reconciliation.runBatch(10);

    const failedMedia = await prisma.managedMedia.findUniqueOrThrow({ where: { id: mediaId } });
    assert.equal(failedMedia.lifecycleState, "FAILED");
    assert.equal(failedMedia.failurePhase, "INGEST");
    assert.equal(failedMedia.failureCode, "INTEGRITY_MISMATCH");
  });
});
