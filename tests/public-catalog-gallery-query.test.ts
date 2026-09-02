import dotenv from "dotenv";
dotenv.config();

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import pg from "pg";
import type { PrismaClient } from "../generated/prisma/client";
import type {
  getPublicCatalogQuery as GetPublicCatalogQueryType,
  getPublicProductDetailQuery as GetPublicProductDetailQueryType,
} from "../lib/catalog/publicCatalogQuery";
import type { resolveSubcategoryBatch as ResolveSubcategoryBatchType } from "../lib/catalog/subcategoryResolution";

const { Client } = pg;

const testBaseUrl = process.env.DATABASE_URL_TEST;
if (!testBaseUrl) {
  throw new Error("DATABASE_URL_TEST is required to run public-catalog-gallery-query integration tests.");
}

const parsedBase = new URL(testBaseUrl);
if (parsedBase.hostname.includes("neon.tech")) {
  throw new Error("Safety violation: DATABASE_URL_TEST points to Neon cloud.");
}
if (!["localhost", "127.0.0.1"].includes(parsedBase.hostname)) {
  throw new Error("Safety violation: DATABASE_URL_TEST must target local PostgreSQL test environment.");
}

const dbName = `pure_haven_storefront_publicread_${Date.now()}`;
if (!/^pure_haven_storefront_publicread_[0-9]+$/.test(dbName)) {
  throw new Error(`Safety violation: Invalid disposable database name ${dbName}`);
}

const disposableUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);

// Validate derived disposable target
const parsedDisposable = new URL(disposableUrl);
if (
  parsedDisposable.hostname !== parsedBase.hostname ||
  parsedDisposable.port !== parsedBase.port ||
  parsedDisposable.protocol !== parsedBase.protocol ||
  parsedDisposable.pathname !== `/${dbName}`
) {
  throw new Error("Target validation failed: disposable URL does not match base configuration.");
}

const prevDbUrl = process.env.DATABASE_URL;
const prevTestUrl = process.env.DATABASE_URL_TEST;

