import dotenv from "dotenv";
dotenv.config();

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import pg from "pg";
import type { PrismaClient } from "../generated/prisma/client";
import type {
  getAdminCatalogQuery as GetAdminCatalogQueryType,
  getAdminProductDetailQuery as GetAdminProductDetailQueryType,
} from "../lib/catalog/adminCatalogQuery";

const { Client } = pg;

const testBaseUrl = process.env.DATABASE_URL_TEST;
if (!testBaseUrl) {
  throw new Error("DATABASE_URL_TEST is required to run admin-product-gallery-read integration tests.");
}

const parsedBase = new URL(testBaseUrl);
if (parsedBase.hostname.includes("neon.tech")) {
  throw new Error("Safety violation: DATABASE_URL_TEST points to Neon cloud.");
}
if (!["localhost", "127.0.0.1"].includes(parsedBase.hostname)) {
  throw new Error("Safety violation: DATABASE_URL_TEST must target local PostgreSQL test environment.");
}

const dbName = `pure_haven_storefront_adminread_${Date.now()}`;
if (!/^pure_haven_storefront_adminread_[0-9]+$/.test(dbName)) {
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

describe("Task 3 — Admin Product Read Contract for Gallery", () => {
  let prisma: PrismaClient;
  let getAdminProductDetailQuery: typeof GetAdminProductDetailQueryType;
  let getAdminCatalogQuery: typeof GetAdminCatalogQueryType;
  let rawClient: pg.Client;

  let productAId: number; // Relational gallery
  let productBId: number; // Fallback
  let productCId: number; // For list query verification

  before(async () => {
    // 1. Create disposable database
    const adminUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
    const adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}";`);
    await adminClient.end();

    // 2. Deploy migrations
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

    const queryModule = await import("../lib/catalog/adminCatalogQuery.js");
    getAdminProductDetailQuery = queryModule.getAdminProductDetailQuery;
    getAdminCatalogQuery = queryModule.getAdminCatalogQuery;

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
    const category = await prisma.category.create({
      data: {
        name: "Admin Read Category",
        slug: `admin-read-${Date.now()}`,
        isActive: true,
      },
    });

    // PRODUCT A — Relational gallery
    const prodA = await prisma.product.create({
      data: {
        name: "Product A Relational Gallery",
        price: 250,
        compareAtPrice: 300,
        image: "/uploads/products/admin-primary.jpg",
        category: category.name,
        categoryId: category.id,
        description: "Full description for product A",
        stock: 20,
        isActive: true,
      },
    });
    productAId = prodA.id;

    // Create 3 ProductImage rows intentionally in non-display insertion order:
    // Insert sortOrder: 3 first, then 1, then 2
    await prisma.productImage.create({
      data: {
        productId: prodA.id,
        url: "/uploads/products/admin-third.jpg",
        sortOrder: 3,
      },
    });
    await prisma.productImage.create({
      data: {
        productId: prodA.id,
        url: "/uploads/products/admin-primary.jpg",
        sortOrder: 1,
      },
    });
    await prisma.productImage.create({
      data: {
        productId: prodA.id,
        url: "/uploads/products/admin-second.jpg",
        sortOrder: 2,
      },
    });

    // Add variants to Product A
    await prisma.productVariant.create({
      data: {
        productId: prodA.id,
        label: "Var 1",
        price: 250,
        stock: 10,
        isActive: true,
        sortOrder: 1,
      },
    });

    // PRODUCT B — Compatibility fallback (0 ProductImage rows)
    const prodB = await prisma.product.create({
      data: {
        name: "Product B Fallback Gallery",
        price: 150,
        image: "/images/admin-fallback.jpg",
        category: category.name,
        categoryId: category.id,
        description: "Description for product B",
        stock: 15,
        isActive: true,
      },
    });
    productBId = prodB.id;

    // PRODUCT C — List fixture
    const prodC = await prisma.product.create({
      data: {
        name: "Product C List Fixture",
        price: 90,
        image: "/uploads/products/admin-c.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
        isActive: true,
      },
    });
    productCId = prodC.id;
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
      delete process.env.DATABASE_URL_TEST;
    }
  });

  it("A. Admin Detail — Relational Authority: Product with 3 ProductImage rows returns exactly 3 URLs", async () => {
    const detail = await getAdminProductDetailQuery(productAId);
    assert.ok(detail, "Detail must be found");
    assert.strictEqual(
      Array.isArray((detail as unknown as { images?: unknown }).images),
      true,
      "detail.images must be an array"
    );
    const detailWithImages = detail as unknown as { images: string[] };
    assert.strictEqual(detailWithImages.images.length, 3);
  });

  it("B. Deterministic Ordering: Detail orders by sortOrder ASC, id ASC", async () => {
    const detail = await getAdminProductDetailQuery(productAId);
    assert.ok(detail);
    const detailWithImages = detail as unknown as { images: string[] };
    assert.deepStrictEqual(detailWithImages.images, [
      "/uploads/products/admin-primary.jpg",
      "/uploads/products/admin-second.jpg",
      "/uploads/products/admin-third.jpg",
    ]);
  });

  it("C. Fallback: Product with 0 ProductImage rows returns [product.image]", async () => {
    const detail = await getAdminProductDetailQuery(productBId);
    assert.ok(detail);
    const detailWithImages = detail as unknown as { images: string[] };
    assert.deepStrictEqual(detailWithImages.images, [
      "/images/admin-fallback.jpg",
    ]);
  });

  it("D. No Mirror Duplication: when relational rows exist, product.image is not duplicated or appended", async () => {
    const detail = await getAdminProductDetailQuery(productAId);
    assert.ok(detail);
    const detailWithImages = detail as unknown as { images: string[] };
    const occurrences = detailWithImages.images.filter(
      (url) => url === "/uploads/products/admin-primary.jpg"
    ).length;
    assert.strictEqual(occurrences, 1, "Primary image must not be duplicated");
    assert.strictEqual(detail.image, "/uploads/products/admin-primary.jpg");
  });

  it("E. Admin List DTO remains lightweight: items do not have images property", async () => {
    const listResult = await getAdminCatalogQuery({
      page: 1,
      pageSize: 20,
      filter: "all",
      q: "Product C List Fixture",
      skip: 0,
    });
    assert.ok(listResult.items.length > 0);
    const item = listResult.items.find((i) => i.id === productCId) || listResult.items[0];
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(item, "images"),
      false,
      "AdminProductListDTO must not contain images property"
    );
  });

  it("F. Existing detail fields preserved: description, variants, price as number, audit fields", async () => {
    const detail = await getAdminProductDetailQuery(productAId);
    assert.ok(detail);
    assert.strictEqual(detail.name, "Product A Relational Gallery");
    assert.strictEqual(detail.price, 250);
    assert.strictEqual(detail.compareAtPrice, 300);
    assert.strictEqual(detail.description, "Full description for product A");
    assert.strictEqual(detail.stock, 20);
    assert.strictEqual(detail.variants.length, 1);
    assert.strictEqual(detail.variants[0].label, "Var 1");
    assert.strictEqual(typeof detail.createdAt, "string");
    assert.strictEqual(typeof detail.updatedAt, "string");
  });

  it("G. Bridge compatibility: ProductImage rows with null sourceKind read cleanly", async () => {
    const bridgeProduct = await prisma.product.create({
      data: {
        name: "Bridge Null SourceKind Product",
        price: 199,
        image: "/uploads/products/bridge-null.jpg",
        category: "Skincare",
        images: {
          create: [
            { url: "/uploads/products/bridge-null.jpg", sortOrder: 1, sourceKind: null },
            { url: "/images/secondary-bridge.jpg", sortOrder: 2, sourceKind: null },
          ],
        },
      },
    });

    const detail = await getAdminProductDetailQuery(bridgeProduct.id);
    assert.ok(detail);
    assert.deepStrictEqual(detail.images, [
      "/uploads/products/bridge-null.jpg",
      "/images/secondary-bridge.jpg",
    ]);
  });
});