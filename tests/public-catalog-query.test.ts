import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { validateTestDatabaseSafety } from "./integration/db-safety";
import type { PrismaClient } from "../generated/prisma/client";
import type {
  getPublicCatalogQuery as GetPublicCatalogQueryType,
  getPublicProductDetailQuery as GetPublicProductDetailQueryType,
} from "../lib/catalog/publicCatalogQuery";

const safety = validateTestDatabaseSafety();

describe(
  "Phase 5 Task 2 — Public Catalog Database Queries Integration Suite",
  {
    skip:
      !safety.safe &&
      "TEST_DATABASE_REQUIRED: Set DATABASE_URL_TEST to run real PostgreSQL catalog integration tests",
  },
  () => {
    const runKey = `p5_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const catASlug = `skincare-${runKey}`;
    const catBSlug = `haircare-${runKey}`;
    const catCSlug = `inactive-cat-${runKey}`;
    const subcatASlug = `face-serum-${runKey}`;
    const subcatBSlug = `shampoo-${runKey}`;
    const subcatBName = `Shampoo ${runKey}`;
    const prodNameSearchToken = `prodname_search_${runKey}`;
    const catSearchToken = `cat_search_${runKey}`;
    const subcatSearchToken = `subcat_search_${runKey}`;
    const subcatAName = `Face Serum ${subcatSearchToken}`;
    const descOnlyToken = `desc_only_token_${runKey}`;

    let prisma: PrismaClient;
    let getPublicCatalogQuery: typeof GetPublicCatalogQueryType;
    let getPublicProductDetailQuery: typeof GetPublicProductDetailQueryType;

    // Track created IDs for strict reverse cleanup
    const createdCategoryIds: number[] = [];
    const createdSubcategoryIds: number[] = [];
    const createdProductIds: number[] = [];
    const createdVariantIds: number[] = [];

    let catAId: number;
    let prod1SlugSubId: number;
    let prod2NameSubId: number;
    let prod4CatBId: number;
    let prod5InactiveId: number;
    let prod6DeletedId: number;
    let prod8NoVariantsId: number;
    let prod9InactiveVariantsId: number;
    let prod10ActiveVariantsId: number;
    let prod11DetailId: number;

    before(async () => {
      // 1. Set DATABASE_URL to DATABASE_URL_TEST BEFORE dynamically importing Prisma
      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";

      const prismaModule = await import("../lib/prisma");
      prisma = prismaModule.prisma;

      const queryModule = await import("../lib/catalog/publicCatalogQuery");
      getPublicCatalogQuery = queryModule.getPublicCatalogQuery;
      getPublicProductDetailQuery = queryModule.getPublicProductDetailQuery;

      // 2. Create Active Category A
      const catA = await prisma.category.create({
        data: {
          name: `Skin Care ${catSearchToken}`,
          slug: catASlug,
          isActive: true,
          sortOrder: 1,
        },
      });
      catAId = catA.id;
      createdCategoryIds.push(catA.id);

      // Create Active Subcategory A under Category A
      const subcatA = await prisma.subcategory.create({
        data: {
          categoryId: catA.id,
          name: subcatAName,
          slug: subcatASlug,
          isActive: true,
          sortOrder: 1,
        },
      });
      createdSubcategoryIds.push(subcatA.id);

      // 3. Create Active Category B
      const catB = await prisma.category.create({
        data: {
          name: `Hair Care ${runKey}`,
          slug: catBSlug,
          isActive: true,
          sortOrder: 2,
        },
      });
      createdCategoryIds.push(catB.id);

      // Create Active Subcategory B under Category B
      const subcatB = await prisma.subcategory.create({
        data: {
          categoryId: catB.id,
          name: subcatBName,
          slug: subcatBSlug,
          isActive: true,
          sortOrder: 1,
        },
      });
      createdSubcategoryIds.push(subcatB.id);

      // 4. Create Inactive Category C
      const catC = await prisma.category.create({
        data: {
          name: `Inactive Cat ${runKey}`,
          slug: catCSlug,
          isActive: false,
          sortOrder: 3,
        },
      });
      createdCategoryIds.push(catC.id);

      // 5. Create Synthetic Products under Category A
      // Prod 1: Dual-format Slug-backed Subcategory
      const p1 = await prisma.product.create({
        data: {
          name: `Alpha Serum ${prodNameSearchToken}`,
          price: 100.0,
          image: "/images/p1.png",
          category: "MISMATCHED_DISPLAY_SNAPSHOT_A",
          categoryId: catA.id,
          subcategory: subcatASlug, // slug-backed
          isActive: true,
          stock: 10,
        },
      });
      prod1SlugSubId = p1.id;
      createdProductIds.push(p1.id);

      // Prod 2: Dual-format Display-Name-backed Subcategory
      const p2 = await prisma.product.create({
        data: {
          name: `Beta Serum ${runKey}`,
          price: 200.0,
          image: "/images/p2.png",
          category: "MISMATCHED_DISPLAY_SNAPSHOT_A",
          categoryId: catA.id,
          subcategory: subcatAName, // display-name-backed
          isActive: true,
          stock: 5,
        },
      });
      prod2NameSubId = p2.id;
      createdProductIds.push(p2.id);

      // Prod 3: Equal Price to Prod 1 (100.00) for deterministic ID tiebreak test
      const p3 = await prisma.product.create({
        data: {
          name: `Gamma Serum ${runKey}`,
          price: 100.0,
          image: "/images/p3.png",
          category: "MISMATCHED_DISPLAY_SNAPSHOT_A",
          categoryId: catA.id,
          subcategory: subcatASlug,
          isActive: true,
          stock: 8,
        },
      });
      createdProductIds.push(p3.id);

      // Prod 4: Category B Product
      const p4 = await prisma.product.create({
        data: {
          name: `Delta Shampoo ${runKey}`,
          price: 50.0,
          image: "/images/p4.png",
          category: "MISMATCHED_DISPLAY_SNAPSHOT_B",
          categoryId: catB.id,
          subcategory: subcatBSlug,
          isActive: true,
          stock: 20,
        },
      });
      prod4CatBId = p4.id;
      createdProductIds.push(p4.id);

      // Prod 5: Inactive Product
      const p5 = await prisma.product.create({
        data: {
          name: `Inactive Product ${runKey}`,
          price: 150.0,
          image: "/images/p5.png",
          category: "MISMATCHED_DISPLAY_SNAPSHOT_A",
          categoryId: catA.id,
          subcategory: subcatASlug,
          isActive: false,
          stock: 10,
        },
      });
      prod5InactiveId = p5.id;
      createdProductIds.push(p5.id);

      // Prod 6: Soft-Deleted Product
      const p6 = await prisma.product.create({
        data: {
          name: `Deleted Product ${runKey}`,
          price: 150.0,
          image: "/images/p6.png",
          category: "MISMATCHED_DISPLAY_SNAPSHOT_A",
          categoryId: catA.id,
          subcategory: subcatASlug,
          isActive: true,
          deletedAt: new Date(),
          stock: 10,
        },
      });
      prod6DeletedId = p6.id;
      createdProductIds.push(p6.id);

      // Prod 7: Description-only search token target
      const p7 = await prisma.product.create({
        data: {
          name: `Standard Cleanser ${runKey}`,
          description: `This contains ${descOnlyToken} secret text`,
          price: 80.0,
          image: "/images/p7.png",
          category: "MISMATCHED_DISPLAY_SNAPSHOT_A",
          categoryId: catA.id,
          subcategory: subcatASlug,
          isActive: true,
          stock: 15,
        },
      });
      createdProductIds.push(p7.id);

      // Prod 8: Product with no variants
      const p8 = await prisma.product.create({
        data: {
          name: `No Variants Product ${runKey}`,
          price: 70.0,
          image: "/images/p8.png",
          category: "MISMATCHED_DISPLAY_SNAPSHOT_A",
          categoryId: catA.id,
          isActive: true,
          stock: 12,
        },
      });
      prod8NoVariantsId = p8.id;
      createdProductIds.push(p8.id);

      // Prod 9: Product with inactive variants only
      const p9 = await prisma.product.create({
        data: {
          name: `Inactive Variants Product ${runKey}`,
          price: 90.0,
          image: "/images/p9.png",
          category: "MISMATCHED_DISPLAY_SNAPSHOT_A",
          categoryId: catA.id,
          isActive: true,
          stock: 14,
        },
      });
      prod9InactiveVariantsId = p9.id;
      createdProductIds.push(p9.id);

      const vInactive = await prisma.productVariant.create({
        data: {
          productId: p9.id,
          label: "Inactive Size",
          price: 90.0,
          stock: 5,
          isActive: false,
          sortOrder: 1,
        },
      });
      createdVariantIds.push(vInactive.id);

      // Prod 10: Product with active variant
      const p10 = await prisma.product.create({
        data: {
          name: `Active Variants Product ${runKey}`,
          price: 120.0,
          image: "/images/p10.png",
          category: "MISMATCHED_DISPLAY_SNAPSHOT_A",
          categoryId: catA.id,
          isActive: true,
          stock: 25,
        },
      });
      prod10ActiveVariantsId = p10.id;
      createdProductIds.push(p10.id);

      const vActive = await prisma.productVariant.create({
        data: {
          productId: p10.id,
          label: "Active Size 50ml",
          price: 120.0,
          stock: 10,
          isActive: true,
          sortOrder: 1,
        },
      });
      createdVariantIds.push(vActive.id);

      // Prod 11: Product for Detail Testing with Active + Inactive Variants
      const p11 = await prisma.product.create({
        data: {
          name: `Detail Test Product ${runKey}`,
          description: "Full detailed rich product description for tests",
          price: 250.0,
          compareAtPrice: 300.0,
          image: "/images/p11.png",
          category: "MISMATCHED_DISPLAY_SNAPSHOT_A",
          categoryId: catA.id,
          subcategory: subcatASlug,
          isActive: true,
          stock: 30,
          isHotDeal: true,
          isUpcoming: false,
          badgeText: "HOT",
          badgeTone: "sale",
        },
      });
      prod11DetailId = p11.id;
      createdProductIds.push(p11.id);

      const vDetail1 = await prisma.productVariant.create({
        data: {
          productId: p11.id,
          label: "Size 100ml",
          price: 250.0,
          stock: 15,
          isActive: true,
          sortOrder: 2,
        },
      });
      createdVariantIds.push(vDetail1.id);

      const vDetail2 = await prisma.productVariant.create({
        data: {
          productId: p11.id,
          label: "Size 50ml",
          price: 150.0,
          stock: 15,
          isActive: true,
          sortOrder: 1, // should be ordered before vDetail1
        },
      });
      createdVariantIds.push(vDetail2.id);

      const vDetailInactive = await prisma.productVariant.create({
        data: {
          productId: p11.id,
          label: "Size Inactive 200ml",
          price: 450.0,
          stock: 0,
          isActive: false,
          sortOrder: 0,
        },
      });
      createdVariantIds.push(vDetailInactive.id);

      // 6. Create 30 Pagination Test Products under Category A
      for (let i = 1; i <= 30; i++) {
        const p = await prisma.product.create({
          data: {
            name: `Paginated Product ${i} ${runKey}`,
            price: 10 + i,
            image: `/images/pag-${i}.png`,
            category: "MISMATCHED_DISPLAY_SNAPSHOT_A",
            categoryId: catA.id,
            isActive: true,
            stock: i,
          },
        });
        createdProductIds.push(p.id);
      }
    });

    after(async () => {
      if (!prisma) return;

      // Clean up all synthetic records in strict reverse foreign key order
      if (createdVariantIds.length > 0) {
        await prisma.productVariant
          .deleteMany({ where: { id: { in: createdVariantIds } } })
          .catch(() => {});
      }
      if (createdProductIds.length > 0) {
        await prisma.product
          .deleteMany({ where: { id: { in: createdProductIds } } })
          .catch(() => {});
      }
      if (createdSubcategoryIds.length > 0) {
        await prisma.subcategory
          .deleteMany({ where: { id: { in: createdSubcategoryIds } } })
          .catch(() => {});
      }
      if (createdCategoryIds.length > 0) {
        await prisma.category
          .deleteMany({ where: { id: { in: createdCategoryIds } } })
          .catch(() => {});
      }

      await prisma.$disconnect().catch(() => {});
    });

    // -------------------------------------------------------------------------
    // A. invalidFilter Short-Circuit
    // -------------------------------------------------------------------------
    it("returns empty envelope immediately when invalidFilter is true", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: null,
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: true,
      });

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.items, []);
      assert.strictEqual(result.totalItems, 0);
      assert.strictEqual(result.totalPages, 0);
      assert.strictEqual(result.hasMore, false);
      assert.strictEqual(result.nextPage, null);
    });

    // -------------------------------------------------------------------------
    // B. Relational Category Authority
    // -------------------------------------------------------------------------
    it("filters authoritatively by relational categoryId, ignoring Product.category snapshot text", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 48,
        sort: "latest",
        category: catASlug,
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: false,
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.totalItems > 0);

      // All returned items must belong to Category A
      for (const item of result.items) {
        assert.notStrictEqual(item.id, prod4CatBId);
      }
      const itemIds = result.items.map((i) => i.id);
      assert.ok(itemIds.includes(prod1SlugSubId));
      assert.ok(itemIds.includes(prod2NameSubId));
    });

    it("returns empty envelope for nonexistent or inactive category", async () => {
      const unknownResult = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: "nonexistent-category-slug-12345",
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: false,
      });
      assert.strictEqual(unknownResult.totalItems, 0);
      assert.deepStrictEqual(unknownResult.items, []);

      const inactiveResult = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: catCSlug,
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: false,
      });
      assert.strictEqual(inactiveResult.totalItems, 0);
      assert.deepStrictEqual(inactiveResult.items, []);
    });

    // -------------------------------------------------------------------------
    // C. Dual-Format Subcategory Matching
    // -------------------------------------------------------------------------
    it("matches both slug-backed and name-backed subcategory values under the same relational category", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: catASlug,
        subcategory: subcatASlug,
        q: null,
        skip: 0,
        invalidFilter: false,
      });

      const matchedIds = result.items.map((i) => i.id);
      assert.ok(
        matchedIds.includes(prod1SlugSubId),
        "Must include slug-backed subcategory product"
      );
      assert.ok(
        matchedIds.includes(prod2NameSubId),
        "Must include display-name-backed subcategory product"
      );
      assert.ok(
        !matchedIds.includes(prod4CatBId),
        "Must not include Category B product"
      );
    });

    it("returns empty envelope on cross-category subcategory mismatch", async () => {
      // Requesting Category A with Subcategory B's slug
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: catASlug,
        subcategory: subcatBSlug,
        q: null,
        skip: 0,
        invalidFilter: false,
      });

      assert.strictEqual(result.totalItems, 0);
      assert.deepStrictEqual(result.items, []);
    });

    // -------------------------------------------------------------------------
    // D. Pagination
    // -------------------------------------------------------------------------
    it("paginates bounded slices accurately with zero ID overlap between pages", async () => {
      const page1 = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: catASlug,
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: false,
      });

      assert.strictEqual(page1.page, 1);
      assert.strictEqual(page1.pageSize, 24);
      assert.strictEqual(page1.items.length, 24);
      assert.strictEqual(page1.hasMore, true);
      assert.strictEqual(page1.nextPage, 2);

      const page2 = await getPublicCatalogQuery({
        page: 2,
        pageSize: 24,
        sort: "latest",
        category: catASlug,
        subcategory: null,
        q: null,
        skip: 24,
        invalidFilter: false,
      });

      assert.strictEqual(page2.page, 2);
      assert.strictEqual(page2.pageSize, 24);
      assert.ok(page2.items.length > 0);
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

    it("returns empty items array with truthful metadata on out-of-range page", async () => {
      const outOfRange = await getPublicCatalogQuery({
        page: 999,
        pageSize: 24,
        sort: "latest",
        category: catASlug,
        subcategory: null,
        q: null,
        skip: 998 * 24,
        invalidFilter: false,
      });

      assert.strictEqual(outOfRange.page, 999);
      assert.strictEqual(outOfRange.items.length, 0);
      assert.ok(outOfRange.totalItems > 0);
      assert.ok(outOfRange.totalPages > 0);
      assert.strictEqual(outOfRange.hasMore, false);
      assert.strictEqual(outOfRange.nextPage, null);
    });

    // -------------------------------------------------------------------------
    // E. Deterministic Sorting
    // -------------------------------------------------------------------------
    it("sorts by latest (id DESC)", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 10,
        sort: "latest",
        category: catASlug,
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: false,
      });

      for (let i = 0; i < result.items.length - 1; i++) {
        assert.ok(
          result.items[i].id > result.items[i + 1].id,
          `Expected ${result.items[i].id} > ${result.items[i + 1].id}`
        );
      }
    });

    it("sorts by price-asc with id DESC tiebreaker", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 48,
        sort: "price-asc",
        category: catASlug,
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: false,
      });

      for (let i = 0; i < result.items.length - 1; i++) {
        const curr = result.items[i];
        const next = result.items[i + 1];
        if (curr.price === next.price) {
          assert.ok(
            curr.id > next.id,
            `Expected equal price tiebreak: id ${curr.id} > ${next.id}`
          );
        } else {
          assert.ok(
            curr.price < next.price,
            `Expected price ${curr.price} < ${next.price}`
          );
        }
      }
    });

    it("sorts by price-desc with id DESC tiebreaker", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 48,
        sort: "price-desc",
        category: catASlug,
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: false,
      });

      for (let i = 0; i < result.items.length - 1; i++) {
        const curr = result.items[i];
        const next = result.items[i + 1];
        if (curr.price === next.price) {
          assert.ok(
            curr.id > next.id,
            `Expected equal price tiebreak: id ${curr.id} > ${next.id}`
          );
        } else {
          assert.ok(
            curr.price > next.price,
            `Expected price ${curr.price} > ${next.price}`
          );
        }
      }
    });

    // -------------------------------------------------------------------------
    // F. Search Scope & Description Exclusion
    // -------------------------------------------------------------------------
    it("searches Product.name", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: null,
        subcategory: null,
        q: prodNameSearchToken,
        skip: 0,
        invalidFilter: false,
      });

      const matchedIds = result.items.map((i) => i.id);
      assert.ok(
        matchedIds.includes(prod1SlugSubId),
        "Must match product whose name contains search token"
      );
      assert.ok(
        !matchedIds.includes(prod2NameSubId),
        "Must not match product whose name does not contain search token"
      );
    });

    it("searches relational Category.name", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 48,
        sort: "latest",
        category: null,
        subcategory: null,
        q: catSearchToken,
        skip: 0,
        invalidFilter: false,
      });

      const matchedIds = result.items.map((i) => i.id);
      assert.ok(
        matchedIds.includes(prod1SlugSubId),
        "Must match Category A product via relational category name"
      );
      assert.ok(
        matchedIds.includes(prod2NameSubId),
        "Must match Category A product via relational category name"
      );
      assert.ok(
        !matchedIds.includes(prod4CatBId),
        "Must not match Category B product"
      );
    });

    it("searches Product.subcategory", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: null,
        subcategory: null,
        q: subcatSearchToken,
        skip: 0,
        invalidFilter: false,
      });

      const matchedIds = result.items.map((i) => i.id);
      assert.ok(
        matchedIds.includes(prod2NameSubId),
        "Must match product whose subcategory contains search token"
      );
      assert.ok(
        !matchedIds.includes(prod4CatBId),
        "Must not match Category B product"
      );
    });

    it("strictly excludes Product.description from public search matching", async () => {
      const descSearchResult = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: null,
        subcategory: null,
        q: descOnlyToken,
        skip: 0,
        invalidFilter: false,
      });

      assert.strictEqual(descSearchResult.totalItems, 0);
      assert.deepStrictEqual(descSearchResult.items, []);
    });

    // -------------------------------------------------------------------------
    // G. Lifecycle Exclusion (Inactive & Soft-Deleted)
    // -------------------------------------------------------------------------
    it("excludes inactive and soft-deleted products from public queries", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 48,
        sort: "latest",
        category: catASlug,
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: false,
      });

      const ids = new Set(result.items.map((i) => i.id));
      assert.ok(!ids.has(prod5InactiveId), "Must exclude inactive product");
      assert.ok(!ids.has(prod6DeletedId), "Must exclude soft-deleted product");
    });

    // -------------------------------------------------------------------------
    // H. PublicProductCardDTO Projection & hasVariants
    // -------------------------------------------------------------------------
    it("projects exact PublicProductCardDTO fields and excludes forbidden fields", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 5,
        sort: "latest",
        category: catASlug,
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: false,
      });

      assert.ok(result.items.length > 0);
      const card = result.items[0] as Record<string, unknown>;

      // Expected card fields
      assert.ok(typeof card.id === "number");
      assert.ok(typeof card.name === "string");
      assert.ok(typeof card.price === "number");
      assert.ok("compareAtPrice" in card);
      assert.ok(typeof card.image === "string");
      assert.ok(typeof card.category === "string");
      assert.ok(typeof card.stock === "number");
      assert.ok(typeof card.isHotDeal === "boolean");
      assert.ok(typeof card.isUpcoming === "boolean");
      assert.ok("badgeText" in card);
      assert.ok(typeof card.badgeTone === "string");
      assert.ok(typeof card.hasVariants === "boolean");

      // Forbidden fields on card
      assert.strictEqual(card.description, undefined);
      assert.strictEqual(card.variants, undefined);
      assert.strictEqual(card.createdAt, undefined);
      assert.strictEqual(card.updatedAt, undefined);
      assert.strictEqual(card.deletedAt, undefined);
      assert.strictEqual(card.isActive, undefined);
    });

    it("evaluates hasVariants based strictly on ACTIVE variants", async () => {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 48,
        sort: "latest",
        category: catASlug,
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: false,
      });

      const p8 = result.items.find((i) => i.id === prod8NoVariantsId);
      const p9 = result.items.find((i) => i.id === prod9InactiveVariantsId);
      const p10 = result.items.find((i) => i.id === prod10ActiveVariantsId);

      assert.ok(p8, "Product 8 must exist in results");
      assert.strictEqual(p8.hasVariants, false, "No variants -> hasVariants = false");

      assert.ok(p9, "Product 9 must exist in results");
      assert.strictEqual(
        p9.hasVariants,
        false,
        "Inactive variant only -> hasVariants = false"
      );

      assert.ok(p10, "Product 10 must exist in results");
      assert.strictEqual(
        p10.hasVariants,
        true,
        "Active variant exists -> hasVariants = true"
      );
    });

    // -------------------------------------------------------------------------
    // I. Public Product Detail Query
    // -------------------------------------------------------------------------
    it("returns PublicProductDetailDTO with active variants only ordered by sortOrder ASC, id ASC", async () => {
      const detail = await getPublicProductDetailQuery(prod11DetailId);
      assert.ok(detail, "Detail must be found");

      assert.strictEqual(detail.id, prod11DetailId);
      assert.strictEqual(detail.name, `Detail Test Product ${runKey}`);
      assert.strictEqual(detail.price, 250.0);
      assert.strictEqual(detail.compareAtPrice, 300.0);
      assert.strictEqual(
        detail.description,
        "Full detailed rich product description for tests"
      );
      assert.strictEqual(detail.hasVariants, true);
      assert.strictEqual(detail.categoryId, catAId);
      assert.strictEqual(detail.subcategory, subcatASlug);

      // Must only contain the 2 active variants (excluding the 1 inactive variant)
      assert.strictEqual(detail.variants.length, 2);

      // Ordering check: sortOrder ASC, id ASC
      assert.strictEqual(detail.variants[0].label, "Size 50ml"); // sortOrder 1
      assert.strictEqual(detail.variants[0].price, 150.0);
      assert.strictEqual(detail.variants[1].label, "Size 100ml"); // sortOrder 2
      assert.strictEqual(detail.variants[1].price, 250.0);

      // Admin fields must not exist
      const rawDetail = detail as Record<string, unknown>;
      assert.strictEqual(rawDetail.deletedAt, undefined);
      assert.strictEqual(rawDetail.isActive, undefined);
      assert.strictEqual(rawDetail.createdAt, undefined);
      assert.strictEqual(rawDetail.updatedAt, undefined);
    });

    it("returns null for inactive, soft-deleted, or nonexistent product details", async () => {
      const inactiveDetail = await getPublicProductDetailQuery(prod5InactiveId);
      assert.strictEqual(inactiveDetail, null);

      const deletedDetail = await getPublicProductDetailQuery(prod6DeletedId);
      assert.strictEqual(deletedDetail, null);

      const nonExistentDetail = await getPublicProductDetailQuery(99999999);
      assert.strictEqual(nonExistentDetail, null);
    });
  }
);
