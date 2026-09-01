import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { validateTestDatabaseSafety } from "./integration/db-safety";
import type { PrismaClient } from "../generated/prisma/client";
import type {
  getAdminCatalogQuery as GetAdminCatalogQueryType,
  getAdminProductDetailQuery as GetAdminProductDetailQueryType,
} from "../lib/catalog/adminCatalogQuery";

const safety = validateTestDatabaseSafety();

describe(
  "Phase 5 Task 3 — Admin Catalog Query Model & Exact Discount Predicate Integration Suite",
  {
    skip:
      !safety.safe &&
      "TEST_DATABASE_REQUIRED: Set DATABASE_URL_TEST to run real PostgreSQL admin catalog integration tests",
  },
  () => {
    const runKey = `p5_admin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const nameSearchToken = `namesearch_${runKey}`;
    const catSearchToken = `catsearch_${runKey}`;
    const subcatSearchToken = `subcatsearch_${runKey}`;
    const descOnlyToken = `desconly_${runKey}`;

    let prisma: PrismaClient;
    let getAdminCatalogQuery: typeof GetAdminCatalogQueryType;
    let getAdminProductDetailQuery: typeof GetAdminProductDetailQueryType;

    // Track created IDs for strict reverse cleanup
    const createdCategoryIds: number[] = [];
    const createdSubcategoryIds: number[] = [];
    const createdProductIds: number[] = [];
    const createdVariantIds: number[] = [];

    let prodActiveId: number;
    let prodInactiveId: number;
    let prodDeletedId: number;
    let prodHotId: number;
    let prodUpcomingId: number;
    let prodBadgeId: number;
    let prodDiscTrueId: number;
    let prodDiscEqualId: number;
    let prodDiscReversedId: number;
    let prodDiscNullId: number;
    let prodNameSearchId: number;
    let prodCatSearchId: number;
    let prodSubcatSearchId: number;
    let prodDescOnlyId: number;
    let prodNoVariantsId: number;
    let prodInactiveVariantOnlyId: number;
    let prodMixedVariantsId: number;
    let prodDetailTargetId: number;
    let prodDetailInactiveId: number;

    const paginationProductIds: number[] = [];

    before(async () => {
      // 1. Establish test database environment BEFORE dynamic import
      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";

      const prismaModule = await import("../lib/prisma");
      prisma = prismaModule.prisma;

      const queryModule = await import("../lib/catalog/adminCatalogQuery");
      getAdminCatalogQuery = queryModule.getAdminCatalogQuery;
      getAdminProductDetailQuery = queryModule.getAdminProductDetailQuery;

      // 2. Create Category Fixture
      const catA = await prisma.category.create({
        data: {
          name: `Admin Category ${runKey}`,
          slug: `admin-cat-${runKey}`,
          isActive: true,
          sortOrder: 1,
        },
      });
      createdCategoryIds.push(catA.id);

      // 3. Create Core Lifecycle Fixtures
      const pActive = await prisma.product.create({
        data: {
          name: `Active Product ${runKey}`,
          price: 100.0,
          compareAtPrice: null,
          image: "/images/active.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          subcategory: `Sub ${runKey}`,
          isActive: true,
          stock: 10,
        },
      });
      prodActiveId = pActive.id;
      createdProductIds.push(pActive.id);

      const pInactive = await prisma.product.create({
        data: {
          name: `Inactive Product ${runKey}`,
          price: 100.0,
          compareAtPrice: null,
          image: "/images/inactive.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          subcategory: `Sub ${runKey}`,
          isActive: false,
          stock: 10,
        },
      });
      prodInactiveId = pInactive.id;
      createdProductIds.push(pInactive.id);

      const pDeleted = await prisma.product.create({
        data: {
          name: `Deleted Product ${runKey}`,
          price: 100.0,
          compareAtPrice: null,
          image: "/images/deleted.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          subcategory: `Sub ${runKey}`,
          isActive: true,
          deletedAt: new Date(),
          stock: 10,
        },
      });
      prodDeletedId = pDeleted.id;
      createdProductIds.push(pDeleted.id);

      // 4. Create Filter Fixtures (hot, upcoming, badge)
      const pHot = await prisma.product.create({
        data: {
          name: `Hot Deal Product ${runKey}`,
          price: 110.0,
          compareAtPrice: null,
          image: "/images/hot.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          isActive: true,
          isHotDeal: true,
          isUpcoming: false,
          stock: 15,
        },
      });
      prodHotId = pHot.id;
      createdProductIds.push(pHot.id);

      const pUpcoming = await prisma.product.create({
        data: {
          name: `Upcoming Product ${runKey}`,
          price: 120.0,
          compareAtPrice: null,
          image: "/images/upcoming.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          isActive: true,
          isHotDeal: false,
          isUpcoming: true,
          stock: 0,
        },
      });
      prodUpcomingId = pUpcoming.id;
      createdProductIds.push(pUpcoming.id);

      const pBadge = await prisma.product.create({
        data: {
          name: `Badge Product ${runKey}`,
          price: 130.0,
          compareAtPrice: null,
          image: "/images/badge.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          isActive: true,
          badgeText: "Festival Sale",
          badgeTone: "festival",
          stock: 20,
        },
      });
      prodBadgeId = pBadge.id;
      createdProductIds.push(pBadge.id);

      // 5. Create Exact Discount Predicate Fixtures
      // A: compareAtPrice (150) > price (100) -> MUST MATCH
      const pDiscTrue = await prisma.product.create({
        data: {
          name: `True Discount ${runKey}`,
          price: 100.0,
          compareAtPrice: 150.0,
          image: "/images/disc-true.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          isActive: true,
          stock: 10,
        },
      });
      prodDiscTrueId = pDiscTrue.id;
      createdProductIds.push(pDiscTrue.id);

      // B: compareAtPrice (100) === price (100) -> MUST NOT MATCH
      const pDiscEqual = await prisma.product.create({
        data: {
          name: `Equal Price Non-Discount ${runKey}`,
          price: 100.0,
          compareAtPrice: 100.0,
          image: "/images/disc-equal.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          isActive: true,
          stock: 10,
        },
      });
      prodDiscEqualId = pDiscEqual.id;
      createdProductIds.push(pDiscEqual.id);

      // C: compareAtPrice (80) < price (100) -> MUST NOT MATCH
      const pDiscReversed = await prisma.product.create({
        data: {
          name: `Reversed Price Non-Discount ${runKey}`,
          price: 100.0,
          compareAtPrice: 80.0,
          image: "/images/disc-rev.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          isActive: true,
          stock: 10,
        },
      });
      prodDiscReversedId = pDiscReversed.id;
      createdProductIds.push(pDiscReversed.id);

      // D: compareAtPrice === null -> MUST NOT MATCH
      const pDiscNull = await prisma.product.create({
        data: {
          name: `Null Compare Price Non-Discount ${runKey}`,
          price: 100.0,
          compareAtPrice: null,
          image: "/images/disc-null.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          isActive: true,
          stock: 10,
        },
      });
      prodDiscNullId = pDiscNull.id;
      createdProductIds.push(pDiscNull.id);

      // Additional 25 discount products to test multi-page bounded discount pagination
      for (let i = 1; i <= 25; i++) {
        const pDiscPad = await prisma.product.create({
          data: {
            name: `Discount Padding ${String(i).padStart(2, "0")} ${runKey}`,
            price: 50.0 + i,
            compareAtPrice: 100.0 + i, // > price
            image: `/images/disc-pad-${i}.png`,
            category: `General ${runKey}`,
            categoryId: catA.id,
            isActive: true,
            stock: 10,
          },
        });
        createdProductIds.push(pDiscPad.id);
      }

      // 6. Create Search Authority Fixtures
      const pNameSearch = await prisma.product.create({
        data: {
          name: `Alpha Product ${nameSearchToken}`,
          price: 90.0,
          image: "/images/namesearch.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          subcategory: `Sub ${runKey}`,
          isActive: true,
          stock: 5,
        },
      });
      prodNameSearchId = pNameSearch.id;
      createdProductIds.push(pNameSearch.id);

      const pCatSearch = await prisma.product.create({
        data: {
          name: `Beta Product ${runKey}`,
          price: 95.0,
          image: "/images/catsearch.png",
          category: `Category ${catSearchToken}`,
          categoryId: catA.id,
          subcategory: `Sub ${runKey}`,
          isActive: true,
          stock: 5,
        },
      });
      prodCatSearchId = pCatSearch.id;
      createdProductIds.push(pCatSearch.id);

      const pSubcatSearch = await prisma.product.create({
        data: {
          name: `Gamma Product ${runKey}`,
          price: 98.0,
          image: "/images/subcatsearch.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          subcategory: `Subcategory ${subcatSearchToken}`,
          isActive: true,
          stock: 5,
        },
      });
      prodSubcatSearchId = pSubcatSearch.id;
      createdProductIds.push(pSubcatSearch.id);

      const pDescOnly = await prisma.product.create({
        data: {
          name: `Delta Product ${runKey}`,
          description: `This product has secret description ${descOnlyToken}`,
          price: 99.0,
          image: "/images/desconly.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          subcategory: `Sub ${runKey}`,
          isActive: true,
          stock: 5,
        },
      });
      prodDescOnlyId = pDescOnly.id;
      createdProductIds.push(pDescOnly.id);

      // 7. Create Variant Count & Projection Fixtures
      // P_NoVariants: no variants -> variantCount: 0, hasVariants: false
      const pNoVar = await prisma.product.create({
        data: {
          name: `No Variants Product ${runKey}`,
          price: 70.0,
          image: "/images/novar.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          isActive: true,
          stock: 12,
        },
      });
      prodNoVariantsId = pNoVar.id;
      createdProductIds.push(pNoVar.id);

      // P_InactiveVariantOnly: 1 inactive variant -> variantCount: 0, hasVariants: false
      const pInactVar = await prisma.product.create({
        data: {
          name: `Inactive Variant Only Product ${runKey}`,
          price: 80.0,
          image: "/images/inactvar.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          isActive: true,
          stock: 14,
        },
      });
      prodInactiveVariantOnlyId = pInactVar.id;
      createdProductIds.push(pInactVar.id);

      const vInactive1 = await prisma.productVariant.create({
        data: {
          productId: pInactVar.id,
          label: "Inactive Size",
          price: 80.0,
          stock: 5,
          isActive: false,
          sortOrder: 1,
        },
      });
      createdVariantIds.push(vInactive1.id);

      // P_MixedVariants: 2 active variants + 1 inactive variant -> variantCount: 2, hasVariants: true
      const pMixedVar = await prisma.product.create({
        data: {
          name: `Mixed Variants Product ${runKey}`,
          price: 90.0,
          image: "/images/mixedvar.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          isActive: true,
          stock: 25,
        },
      });
      prodMixedVariantsId = pMixedVar.id;
      createdProductIds.push(pMixedVar.id);

      const vMixedActive1 = await prisma.productVariant.create({
        data: {
          productId: pMixedVar.id,
          label: "Active Size 50ml",
          price: 90.0,
          stock: 10,
          isActive: true,
          sortOrder: 2,
        },
      });
      createdVariantIds.push(vMixedActive1.id);

      const vMixedInactive = await prisma.productVariant.create({
        data: {
          productId: pMixedVar.id,
          label: "Inactive Size 75ml",
          price: 110.0,
          stock: 5,
          isActive: false,
          sortOrder: 1,
        },
      });
      createdVariantIds.push(vMixedInactive.id);

      const vMixedActive2 = await prisma.productVariant.create({
        data: {
          productId: pMixedVar.id,
          label: "Active Size 100ml",
          price: 120.0,
          stock: 10,
          isActive: true,
          sortOrder: 1,
        },
      });
      createdVariantIds.push(vMixedActive2.id);

      // 8. Create Admin Detail Fixture with full variants & audit state
      const pDetail = await prisma.product.create({
        data: {
          name: `Detail Target Product ${runKey}`,
          price: 250.0,
          compareAtPrice: 300.0,
          image: "/images/detail.png",
          category: `Luxury Care ${runKey}`,
          categoryId: catA.id,
          subcategory: `Night Cream ${runKey}`,
          description: `Comprehensive admin detail description for ${runKey}`,
          stock: 50,
          isHotDeal: true,
          isUpcoming: false,
          badgeText: "Admin Pick",
          badgeTone: "new",
          isActive: true,
        },
      });
      prodDetailTargetId = pDetail.id;
      createdProductIds.push(pDetail.id);

      const vDetail1 = await prisma.productVariant.create({
        data: {
          productId: pDetail.id,
          label: "Jar 50g",
          price: 250.0,
          stock: 30,
          image: "/images/jar-50.png",
          isActive: true,
          sortOrder: 2,
        },
      });
      createdVariantIds.push(vDetail1.id);

      const vDetail2 = await prisma.productVariant.create({
        data: {
          productId: pDetail.id,
          label: "Jar 100g",
          price: 450.0,
          stock: 20,
          image: "/images/jar-100.png",
          isActive: false,
          sortOrder: 1,
        },
      });
      createdVariantIds.push(vDetail2.id);

      // Inactive product for admin detail lookup audit state
      const pDetailInactive = await prisma.product.create({
        data: {
          name: `Detail Inactive Product ${runKey}`,
          price: 50.0,
          compareAtPrice: null,
          image: "/images/inactive-detail.png",
          category: `General ${runKey}`,
          categoryId: catA.id,
          description: "Inactive detail description",
          isActive: false,
          stock: 0,
        },
      });
      prodDetailInactiveId = pDetailInactive.id;
      createdProductIds.push(pDetailInactive.id);

      // 9. Create 24 Padding Products for pagination boundary tests
      for (let i = 1; i <= 24; i++) {
        const pad = await prisma.product.create({
          data: {
            name: `Padding Product ${String(i).padStart(2, "0")} ${runKey}`,
            price: 50.0 + i,
            image: `/images/pad-${i}.png`,
            category: `General ${runKey}`,
            categoryId: catA.id,
            isActive: true,
            stock: 10,
          },
        });
        paginationProductIds.push(pad.id);
        createdProductIds.push(pad.id);
      }
    });

    after(async () => {
      // Reverse-FK cleanup
      if (prisma) {
        if (createdVariantIds.length > 0) {
          await prisma.productVariant.deleteMany({
            where: { id: { in: createdVariantIds } },
          }).catch(() => {});
        }
        if (createdProductIds.length > 0) {
          await prisma.product.deleteMany({
            where: { id: { in: createdProductIds } },
          }).catch(() => {});
        }
        if (createdSubcategoryIds.length > 0) {
          await prisma.subcategory.deleteMany({
            where: { id: { in: createdSubcategoryIds } },
          }).catch(() => {});
        }
        if (createdCategoryIds.length > 0) {
          await prisma.category.deleteMany({
            where: { id: { in: createdCategoryIds } },
          }).catch(() => {});
        }
        await prisma.$disconnect().catch(() => {});
      }
    });

    // -------------------------------------------------------------------------
    // A. Admin List Lifecycle (isActive=true & deletedAt=null)
    // -------------------------------------------------------------------------
    it("admin list includes active, non-deleted products", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "all",
        q: runKey,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(matchedIds.includes(prodActiveId), "Must include active product");
    });

    it("admin list excludes inactive products", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "all",
        q: runKey,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(!matchedIds.includes(prodInactiveId), "Must exclude inactive product");
    });

    it("admin list excludes soft-deleted products", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "all",
        q: runKey,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(!matchedIds.includes(prodDeletedId), "Must exclude soft-deleted product");
    });

    // -------------------------------------------------------------------------
    // B. Exact Discount Predicate (compareAtPrice > price)
    // -------------------------------------------------------------------------
    it("filter=discount matches products where compareAtPrice > price", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "discount",
        q: runKey,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(
        matchedIds.includes(prodDiscTrueId),
        "Must match product where compareAtPrice (150) > price (100)"
      );
    });

    it("filter=discount excludes products where compareAtPrice == price", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "discount",
        q: runKey,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(
        !matchedIds.includes(prodDiscEqualId),
        "Must NOT match product where compareAtPrice (100) == price (100)"
      );
    });

    it("filter=discount excludes products where compareAtPrice < price", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "discount",
        q: runKey,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(
        !matchedIds.includes(prodDiscReversedId),
        "Must NOT match product where compareAtPrice (80) < price (100)"
      );
    });

    it("filter=discount excludes products where compareAtPrice IS NULL", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "discount",
        q: runKey,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(
        !matchedIds.includes(prodDiscNullId),
        "Must NOT match product where compareAtPrice is null"
      );
    });

    it("filter=discount paginates multi-page discount slices without unbounded ID materialization", async () => {
      const page1 = await getAdminCatalogQuery({
        page: 1,
        pageSize: 20,
        filter: "discount",
        q: runKey,
        skip: 0,
      });

      assert.strictEqual(page1.page, 1);
      assert.strictEqual(page1.pageSize, 20);
      assert.strictEqual(page1.items.length, 20);
      assert.strictEqual(page1.totalItems, 27, "Expected 25 padding + 1 true discount + 1 detail target products");
      assert.strictEqual(page1.totalPages, 2);
      assert.strictEqual(page1.hasMore, true);
      assert.strictEqual(page1.nextPage, 2);

      const page2 = await getAdminCatalogQuery({
        page: 2,
        pageSize: 20,
        filter: "discount",
        q: runKey,
        skip: 20,
      });

      assert.strictEqual(page2.page, 2);
      assert.strictEqual(page2.pageSize, 20);
      assert.strictEqual(page2.items.length, 7);
      assert.strictEqual(page2.hasMore, false);
      assert.strictEqual(page2.nextPage, null);

      const page1Ids = new Set(page1.items.map((i) => i.id));
      for (const item of page2.items) {
        assert.ok(
          !page1Ids.has(item.id),
          `ID ${item.id} must not appear on both page 1 and page 2`
        );
      }
    });

    it("filter=discount executes zero standalone $queryRaw discount ID precursor queries", async () => {
      let rawQueryCount = 0;
      const prismaRecord = prisma as unknown as { $queryRaw: (...args: unknown[]) => Promise<unknown> };
      const originalQueryRaw = prismaRecord.$queryRaw;

      prismaRecord.$queryRaw = async (...args: unknown[]) => {
        rawQueryCount++;
        return originalQueryRaw.apply(prisma, args);
      };

      try {
        const result = await getAdminCatalogQuery({
          page: 1,
          pageSize: 20,
          filter: "discount",
          q: runKey,
          skip: 0,
        });

        assert.strictEqual(
          rawQueryCount,
          0,
          "filter=discount must not execute precursor $queryRaw discount ID select"
        );
        assert.ok(result.items.length > 0);
      } finally {
        prismaRecord.$queryRaw = originalQueryRaw;
      }
    });

    // -------------------------------------------------------------------------
    // C. Admin Filters (hot, upcoming, badge)
    // -------------------------------------------------------------------------
    it("filter=all returns all active non-deleted products matching query", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "all",
        q: runKey,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(matchedIds.includes(prodActiveId));
      assert.ok(matchedIds.includes(prodHotId));
      assert.ok(matchedIds.includes(prodUpcomingId));
      assert.ok(matchedIds.includes(prodBadgeId));
    });

    it("filter=hot returns isHotDeal=true products only", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "hot",
        q: runKey,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(matchedIds.includes(prodHotId), "Must match hot deal product");
      assert.ok(!matchedIds.includes(prodActiveId), "Must exclude non-hot product");
      assert.ok(!matchedIds.includes(prodUpcomingId), "Must exclude upcoming product");
    });

    it("filter=upcoming returns isUpcoming=true products only", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "upcoming",
        q: runKey,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(matchedIds.includes(prodUpcomingId), "Must match upcoming product");
      assert.ok(!matchedIds.includes(prodActiveId), "Must exclude non-upcoming product");
      assert.ok(!matchedIds.includes(prodHotId), "Must exclude hot deal product");
    });

    it("filter=badge returns badgeText IS NOT NULL products only", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "badge",
        q: runKey,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(matchedIds.includes(prodBadgeId), "Must match product with badgeText");
      assert.ok(!matchedIds.includes(prodActiveId), "Must exclude product without badge");
    });

    // -------------------------------------------------------------------------
    // D. Admin Search (name, category, subcategory, exact numeric ID)
    // -------------------------------------------------------------------------
    it("searches Product.name", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "all",
        q: nameSearchToken,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(matchedIds.includes(prodNameSearchId), "Must match product name");
      assert.ok(!matchedIds.includes(prodActiveId), "Must exclude other products");
    });

    it("searches Product.category string", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "all",
        q: catSearchToken,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(matchedIds.includes(prodCatSearchId), "Must match product category");
      assert.ok(!matchedIds.includes(prodActiveId), "Must exclude other products");
    });

    it("searches Product.subcategory string", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "all",
        q: subcatSearchToken,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(matchedIds.includes(prodSubcatSearchId), "Must match product subcategory");
      assert.ok(!matchedIds.includes(prodActiveId), "Must exclude other products");
    });

    it("q=exact positive integer ID matches target product", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "all",
        q: String(prodActiveId),
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(matchedIds.includes(prodActiveId), "Must match exact product ID");
    });

    it("strictly excludes Product.description from admin search matching", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "all",
        q: descOnlyToken,
        skip: 0,
      });

      const matchedIds = result.items.map((p) => p.id);
      assert.ok(
        !matchedIds.includes(prodDescOnlyId),
        "Must not match product whose description contains search token"
      );
      assert.strictEqual(result.totalItems, 0);
      assert.deepStrictEqual(result.items, []);
    });

    // -------------------------------------------------------------------------
    // E. Pagination & Deterministic Order
    // -------------------------------------------------------------------------
    it("paginates bounded slices accurately with zero ID overlap between pages", async () => {
      const page1 = await getAdminCatalogQuery({
        page: 1,
        pageSize: 15,
        filter: "all",
        q: runKey,
        skip: 0,
      });

      assert.strictEqual(page1.page, 1);
      assert.strictEqual(page1.pageSize, 15);
      assert.strictEqual(page1.items.length, 15);
      assert.strictEqual(page1.hasMore, true);
      assert.strictEqual(page1.nextPage, 2);

      const page2 = await getAdminCatalogQuery({
        page: 2,
        pageSize: 15,
        filter: "all",
        q: runKey,
        skip: 15,
      });

      assert.strictEqual(page2.page, 2);
      assert.strictEqual(page2.pageSize, 15);
      assert.ok(page2.items.length > 0);

      const page1Ids = new Set(page1.items.map((i) => i.id));
      for (const item of page2.items) {
        assert.ok(
          !page1Ids.has(item.id),
          `ID ${item.id} must not appear on both page 1 and page 2`
        );
      }
    });

    it("returns empty items array with truthful metadata on out-of-range page", async () => {
      const outOfRange = await getAdminCatalogQuery({
        page: 999,
        pageSize: 20,
        filter: "all",
        q: runKey,
        skip: 998 * 20,
      });

      assert.strictEqual(outOfRange.page, 999);
      assert.strictEqual(outOfRange.items.length, 0);
      assert.ok(outOfRange.totalItems > 0);
      assert.ok(outOfRange.totalPages > 0);
      assert.strictEqual(outOfRange.hasMore, false);
      assert.strictEqual(outOfRange.nextPage, null);
    });

    it("orders products by id DESC", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 20,
        filter: "all",
        q: runKey,
        skip: 0,
      });

      for (let i = 0; i < result.items.length - 1; i++) {
        assert.ok(
          result.items[i].id > result.items[i + 1].id,
          `Expected ${result.items[i].id} > ${result.items[i + 1].id}`
        );
      }
    });

    // -------------------------------------------------------------------------
    // F. DTO Projection & Variant Aggregates
    // -------------------------------------------------------------------------
    it("projects exact AdminProductListDTO fields and excludes forbidden fields (description, deletedAt, updatedAt, variants[])", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "all",
        q: runKey,
        skip: 0,
      });

      const card = result.items.find((p) => p.id === prodBadgeId);
      assert.ok(card, "Target badge product must exist in list");

      // Verify exact projected fields
      assert.strictEqual(typeof card.id, "number");
      assert.strictEqual(typeof card.name, "string");
      assert.strictEqual(typeof card.price, "number");
      assert.strictEqual(typeof card.image, "string");
      assert.strictEqual(typeof card.category, "string");
      assert.strictEqual(typeof card.stock, "number");
      assert.strictEqual(typeof card.isHotDeal, "boolean");
      assert.strictEqual(typeof card.isUpcoming, "boolean");
      assert.strictEqual(card.badgeText, "Festival Sale");
      assert.strictEqual(card.badgeTone, "festival");
      assert.strictEqual(card.isActive, true);
      assert.strictEqual(typeof card.createdAt, "string");
      assert.strictEqual(typeof card.variantCount, "number");
      assert.strictEqual(typeof card.hasVariants, "boolean");

      // Verify forbidden list fields are undefined
      const rawCard = card as unknown as Record<string, unknown>;
      assert.strictEqual(rawCard.description, undefined);
      assert.strictEqual(rawCard.deletedAt, undefined);
      assert.strictEqual(rawCard.updatedAt, undefined);
      assert.strictEqual(rawCard.variants, undefined);
    });

    it("calculates variantCount and hasVariants based strictly on ACTIVE variants", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "all",
        q: runKey,
        skip: 0,
      });

      const noVarCard = result.items.find((p) => p.id === prodNoVariantsId);
      assert.ok(noVarCard);
      assert.strictEqual(noVarCard.variantCount, 0, "No variants product must have variantCount = 0");
      assert.strictEqual(noVarCard.hasVariants, false, "No variants product must have hasVariants = false");

      const inactVarCard = result.items.find((p) => p.id === prodInactiveVariantOnlyId);
      assert.ok(inactVarCard);
      assert.strictEqual(
        inactVarCard.variantCount,
        0,
        "Product with only inactive variant must have active variantCount = 0"
      );
      assert.strictEqual(
        inactVarCard.hasVariants,
        false,
        "Product with only inactive variant must have hasVariants = false"
      );

      const mixedVarCard = result.items.find((p) => p.id === prodMixedVariantsId);
      assert.ok(mixedVarCard);
      assert.strictEqual(
        mixedVarCard.variantCount,
        2,
        "Product with 2 active + 1 inactive variants must have active variantCount = 2"
      );
      assert.strictEqual(
        mixedVarCard.hasVariants,
        true,
        "Product with active variants must have hasVariants = true"
      );
    });

    // -------------------------------------------------------------------------
    // G. Admin Product Detail Query
    // -------------------------------------------------------------------------
    it("getAdminProductDetailQuery returns full AdminProductDetailDTO including all variants and audit fields", async () => {
      const detail = await getAdminProductDetailQuery(prodDetailTargetId);
      assert.ok(detail, "Detail query must return product");

      // Verify list fields
      assert.strictEqual(detail.id, prodDetailTargetId);
      assert.strictEqual(detail.name, `Detail Target Product ${runKey}`);
      assert.strictEqual(detail.price, 250.0);
      assert.strictEqual(detail.compareAtPrice, 300.0);
      assert.strictEqual(detail.badgeText, "Admin Pick");
      assert.strictEqual(detail.badgeTone, "new");
      assert.strictEqual(detail.isHotDeal, true);
      assert.strictEqual(detail.isUpcoming, false);
      assert.strictEqual(detail.variantCount, 1); // 1 active variant
      assert.strictEqual(detail.hasVariants, true);

      // Verify detail fields
      assert.strictEqual(detail.description, `Comprehensive admin detail description for ${runKey}`);
      assert.strictEqual(detail.deletedAt, null);
      assert.strictEqual(typeof detail.updatedAt, "string");
      assert.strictEqual(detail.variants.length, 2, "Must include BOTH active and inactive variants");
    });

    it("getAdminProductDetailQuery orders variants by sortOrder ASC, id ASC", async () => {
      const detail = await getAdminProductDetailQuery(prodDetailTargetId);
      assert.ok(detail);
      assert.strictEqual(detail.variants.length, 2);

      // First variant should be sortOrder=1 (Jar 100g)
      assert.strictEqual(detail.variants[0].label, "Jar 100g");
      assert.strictEqual(detail.variants[0].sortOrder, 1);
      assert.strictEqual(detail.variants[0].isActive, false);
      assert.strictEqual(detail.variants[0].price, 450.0);

      // Second variant should be sortOrder=2 (Jar 50g)
      assert.strictEqual(detail.variants[1].label, "Jar 50g");
      assert.strictEqual(detail.variants[1].sortOrder, 2);
      assert.strictEqual(detail.variants[1].isActive, true);
      assert.strictEqual(detail.variants[1].price, 250.0);
    });

    it("getAdminProductDetailQuery returns null for nonexistent product ID", async () => {
      const detail = await getAdminProductDetailQuery(99999999);
      assert.strictEqual(detail, null);
    });

    it("getAdminProductDetailQuery preserves audit fields for inactive product lookup", async () => {
      const detail = await getAdminProductDetailQuery(prodDetailInactiveId);
      assert.ok(detail, "Admin detail should return inactive product without PDP lifecycle restriction");
      assert.strictEqual(detail.isActive, false);
      assert.strictEqual(detail.description, "Inactive detail description");
    });

    // -------------------------------------------------------------------------
    // H. Decimal Monetary Boundary Confirmation
    // -------------------------------------------------------------------------
    it("DTO presentation boundary converts price and compareAtPrice Decimal fields to numbers", async () => {
      const result = await getAdminCatalogQuery({
        page: 1,
        pageSize: 100,
        filter: "discount",
        q: runKey,
        skip: 0,
      });

      const discProduct = result.items.find((p) => p.id === prodDiscTrueId);
      assert.ok(discProduct);
      assert.strictEqual(typeof discProduct.price, "number");
      assert.strictEqual(typeof discProduct.compareAtPrice, "number");
      assert.strictEqual(discProduct.price, 100.0);
      assert.strictEqual(discProduct.compareAtPrice, 150.0);
    });
  }
);
