import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { verifyAndGetLocalDisposableDatabase } from "./helpers/disposableDbGuard";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "../lib/adminSession";
import { PUT, DELETE } from "../app/api/products/route";
import { getAdminProductDetailQuery } from "../lib/catalog/adminCatalogQuery";
import { PRODUCT_IMAGE_PROFILE_V1, hashProcessingProfile } from "../lib/media/processingProfile";
import type { PrismaClient } from "../generated/prisma/client";

describe("Task 18: Managed Product Gallery Attachment, Legacy Identity & Lifecycle Hints", () => {
  let prisma: PrismaClient;

  const actorScope = "admin-task18-actor-id";
  const adminEmail = "admin-task18@purehaven.test";
  const profileHash = hashProcessingProfile(PRODUCT_IMAGE_PROFILE_V1);
  let authCookie: string;

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

    process.env.ADMIN_SESSION_SECRET = "test-secret-must-be-at-least-32-chars-long!";
    const token = createAdminSessionToken(adminEmail);
    authCookie = `${ADMIN_SESSION_COOKIE}=${token}`;

    await prisma.adminCredential.create({
      data: {
        email: adminEmail,
        passwordHash: "dummyhash123",
      },
    });
  });

  after(async () => {
    if (prisma) {
      await prisma.productImage.deleteMany({
        where: { managedMedia: { ingestActorScope: actorScope } },
      });
      await prisma.managedMedia.updateMany({
        where: { ingestActorScope: actorScope },
        data: { canonicalMasterObjectId: null, activeProcessingRunId: null },
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
      await prisma.adminCredential.deleteMany({
        where: { email: adminEmail },
      });
      await prisma.$disconnect();
    }
  });

  // Helper to create a product
  async function createProduct(name: string, images?: string[]): Promise<number> {
    const p = await prisma.product.create({
      data: {
        name,
        description: "Test product description",
        price: 500,
        stock: 10,
        category: "Skincare",
        image: images && images.length > 0 ? images[0] : "https://example.com/default.webp",
        images: images && images.length > 0
          ? {
              create: images.map((url, idx) => ({
                url,
                sortOrder: idx + 1,
                sourceKind: "LEGACY_EXTERNAL",
              })),
            }
          : undefined,
      },
    });
    return p.id;
  }

  // Helper to create a ManagedMedia fixture in various states
  async function createMedia(opts: {
    lifecycleState: "PENDING" | "PROCESSING" | "READY" | "CLEANUP_PENDING" | "DELETING" | "DELETED" | "FAILED";
    deliveryDisabledAt?: Date | null;
    hasPublicWebp?: boolean;
    unreferencedAt?: Date | null;
    cleanupEligibleAt?: Date | null;
  }) {
    const mediaId = randomUUID();
    const runId = randomUUID();

    const media = await prisma.managedMedia.create({
      data: {
        id: mediaId,
        mediaType: "IMAGE",
        lifecycleState: opts.lifecycleState,
        ingestPurpose: "PRODUCT_IMAGE",
        ingestActorScope: actorScope,
        ingestIdempotencyKey: `idemp-${mediaId}`,
        ingestSha256: "dummy-sha",
        ingestByteSize: BigInt(1000),
        ingestMimeType: "image/jpeg",
        stagingProviderKey: "local-private",
        stagingObjectKey: `staging/${mediaId}/source`,
        stagingState: "PRESENT",
        deliveryDisabledAt: opts.deliveryDisabledAt ?? null,
        unreferencedAt: opts.unreferencedAt ?? null,
        cleanupEligibleAt: opts.cleanupEligibleAt ?? null,
        failurePhase: opts.lifecycleState === "FAILED" ? "PROCESSING" : null,
        failureCode: opts.lifecycleState === "FAILED" ? "TEST_FAILURE" : null,
        deletedAt: opts.lifecycleState === "DELETED" ? new Date() : null,
        processingRuns: {
          create: {
            id: runId,
            profileVersion: "product-image-v1",
            profileDefinitionHash: profileHash,
            state: opts.lifecycleState === "READY" || opts.lifecycleState === "CLEANUP_PENDING" ? "COMPLETE" : "PENDING",
            completedAt: opts.lifecycleState === "READY" || opts.lifecycleState === "CLEANUP_PENDING" ? new Date() : null,
          },
        },
      },
      include: { processingRuns: true },
    });

    if (opts.hasPublicWebp) {
      await prisma.mediaObject.create({
        data: {
          id: randomUUID(),
          processingRunId: runId,
          role: "RENDITION",
          accessClass: "PUBLIC_DELIVERY",
          variantKey: "webp-800",
          storageProviderKey: "local-public",
          objectKey: `renditions/${mediaId}/webp-800.webp`,
          mimeType: "image/webp",
          width: 800,
          height: 600,
          byteSize: BigInt(15000),
          checksumSha256: `sha-${mediaId}`,
        },
      });

      await prisma.managedMedia.update({
        where: { id: mediaId },
        data: { activeProcessingRunId: runId },
      });
    }

    return media;
  }

  async function callPutApi(payload: Record<string, unknown>): Promise<Response> {
    const req = new Request("http://localhost:3000/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie,
      },
      body: JSON.stringify(payload),
    });
    return await PUT(req);
  }

  async function callDeleteApi(productId: number): Promise<Response> {
    const req = new Request(`http://localhost:3000/api/products?id=${productId}`, {
      method: "DELETE",
      headers: {
        Cookie: authCookie,
      },
    });
    return await DELETE(req);
  }

  // 1. ATTACH READY MEDIA
  it("1. Attach READY media: succeeds and establishes managed ProductImage with server-derived compatibility URL", async () => {
    const productId = await createProduct("Test Product Ready");
    const media = await createMedia({ lifecycleState: "READY", hasPublicWebp: true });

    const res = await callPutApi({
      id: productId,
      name: "Test Product Ready Updated",
      category: "Skincare",
      price: 500,
      gallery: [
        { kind: "managed", managedMediaId: media.id, altText: "Primary face cream" },
      ],
    });

    assert.equal(res.status, 200, "Attaching READY media must succeed");
    const json = await res.json();
    assert.equal(json.success, true);

    const images = await prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: "asc" },
    });
    assert.equal(images.length, 1);
    assert.equal(images[0].sourceKind, "MANAGED");
    assert.equal(images[0].managedMediaId, media.id);
    assert.ok(images[0].url.includes("webp-800.webp"), "Must derive server URL from WebP rendition");

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    assert.equal(product.image, images[0].url, "Product.image mirror must equal first ProductImage URL");
  });

  // 2. ATTACH CLEANUP_PENDING (RE-ATTACHMENT IN GRACE)
  it("2. Attach CLEANUP_PENDING media: succeeds, restores media to READY, clears unreferenced timestamps", async () => {
    const productId = await createProduct("Test Product Grace");
    const past = new Date(Date.now() - 3600_000);
    const future = new Date(Date.now() + 3600_000);
    const media = await createMedia({
      lifecycleState: "CLEANUP_PENDING",
      hasPublicWebp: true,
      unreferencedAt: past,
      cleanupEligibleAt: future,
    });

    const res = await callPutApi({
      id: productId,
      name: "Test Product Grace",
      category: "Skincare",
      price: 500,
      gallery: [{ kind: "managed", managedMediaId: media.id }],
    });

    assert.equal(res.status, 200);

    const restored = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.equal(restored.lifecycleState, "READY", "Attaching CLEANUP_PENDING must restore to READY");
    assert.equal(restored.unreferencedAt, null);
    assert.equal(restored.cleanupEligibleAt, null);
  });

  // 3. REJECT UNATTACHABLE LIFECYCLE STATES
  it("3. Reject unattachable states: PENDING, PROCESSING, FAILED, DELETING, DELETED are rejected", async () => {
    const productId = await createProduct("Test Product Unattachable");
    const states = ["PENDING", "PROCESSING", "FAILED", "DELETING", "DELETED"] as const;

    for (const state of states) {
      const media = await createMedia({ lifecycleState: state, hasPublicWebp: false });

      const res = await callPutApi({
        id: productId,
        name: "Test Product Unattachable",
        category: "Skincare",
        price: 500,
        gallery: [{ kind: "managed", managedMediaId: media.id }],
      });

      assert.equal(res.status, 400, `State ${state} must be rejected with 400`);
      const body = await res.json();
      assert.match(body.message, /MEDIA_NOT_ATTACHABLE/);
    }
  });

  // 4. REJECT SUSPENDED MEDIA
  it("4. Reject suspended media: deliveryDisabledAt != null rejects attachment", async () => {
    const productId = await createProduct("Test Product Suspended");
    const media = await createMedia({
      lifecycleState: "READY",
      hasPublicWebp: true,
      deliveryDisabledAt: new Date(),
    });

    const res = await callPutApi({
      id: productId,
      name: "Test Product Suspended",
      category: "Skincare",
      price: 500,
      gallery: [{ kind: "managed", managedMediaId: media.id }],
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /MEDIA_DELIVERY_DISABLED/);
  });

  // 5. REJECT INCOMPLETE INVENTORY
  it("5. Reject incomplete inventory: READY media with missing WebP rendition rejects", async () => {
    const productId = await createProduct("Test Product Incomplete");
    const media = await createMedia({
      lifecycleState: "READY",
      hasPublicWebp: false, // no WebP rendition!
    });

    const res = await callPutApi({
      id: productId,
      name: "Test Product Incomplete",
      category: "Skincare",
      price: 500,
      gallery: [{ kind: "managed", managedMediaId: media.id }],
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /RENDITION_SET_INCOMPLETE/);
  });

  // 6. RELATIONAL LEGACY RETENTION
  it("6. Relational legacy identity: legacy-existing item belonging to product attaches and preserves ordering", async () => {
    const productId = await createProduct("Test Legacy Retention", [
      "https://example.com/legacy-1.jpg",
      "https://example.com/legacy-2.jpg",
    ]);
    const existingImages = await prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: "asc" },
    });
    assert.equal(existingImages.length, 2);

    // Re-order legacy images via structured gallery
    const res = await callPutApi({
      id: productId,
      name: "Test Legacy Retention",
      category: "Skincare",
      price: 500,
      gallery: [
        { kind: "legacy-existing", productImageId: existingImages[1].id },
        { kind: "legacy-existing", productImageId: existingImages[0].id },
      ],
    });

    assert.equal(res.status, 200);

    const reordered = await prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: "asc" },
    });
    assert.equal(reordered.length, 2);
    assert.equal(reordered[0].url, "https://example.com/legacy-2.jpg");
    assert.equal(reordered[1].url, "https://example.com/legacy-1.jpg");
  });

  // 7. REJECT FOREIGN PRODUCT IMAGE
  it("7. Reject foreign product image: legacy-existing ID from another product is rejected", async () => {
    const productA = await createProduct("Product A", ["https://example.com/a.jpg"]);
    const productB = await createProduct("Product B", ["https://example.com/b.jpg"]);

    const imagesB = await prisma.productImage.findMany({ where: { productId: productB } });

    // Try to attach product B's image to product A
    const res = await callPutApi({
      id: productA,
      name: "Product A",
      category: "Skincare",
      price: 500,
      gallery: [
        { kind: "legacy-existing", productImageId: imagesB[0].id },
      ],
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /PRODUCT_IMAGE_OWNERSHIP_MISMATCH/);
  });

  // 8. REJECT ARBITRARY URL IN STRUCTURED GALLERY
  it("8. Structured gallery rejects arbitrary URL injection ({ kind: 'legacy', url: ... })", async () => {
    const productId = await createProduct("Product Arbitrary");

    const res = await callPutApi({
      id: productId,
      name: "Product Arbitrary",
      category: "Skincare",
      price: 500,
      gallery: [
        { kind: "legacy", url: "https://attacker.invalid/x.jpg" },
      ],
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /PRODUCT_GALLERY_ITEM_INVALID/);
  });

  // 9. CLIENT URL REJECTION
  it("9. Compatibility mirrors: client-supplied URL for managed item is ignored", async () => {
    const productId = await createProduct("Product Client URL Ignored");
    const media = await createMedia({ lifecycleState: "READY", hasPublicWebp: true });

    const res = await callPutApi({
      id: productId,
      name: "Product Client URL Ignored",
      category: "Skincare",
      price: 500,
      gallery: [
        { kind: "managed", managedMediaId: media.id, clientUrl: "https://attacker.invalid/fake.jpg" },
      ],
    });

    assert.equal(res.status, 200);

    const row = await prisma.productImage.findFirstOrThrow({ where: { productId } });
    assert.notEqual(row.url, "https://attacker.invalid/fake.jpg");
    assert.ok(row.url.includes("webp-800.webp"), "URL must be server-derived");
  });

  // 10. MANAGED GALLERY PROTECTION AGAINST DIRECT image:
  it("10. Managed gallery protection: direct legacy image: update cannot override existing managed gallery", async () => {
    const productId = await createProduct("Product Managed Gallery");
    const media = await createMedia({ lifecycleState: "READY", hasPublicWebp: true });

    // First establish managed gallery
    await callPutApi({
      id: productId,
      name: "Product Managed Gallery",
      category: "Skincare",
      price: 500,
      gallery: [{ kind: "managed", managedMediaId: media.id }],
    });

    // Now attempt legacy direct image: update
    const res = await callPutApi({
      id: productId,
      name: "Product Managed Gallery",
      category: "Skincare",
      price: 500,
      image: "https://example.com/legacy-attempt.jpg",
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /LEGACY_PRIMARY_IMAGE_MUTATION_NOT_ALLOWED_FOR_MANAGED_GALLERY/);
  });

  // 11. DETACH LIFECYCLE HINT
  it("11. Detach lifecycle hint: removing managed image transitions it to CLEANUP_PENDING without physical storage delete", async () => {
    const productId = await createProduct("Product Detach Test");
    const media = await createMedia({ lifecycleState: "READY", hasPublicWebp: true });

    // Establish managed gallery
    await callPutApi({
      id: productId,
      name: "Product Detach Test",
      category: "Skincare",
      price: 500,
      gallery: [{ kind: "managed", managedMediaId: media.id }],
    });

    const attached = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.equal(attached.lifecycleState, "READY");

    // Replace with a legacy image
    await callPutApi({
      id: productId,
      name: "Product Detach Test",
      category: "Skincare",
      price: 500,
      images: ["https://example.com/legacy-replacement.jpg"],
    });

    // The removed managed media must now be CLEANUP_PENDING!
    const detached = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.equal(detached.lifecycleState, "CLEANUP_PENDING", "Detached zero-ref media must transition to CLEANUP_PENDING");
    assert.ok(detached.unreferencedAt !== null);
    assert.ok(detached.cleanupEligibleAt !== null);
  });

  // 12. PRODUCT DELETE CASCADE LIFECYCLE HINT
  it("12. Product delete cascade safety: deleting product marks zero-reference managed media CLEANUP_PENDING", async () => {
    const productId = await createProduct("Product Cascade Delete");
    const media = await createMedia({ lifecycleState: "READY", hasPublicWebp: true });

    await callPutApi({
      id: productId,
      name: "Product Cascade Delete",
      category: "Skincare",
      price: 500,
      gallery: [{ kind: "managed", managedMediaId: media.id }],
    });

    // Hard delete product via DELETE API
    const res = await callDeleteApi(productId);
    assert.equal(res.status, 200);

    const mediaAfter = await prisma.managedMedia.findUniqueOrThrow({ where: { id: media.id } });
    assert.equal(mediaAfter.lifecycleState, "CLEANUP_PENDING", "Must transition to CLEANUP_PENDING on product deletion");
    assert.ok(mediaAfter.unreferencedAt !== null);
    assert.ok(mediaAfter.cleanupEligibleAt !== null);
  });

  // 13. ADMIN DETAIL READ EXPOSES STRUCTURED GALLERY ITEM DTO
  it("13. Admin detail read: exposes safe AdminProductGalleryItemDto with previewUrl and no private keys", async () => {
    const productId = await createProduct("Product Detail DTO");
    const media = await createMedia({ lifecycleState: "READY", hasPublicWebp: true });

    await callPutApi({
      id: productId,
      name: "Product Detail DTO",
      category: "Skincare",
      price: 500,
      gallery: [
        { kind: "managed", managedMediaId: media.id, altText: "Admin test alt text" },
      ],
    });

    const detail = await getAdminProductDetailQuery(productId);
    assert.ok(detail !== null);
    assert.ok(detail.gallery !== undefined, "AdminProductDetailDTO must include gallery items");
    assert.equal(detail.gallery?.length, 1);

    const item = detail.gallery![0];
    assert.equal(item.sourceKind, "MANAGED");
    assert.equal(item.managedMediaId, media.id);
    assert.equal(item.altText, "Admin test alt text");
    assert.ok(item.previewUrl.includes("webp-800.webp"));

    // Verify security: no private fields exposed
    const itemAny = item as Record<string, unknown>;
    assert.equal(itemAny.canonicalMasterObjectId, undefined);
    assert.equal(itemAny.objectKey, undefined);
    assert.equal(itemAny.bucket, undefined);
  });
});
