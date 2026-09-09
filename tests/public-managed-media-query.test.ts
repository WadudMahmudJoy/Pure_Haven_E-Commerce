import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { verifyAndGetLocalDisposableDatabase } from "./helpers/disposableDbGuard";
import {
  getPublicCatalogQuery,
  getPublicProductDetailQuery,
} from "../lib/catalog/publicCatalogQuery";
import { PRODUCT_IMAGE_PROFILE_V1, hashProcessingProfile } from "../lib/media/processingProfile";
import type { PrismaClient } from "../generated/prisma/client";

describe("Task 20: Public Managed Media Catalog Query & Zero Provider N+1", () => {
  let prisma: PrismaClient;

  const actorScope = "actor-task20-query";
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
      await prisma.product.deleteMany({
        where: { description: "task20-test-product" },
      });
      await prisma.$disconnect();
    }
  });

  // Helper to create a complete READY ManagedMedia fixture with WebP + AVIF renditions
  async function createManagedMediaFixture(opts?: {
    deliveryDisabledAt?: Date | null;
    tag?: string;
  }) {
    const mediaId = randomUUID();
    const runId = randomUUID();
    const tag = opts?.tag ?? mediaId.slice(0, 8);

    await prisma.managedMedia.create({
      data: {
        id: mediaId,
        mediaType: "IMAGE",
        lifecycleState: "READY",
        ingestPurpose: "PRODUCT_IMAGE",
        ingestActorScope: actorScope,
        ingestIdempotencyKey: `idemp-${mediaId}`,
        ingestSha256: `sha-${mediaId}`,
        ingestByteSize: BigInt(2048),
        ingestMimeType: "image/jpeg",
        stagingProviderKey: "local-private",
        stagingObjectKey: `staging/${mediaId}/source`,
        stagingState: "PRESENT",
        deliveryDisabledAt: opts?.deliveryDisabledAt ?? null,
        processingRuns: {
          create: {
            id: runId,
            profileVersion: "product-image-v1",
            profileDefinitionHash: profileHash,
            state: "COMPLETE",
            completedAt: new Date(),
          },
        },
      },
    });

    // Create renditions: 320w, 800w (WebP and AVIF)
    const objects = [
      {
        id: randomUUID(),
        processingRunId: runId,
        role: "RENDITION" as const,
        accessClass: "PUBLIC_DELIVERY" as const,
        variantKey: "webp-320",
        storageProviderKey: "local-public",
        objectKey: `renditions/${mediaId}/webp-320-${tag}.webp`,
        mimeType: "image/webp",
        width: 320,
        height: 240,
        byteSize: BigInt(8000),
        checksumSha256: `sha-webp320-${mediaId}`,
      },
      {
        id: randomUUID(),
        processingRunId: runId,
        role: "RENDITION" as const,
        accessClass: "PUBLIC_DELIVERY" as const,
        variantKey: "webp-800",
        storageProviderKey: "local-public",
        objectKey: `renditions/${mediaId}/webp-800-${tag}.webp`,
        mimeType: "image/webp",
        width: 800,
        height: 600,
        byteSize: BigInt(24000),
        checksumSha256: `sha-webp800-${mediaId}`,
      },
      {
        id: randomUUID(),
        processingRunId: runId,
        role: "RENDITION" as const,
        accessClass: "PUBLIC_DELIVERY" as const,
        variantKey: "avif-800",
        storageProviderKey: "local-public",
        objectKey: `renditions/${mediaId}/avif-800-${tag}.avif`,
        mimeType: "image/avif",
        width: 800,
        height: 600,
        byteSize: BigInt(18000),
        checksumSha256: `sha-avif800-${mediaId}`,
      },
    ];

    for (const obj of objects) {
      await prisma.mediaObject.create({ data: obj });
    }

    await prisma.managedMedia.update({
      where: { id: mediaId },
      data: { activeProcessingRunId: runId },
    });

    const primaryCompatibilityUrl = `http://localhost:3000/media/renditions/${mediaId}/webp-800-${tag}.webp`;
    return { mediaId, primaryCompatibilityUrl };
  }

  // Helper to create product
  async function createProduct(name: string, image: string, galleryItems: Array<{
    url: string;
    sourceKind: "MANAGED" | "LEGACY_LOCAL" | "LEGACY_EXTERNAL";
    managedMediaId?: string | null;
    altText?: string | null;
  }>): Promise<number> {
    const prod = await prisma.product.create({
      data: {
        name,
        price: 999,
        category: "Skincare",
        description: "task20-test-product",
        stock: 5,
        isActive: true,
        image,
        images: {
          create: galleryItems.map((item, idx) => ({
            url: item.url,
            sortOrder: idx + 1,
            sourceKind: item.sourceKind,
            managedMediaId: item.managedMediaId ?? null,
            altText: item.altText ?? null,
          })),
        },
      },
    });
    return prod.id;
  }

  // ---------------------------------------------------------------------------
  // 1. Zero Provider Calls & Bounded Assembly
  // ---------------------------------------------------------------------------
  it("1. Public reads assemble batched managed media projections with ZERO provider calls", async () => {
    const m1 = await createManagedMediaFixture({ tag: "prod1-managed" });
    const p1Id = await createProduct("Product 1 Managed", m1.primaryCompatibilityUrl, [
      {
        url: m1.primaryCompatibilityUrl,
        sourceKind: "MANAGED",
        managedMediaId: m1.mediaId,
        altText: "Managed Primary Face Serum",
      },
    ]);

    const result = await getPublicProductDetailQuery(p1Id);
    assert.ok(result !== null);
    assert.ok(result.media !== undefined, "PublicProductDetailDTO must include media projection");
    assert.equal(result.media?.primaryKind, "managed");
    assert.ok(result.media?.primarySrc !== null);
    assert.ok(result.media?.primarySrc?.includes("webp-800-prod1-managed.webp"));

    assert.equal(result.media?.gallery.length, 1);
    const item = result.media?.gallery[0];
    assert.equal(item?.kind, "managed");
    if (item?.kind === "managed") {
      assert.equal(item.media.mediaId, m1.mediaId);
      assert.equal(item.altText, "Managed Primary Face Serum");
      assert.ok(item.media.sources.length >= 2, "Must contain AVIF and WebP sources");
      assert.ok(item.media.sources.some((s) => s.type === "image/avif"));
      assert.ok(item.media.sources.some((s) => s.type === "image/webp"));
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Stale Product.image Suspension Bypass Prevention
  // ---------------------------------------------------------------------------
  it("2. Stale Product.image cannot leak suspended managed media into public projection", async () => {
    const suspendedMedia = await createManagedMediaFixture({
      deliveryDisabledAt: new Date(),
      tag: "suspended-leak-test",
    });

    const pId = await createProduct(
      "Product With Suspended Managed Image",
      suspendedMedia.primaryCompatibilityUrl, // Stale compatibility mirror!
      [
        {
          url: suspendedMedia.primaryCompatibilityUrl,
          sourceKind: "MANAGED",
          managedMediaId: suspendedMedia.mediaId,
          altText: "Suspended Item",
        },
      ]
    );

    const detail = await getPublicProductDetailQuery(pId);
    assert.ok(detail !== null);
    assert.ok(detail.media !== undefined);

    // Suspended item MUST NOT appear in primarySrc or gallery!
    assert.notEqual(detail.media?.primarySrc, suspendedMedia.primaryCompatibilityUrl);
    assert.equal(detail.media?.primaryKind, "unavailable");
    assert.equal(detail.media?.gallery.length, 0, "Suspended media must be excluded from public gallery");

    // Complete JSON payload must NOT contain the suspended compatibility URL
    const jsonStr = JSON.stringify(detail);
    assert.equal(
      jsonStr.includes("suspended-leak-test"),
      false,
      "Public JSON response must NEVER contain suspended media URLs"
    );
  });

  // ---------------------------------------------------------------------------
  // 3. Mixed-Gallery Suspension Fallback
  // ---------------------------------------------------------------------------
  it("3. Mixed gallery with suspended first item falls back to safe second item", async () => {
    const suspendedMedia = await createManagedMediaFixture({
      deliveryDisabledAt: new Date(),
      tag: "mixed-suspended",
    });
    const safeMedia = await createManagedMediaFixture({
      deliveryDisabledAt: null,
      tag: "mixed-safe",
    });

    const pId = await createProduct(
      "Product Mixed Gallery",
      suspendedMedia.primaryCompatibilityUrl, // First item is suspended
      [
        {
          url: suspendedMedia.primaryCompatibilityUrl,
          sourceKind: "MANAGED",
          managedMediaId: suspendedMedia.mediaId,
          altText: "Suspended First Item",
        },
        {
          url: safeMedia.primaryCompatibilityUrl,
          sourceKind: "MANAGED",
          managedMediaId: safeMedia.mediaId,
          altText: "Safe Second Item",
        },
      ]
    );

    const detail = await getPublicProductDetailQuery(pId);
    assert.ok(detail !== null);
    assert.ok(detail.media !== undefined);

    // First safe item is safeMedia (position 2)!
    assert.equal(detail.media?.primaryKind, "managed");
    assert.ok(detail.media?.primarySrc?.includes("mixed-safe"));
    assert.notEqual(detail.media?.primarySrc, suspendedMedia.primaryCompatibilityUrl);

    // Gallery must only contain the 1 safe item
    assert.equal(detail.media?.gallery.length, 1);
    assert.equal(detail.media?.gallery[0].kind, "managed");
    if (detail.media?.gallery[0].kind === "managed") {
      assert.equal(detail.media.gallery[0].media.mediaId, safeMedia.mediaId);
    }

    // Suspended URL must be absent
    const jsonStr = JSON.stringify(detail);
    assert.equal(jsonStr.includes("mixed-suspended"), false);
  });

  // ---------------------------------------------------------------------------
  // 4. Legacy Product Compatibility
  // ---------------------------------------------------------------------------
  it("4. Genuine legacy product produces legacy media projection with zero regression", async () => {
    const legacyUrl = "https://images.example.com/legacy-cream.jpg";
    const pId = await createProduct("Legacy Product", legacyUrl, [
      {
        url: legacyUrl,
        sourceKind: "LEGACY_EXTERNAL",
        altText: "Legacy Cream",
      },
    ]);

    const detail = await getPublicProductDetailQuery(pId);
    assert.ok(detail !== null);
    assert.ok(detail.media !== undefined);

    assert.equal(detail.media?.primaryKind, "legacy");
    assert.equal(detail.media?.primarySrc, legacyUrl);
    assert.equal(detail.media?.gallery.length, 1);
    assert.equal(detail.media?.gallery[0].kind, "legacy");
    if (detail.media?.gallery[0].kind === "legacy") {
      assert.equal(detail.media.gallery[0].src, legacyUrl);
      assert.equal(detail.media.gallery[0].altText, "Legacy Cream");
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Catalog Card List Query Batched Projection
  // ---------------------------------------------------------------------------
  it("5. getPublicCatalogQuery populates media projection in bulk without N+1 queries", async () => {
    const m = await createManagedMediaFixture({ tag: "catalog-card" });
    await createProduct("Catalog Card Product", m.primaryCompatibilityUrl, [
      {
        url: m.primaryCompatibilityUrl,
        sourceKind: "MANAGED",
        managedMediaId: m.mediaId,
        altText: "Card Image",
      },
    ]);

    const res = await getPublicCatalogQuery({
      page: 1,
      pageSize: 10,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Catalog Card Product",
      skip: 0,
      invalidFilter: false,
    });

    assert.equal(res.success, true);
    assert.ok(res.items.length >= 1);
    const card = res.items.find((it) => it.name === "Catalog Card Product");
    assert.ok(card !== undefined);
    assert.ok(card?.media !== undefined, "Catalog card DTO must include media projection");
    assert.equal(card?.media?.primaryKind, "managed");
    assert.ok(card?.media?.primarySrc?.includes("catalog-card"));
  });
});