describe("Task 4 — Public Catalog Presentation + Batched Media", () => {
  let prisma: PrismaClient;
  let getPublicCatalogQuery: typeof GetPublicCatalogQueryType;
  let getPublicProductDetailQuery: typeof GetPublicProductDetailQueryType;
  let resolveSubcategoryBatch: typeof ResolveSubcategoryBatchType;
  let rawClient: pg.Client;

  let catAId: number;
  let prod1Id: number; // 5 images (tests cap 4, sortOrder, slug subcategory)

  before(async () => {
    // 1. Create disposable database
    const adminUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
    const adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}";`);
    await adminClient.end();

    // 2. Deploy untouched current migrations
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    execSync(`${npxCmd} prisma migrate deploy --schema .\\prisma\\schema.prisma`, {
      env: { ...process.env, DATABASE_URL: disposableUrl, DATABASE_URL_TEST: disposableUrl },
      stdio: "pipe",
    });

    // 3. Set DATABASE_URL and dynamically import
    process.env.DATABASE_URL = disposableUrl;
    process.env.DATABASE_URL_TEST = disposableUrl;

    const prismaModule = await import("../lib/prisma.js");
    prisma = prismaModule.prisma;

    const queryModule = await import("../lib/catalog/publicCatalogQuery.js");
    getPublicCatalogQuery = queryModule.getPublicCatalogQuery;
    getPublicProductDetailQuery = queryModule.getPublicProductDetailQuery;

    const subModule = await import("../lib/catalog/subcategoryResolution.js");
    resolveSubcategoryBatch = subModule.resolveSubcategoryBatch;

    rawClient = new Client({ connectionString: disposableUrl });
    await rawClient.connect();

    // 4. Verify read-only SELECT current_database()
    const dbCheck = await rawClient.query("SELECT current_database()");
    assert.strictEqual(
      dbCheck.rows[0].current_database,
      dbName,
      "Connected database must match generated disposable dbName"
    );

    // 5. Seed fixtures
    const catA = await prisma.category.create({
      data: {
        name: "Skincare Relational",
        slug: `skincare-rel-${Date.now()}`,
        isActive: true,
        sortOrder: 1,
      },
    });
    catAId = catA.id;

    // Active Subcategory A
    await prisma.subcategory.create({
      data: {
        categoryId: catA.id,
        name: "Face Serums",
        slug: "face-serum",
        isActive: true,
        sortOrder: 1,
      },
    });

    // Inactive Subcategory B
    await prisma.subcategory.create({
      data: {
        categoryId: catA.id,
        name: "Sun Protection",
        slug: "sun-care",
        isActive: false,
        sortOrder: 2,
      },
    });

    // PRODUCT 1 — Relational gallery with 5 images inserted intentionally out of display order
    const p1 = await prisma.product.create({
      data: {
        name: "Product 1 Multi Image",
        price: 350,
        compareAtPrice: 400,
        image: "/uploads/products/p1-primary.jpg",
        category: "Legacy Snapshot Category",
        categoryId: catA.id,
        subcategory: "face-serum", // matches slug
        description: "Public detail description for Product 1",
        stock: 25,
        isActive: true,
      },
    });
    prod1Id = p1.id;

    // 5 ProductImage rows (3 first, then 5, 1, 4, 2)
    const p1Images = [
      { sortOrder: 3, url: "/uploads/products/p1-img3.jpg" },
      { sortOrder: 5, url: "/uploads/products/p1-img5.jpg" }, // Should be omitted by max-4 cap
      { sortOrder: 1, url: "/uploads/products/p1-primary.jpg" },
      { sortOrder: 4, url: "/uploads/products/p1-img4.jpg" },
      { sortOrder: 2, url: "/uploads/products/p1-img2.jpg" },
    ];
    for (const item of p1Images) {
      await prisma.productImage.create({
        data: {
          productId: p1.id,
          url: item.url,
          sortOrder: item.sortOrder,
        },
      });
    }

    // Active variant on Product 1
    await prisma.productVariant.create({
      data: {
        productId: p1.id,
        label: "50ml",
        price: 350,
        stock: 15,
        isActive: true,
        sortOrder: 1,
      },
    });
    // Inactive variant on Product 1 (must be excluded from public detail)
    await prisma.productVariant.create({
      data: {
        productId: p1.id,
        label: "100ml Inactive",
        price: 600,
        stock: 10,
        isActive: false,
        sortOrder: 2,
      },
    });

    // PRODUCT 2 — Fallback gallery (0 images) + subcategory name match with different case
    await prisma.product.create({
      data: {
        name: "Product 2 Fallback",
        price: 150,
        image: "/images/p2-fallback.jpg",
        category: "Legacy Snapshot Category",
        categoryId: catA.id,
        subcategory: "FACE SERUMS", // matches Subcategory.name case-insensitively
        description: "Public detail description for Product 2",
        stock: 10,
        isActive: true,
      },
    });

    // PRODUCT 3 — Unmatched subcategory token
    await prisma.product.create({
      data: {
        name: "Product 3 Unmatched Sub",
        price: 200,
        image: "/images/p3.jpg",
        category: "Legacy Snapshot Category",
        categoryId: catA.id,
        subcategory: "unmatched-sub-token-xyz",
        stock: 10,
        isActive: true,
      },
    });

    // PRODUCT 4 — Inactive subcategory token
    await prisma.product.create({
      data: {
        name: "Product 4 Inactive Sub",
        price: 220,
        image: "/images/p4.jpg",
        category: "Legacy Snapshot Category",
        categoryId: catA.id,
        subcategory: "sun-care", // matches inactive subcategory slug
        stock: 8,
        isActive: true,
      },
    });

    // PRODUCT 5 — Category snapshot fallback (categoryId: null)
    await prisma.product.create({
      data: {
        name: "Product 5 Category Snapshot Fallback",
        price: 180,
        image: "/images/p5.jpg",
        category: "Orphan Category Snapshot",
        categoryId: null,
        subcategory: null,
        stock: 12,
        isActive: true,
      },
    });
  });

  after(async () => {
    try {
      if (rawClient) {
        await rawClient.end();
      }
    } catch {}

    try {
      if (prisma) {
        await prisma.$disconnect();
      }
    } catch {}

    try {
      const adminUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
      const adminClient = new Client({ connectionString: adminUrl });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE "${dbName}" WITH (FORCE);`);
      await adminClient.end();
    } catch (err) {
      console.error("Cleanup error dropping disposable DB:", err);
    } finally {
      if (prevDbUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = prevDbUrl;
      }
      if (prevTestUrl === undefined) {
        delete process.env.DATABASE_URL_TEST;
      } else {
        process.env.DATABASE_URL_TEST = prevTestUrl;
      }
    }
  });

  // -------------------------------------------------------------------------
  // A, B, C, D, E: Public Card Gallery Presentation
  // -------------------------------------------------------------------------
  it("A. Public Card DTO exposes images[] with relational authority", async () => {
    const result = await getPublicCatalogQuery({
      page: 1,
      pageSize: 24,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Product 1 Multi Image",
      skip: 0,
      invalidFilter: false,
    });

    assert.ok(result.items.length > 0);
    const item = result.items[0];
    assert.ok(
      Array.isArray((item as unknown as { images?: unknown }).images),
      "Public catalog item must expose images[]"
    );
  });

  it("B. Gallery Order: Relational rows returned in sortOrder ASC, id ASC", async () => {
    const result = await getPublicCatalogQuery({
      page: 1,
      pageSize: 24,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Product 1 Multi Image",
      skip: 0,
      invalidFilter: false,
    });

    const item = result.items[0] as unknown as { images: string[] };
    assert.ok(item.images);
    assert.strictEqual(item.images[0], "/uploads/products/p1-primary.jpg");
    assert.strictEqual(item.images[1], "/uploads/products/p1-img2.jpg");
    assert.strictEqual(item.images[2], "/uploads/products/p1-img3.jpg");
    assert.strictEqual(item.images[3], "/uploads/products/p1-img4.jpg");
  });

  it("C. Public Card Gallery Cap: Even with 5 rows in DB, card returns at most first 4 ordered URLs", async () => {
    const result = await getPublicCatalogQuery({
      page: 1,
      pageSize: 24,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Product 1 Multi Image",
      skip: 0,
      invalidFilter: false,
    });

    const item = result.items[0] as unknown as { images: string[] };
    assert.strictEqual(item.images.length, 4, "Public card gallery must be capped at 4");
    assert.ok(!item.images.includes("/uploads/products/p1-img5.jpg"), "5th image must be excluded");
  });

  it("D. Gallery Fallback: 0 ProductImage rows returns [product.image]", async () => {
    const result = await getPublicCatalogQuery({
      page: 1,
      pageSize: 24,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Product 2 Fallback",
      skip: 0,
      invalidFilter: false,
    });

    const item = result.items[0] as unknown as { images: string[]; image: string };
    assert.deepStrictEqual(item.images, ["/images/p2-fallback.jpg"]);
    assert.strictEqual(item.image, "/images/p2-fallback.jpg");
  });

  it("E. No Mirror Duplication: relational gallery does not append or prepend product.image", async () => {
    const result = await getPublicCatalogQuery({
      page: 1,
      pageSize: 24,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Product 1 Multi Image",
      skip: 0,
      invalidFilter: false,
    });

    const item = result.items[0] as unknown as { images: string[] };
    const count = item.images.filter((u) => u === "/uploads/products/p1-primary.jpg").length;
    assert.strictEqual(count, 1, "Primary image must appear exactly once at its sortOrder position");
  });

  // -------------------------------------------------------------------------
  // F, G: Category Relational Authority & Snapshot Fallback
  // -------------------------------------------------------------------------
  it("F. Category Relational Authority: categoryName === categoryRel.name when relation exists", async () => {
    const result = await getPublicCatalogQuery({
      page: 1,
      pageSize: 24,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Product 1 Multi Image",
      skip: 0,
      invalidFilter: false,
    });

    const item = result.items[0] as unknown as { categoryName?: string | null; category: string };
    assert.strictEqual(item.categoryName, "Skincare Relational");
    assert.strictEqual(item.category, "Legacy Snapshot Category");
  });

  it("G. Category Snapshot Fallback: categoryName falls back to Product.category when categoryRel is null", async () => {
    const result = await getPublicCatalogQuery({
      page: 1,
      pageSize: 24,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Product 5 Category Snapshot Fallback",
      skip: 0,
      invalidFilter: false,
    });

    const item = result.items[0] as unknown as { categoryName?: string | null; category: string };
    assert.strictEqual(item.categoryName, "Orphan Category Snapshot");
  });

  // -------------------------------------------------------------------------
  // H, I, J, K: Subcategory Token Resolution
  // -------------------------------------------------------------------------
  it("H. Subcategory Slug Resolution: Product.subcategory matching Subcategory.slug returns Subcategory.name", async () => {
    const result = await getPublicCatalogQuery({
      page: 1,
      pageSize: 24,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Product 1 Multi Image",
      skip: 0,
      invalidFilter: false,
    });

    const item = result.items[0] as unknown as { subcategoryName?: string | null };
    assert.strictEqual(item.subcategoryName, "Face Serums");
  });

  it("I. Subcategory Name Resolution: Product.subcategory matching Subcategory.name case-insensitively returns Subcategory.name", async () => {
    const result = await getPublicCatalogQuery({
      page: 1,
      pageSize: 24,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Product 2 Fallback",
      skip: 0,
      invalidFilter: false,
    });

    const item = result.items[0] as unknown as { subcategoryName?: string | null };
    assert.strictEqual(item.subcategoryName, "Face Serums");
  });

  it("J. Unmatched Subcategory: returns null", async () => {
    const result = await getPublicCatalogQuery({
      page: 1,
      pageSize: 24,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Product 3 Unmatched Sub",
      skip: 0,
      invalidFilter: false,
    });

    const item = result.items[0] as unknown as { subcategoryName?: string | null };
    assert.strictEqual(item.subcategoryName, null);
  });

  it("K. Inactive Subcategory: must NOT resolve (returns null)", async () => {
    const result = await getPublicCatalogQuery({
      page: 1,
      pageSize: 24,
      sort: "latest",
      category: null,
      subcategory: null,
      q: "Product 4 Inactive Sub",
      skip: 0,
      invalidFilter: false,
    });

    const item = result.items[0] as unknown as { subcategoryName?: string | null };
    assert.strictEqual(item.subcategoryName, null);
  });

  it("L. Token Scoping & Deduplication: candidate pairs are deduplicated and bounded", async () => {
    let capturedArgs: unknown = null;
    const subRecord = prisma.subcategory as unknown as Record<string, unknown>;
    const origSubFindMany = subRecord.findMany as (...args: unknown[]) => unknown;

    subRecord.findMany = async (...args: unknown[]) => {
      capturedArgs = args[0];
      return origSubFindMany.apply(prisma.subcategory, args);
    };

    try {
      // Pass 10 duplicate items with same categoryId and case-insensitive token
      const items = Array.from({ length: 10 }, () => ({
        categoryId: catAId,
        subcategory: "  Face-Serum  ",
      }));
      const resMap = await resolveSubcategoryBatch(items);
      assert.ok(resMap.has(catAId));
      assert.strictEqual(resMap.get(catAId)?.get("face-serum"), "Face Serums");

      // Verify captured query has where.OR.length === 1
      const whereOr = (capturedArgs as { where?: { OR?: unknown[] } })?.where?.OR;
      assert.ok(Array.isArray(whereOr), "Query must construct an OR array");
      assert.strictEqual(whereOr.length, 1, "Duplicate inputs must produce exactly 1 OR condition");

      // Now verify 48 unique candidates produces at most 48 OR conditions
      const fortyEightUnique = Array.from({ length: 48 }, (_, i) => ({
        categoryId: 2000 + i,
        subcategory: `sub-${i}`,
      }));
      await resolveSubcategoryBatch(fortyEightUnique);
      const fortyEightOr = (capturedArgs as { where?: { OR?: unknown[] } })?.where?.OR;
      assert.ok(Array.isArray(fortyEightOr));
      assert.strictEqual(fortyEightOr.length, 48, "48 unique candidates must produce exactly 48 OR conditions");
    } finally {
      subRecord.findMany = origSubFindMany;
    }
  });

  // -------------------------------------------------------------------------
  // M, N, O: Query Shape, Batching & No N+1
  // -------------------------------------------------------------------------
  it("M. Empty Product Result: No ProductImage or Subcategory query is executed", async () => {
    let piQueryCount = 0;
    let subQueryCount = 0;

    const piRecord = prisma.productImage as unknown as Record<string, unknown>;
    const subRecord = prisma.subcategory as unknown as Record<string, unknown>;

    const origPiFindMany = piRecord.findMany as (...args: unknown[]) => unknown;
    const origSubFindMany = subRecord.findMany as (...args: unknown[]) => unknown;

    piRecord.findMany = async (...args: unknown[]) => {
      piQueryCount++;
      return origPiFindMany.apply(prisma.productImage, args);
    };
    subRecord.findMany = async (...args: unknown[]) => {
      subQueryCount++;
      return origSubFindMany.apply(prisma.subcategory, args);
    };

    try {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: null,
        subcategory: null,
        q: "nonexistent_zero_result_query_xyz123",
        skip: 0,
        invalidFilter: false,
      });

      assert.strictEqual(result.items.length, 0);
      assert.strictEqual(piQueryCount, 0, "Empty page must execute 0 ProductImage queries");
      assert.strictEqual(subQueryCount, 0, "Empty page must execute 0 Subcategory queries");
    } finally {
      piRecord.findMany = origPiFindMany;
      subRecord.findMany = origSubFindMany;
    }
  });

  it("N. Empty Subcategory Candidates: Returns empty Map without querying Prisma", async () => {
    let subQueryCount = 0;
    const subRecord = prisma.subcategory as unknown as Record<string, unknown>;
    const origSubFindMany = subRecord.findMany as (...args: unknown[]) => unknown;
    subRecord.findMany = async (...args: unknown[]) => {
      subQueryCount++;
      return origSubFindMany.apply(prisma.subcategory, args);
    };

    try {
      const res = await resolveSubcategoryBatch([
        { categoryId: null, subcategory: "ignored" },
        { categoryId: catAId, subcategory: null },
        { categoryId: catAId, subcategory: "   " },
      ]);
      assert.strictEqual(res.size, 0);
      assert.strictEqual(subQueryCount, 0, "Must not execute any DB queries for empty candidates");
    } finally {
      subRecord.findMany = origSubFindMany;
    }
  });

  it("O. Batched Media & Subcategory: At most 1 ProductImage and 1 Subcategory query per non-empty page", async () => {
    let piQueryCount = 0;
    let subQueryCount = 0;

    const piRecord = prisma.productImage as unknown as Record<string, unknown>;
    const subRecord = prisma.subcategory as unknown as Record<string, unknown>;

    const origPiFindMany = piRecord.findMany as (...args: unknown[]) => unknown;
    const origSubFindMany = subRecord.findMany as (...args: unknown[]) => unknown;

    piRecord.findMany = async (...args: unknown[]) => {
      piQueryCount++;
      return origPiFindMany.apply(prisma.productImage, args);
    };
    subRecord.findMany = async (...args: unknown[]) => {
      subQueryCount++;
      return origSubFindMany.apply(prisma.subcategory, args);
    };

    try {
      const result = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: null,
        subcategory: null,
        q: null,
        skip: 0,
        invalidFilter: false,
      });

      assert.ok(result.items.length >= 4, "Should return multiple seeded products");
      assert.strictEqual(piQueryCount, 1, "Must execute exactly 1 batched ProductImage query");
      assert.strictEqual(subQueryCount, 1, "Must execute exactly 1 batched Subcategory query");
    } finally {
      piRecord.findMany = origPiFindMany;
      subRecord.findMany = origSubFindMany;
    }
  });

  // -------------------------------------------------------------------------
  // P: Public Detail Contract
  // -------------------------------------------------------------------------
  it("P. Public Detail returns images[], categoryName, subcategoryName and preserves active variants only", async () => {
    const detail = await getPublicProductDetailQuery(prod1Id);
    assert.ok(detail, "Detail must be found");

    // New presentation fields
    assert.ok(Array.isArray(detail.images), "detail.images must be array");
    assert.strictEqual(detail.images.length, 4, "detail.images capped at 4");
    assert.strictEqual(detail.images[0], "/uploads/products/p1-primary.jpg");
    assert.strictEqual(detail.categoryName, "Skincare Relational");
    assert.strictEqual(detail.subcategoryName, "Face Serums");

    // Preserved detail fields
    assert.strictEqual(detail.description, "Public detail description for Product 1");
    assert.strictEqual(detail.categoryId, catAId);
    assert.strictEqual(detail.subcategory, "face-serum");
    assert.strictEqual(detail.hasVariants, true);
    assert.strictEqual(detail.variants.length, 1, "Must include ACTIVE variants only");
    assert.strictEqual(detail.variants[0].label, "50ml");
  });

  // -------------------------------------------------------------------------
  // Q, R: Audit Corrections (Slug Precedence & Hard <= 48 Bound)
  // -------------------------------------------------------------------------
  it("Q. Slug-first precedence: slug match wins over name match collision", async () => {
    const subRecord = prisma.subcategory as unknown as Record<string, unknown>;
    const origSubFindMany = subRecord.findMany as (...args: unknown[]) => unknown;

    // For categoryId 123 and candidate token "serum", return in this exact order:
    // 1. slug: "serum", name: "Facial Serum"
    // 2. slug: "premium", name: "serum"
    subRecord.findMany = async () => {
      return [
        {
          categoryId: 123,
          slug: "serum",
          name: "Facial Serum",
        },
        {
          categoryId: 123,
          slug: "premium",
          name: "serum",
        },
      ];
    };

    try {
      const result = await resolveSubcategoryBatch([
        { categoryId: 123, subcategory: "serum" },
      ]);
      const resolved = result.get(123)?.get("serum");
      assert.strictEqual(
        resolved,
        "Facial Serum",
        "Slug match ('serum' -> 'Facial Serum') must take precedence over name match ('premium' -> 'serum')"
      );
    } finally {
      subRecord.findMany = origSubFindMany;
    }
  });

  it("R. Hard bound: >48 unique candidate pairs rejects before DB query with 0 findMany calls", async () => {
    let subQueryCount = 0;
    const subRecord = prisma.subcategory as unknown as Record<string, unknown>;
    const origSubFindMany = subRecord.findMany as (...args: unknown[]) => unknown;

    subRecord.findMany = async (...args: unknown[]) => {
      subQueryCount++;
      return origSubFindMany.apply(prisma.subcategory, args);
    };

    try {
      // 49 unique candidate pairs
      const items = Array.from({ length: 49 }, (_, i) => ({
        categoryId: 1000 + i,
        subcategory: `unique-sub-${i}`,
      }));

      await assert.rejects(
        async () => {
          await resolveSubcategoryBatch(items);
        },
        (err: Error) => {
          assert.ok(
            err.message.includes("48"),
            "Error message must mention the public catalog maximum of 48 candidates"
          );
          return true;
        }
      );

      assert.strictEqual(subQueryCount, 0, "No DB query may occur when >48 candidate limit is exceeded");
    } finally {
      subRecord.findMany = origSubFindMany;
    }
  });
});
