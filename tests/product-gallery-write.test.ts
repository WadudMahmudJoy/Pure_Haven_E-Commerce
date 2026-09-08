import dotenv from "dotenv";
dotenv.config();

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import pg from "pg";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "../lib/adminSession.js";

const { Client } = pg;

const testBaseUrl = process.env.DATABASE_URL_TEST;
if (!testBaseUrl) {
  throw new Error("DATABASE_URL_TEST is required to run product-gallery-write integration tests.");
}

const parsedBase = new URL(testBaseUrl);
if (parsedBase.hostname.includes("neon.tech")) {
  throw new Error("Safety violation: DATABASE_URL_TEST points to Neon cloud.");
}
if (!["localhost", "127.0.0.1"].includes(parsedBase.hostname)) {
  throw new Error("Safety violation: DATABASE_URL_TEST must target local PostgreSQL test environment.");
}

const dbName = `pure_haven_storefront_write_${Date.now()}`;
if (!/^pure_haven_storefront_write_[0-9]+$/.test(dbName)) {
  throw new Error(`Safety violation: Invalid disposable database name ${dbName}`);
}

const disposableUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
const prevDbUrl = process.env.DATABASE_URL;
const prevTestUrl = process.env.DATABASE_URL_TEST;
const prevAdminSecret = process.env.ADMIN_SESSION_SECRET;

// Strengthened pre-migration target validation
const parsedDisposable = new URL(disposableUrl);
if (
  parsedDisposable.hostname !== parsedBase.hostname ||
  parsedDisposable.port !== parsedBase.port ||
  parsedDisposable.protocol !== parsedBase.protocol ||
  parsedDisposable.pathname !== `/${dbName}`
) {
  throw new Error("Target validation failed: disposable URL does not match base configuration.");
}

import crypto from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";
import {
  normalizeProductImageReference,
  classifyLegacyProductImageUrl,
  resolveBridgeSourceKind,
} from "../lib/catalog/galleryPersistence.js";
import { applyGalleryMutation } from "../lib/catalog/galleryWrite.js";

describe("Task 2 — Gallery Domain Validation + Write Authority", () => {
  let prisma: PrismaClient;
  let PUT: (req: Request) => Promise<Response>;
  let authCookieHeader: string;
  let rawClient: pg.Client;

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

    // 3. Point both DATABASE_URL and DATABASE_URL_TEST to disposableUrl before dynamic imports
    process.env.DATABASE_URL = disposableUrl;
    process.env.DATABASE_URL_TEST = disposableUrl;

    const prismaModule = await import("../lib/prisma.js");
    prisma = prismaModule.prisma;

    const routeModule = await import("../app/api/products/route.js");
    PUT = routeModule.PUT;

    // Test environment hygiene: random test-only admin secret
    process.env.ADMIN_SESSION_SECRET = `test_secret_${crypto.randomBytes(24).toString("hex")}`;
    const adminToken = createAdminSessionToken("admin@purehaven.test");
    authCookieHeader = `${ADMIN_SESSION_COOKIE}=${adminToken}`;

    rawClient = new Client({ connectionString: disposableUrl });
    await rawClient.connect();

    // Verify read-only: SELECT current_database() equals generated dbName
    const dbCheck = await rawClient.query("SELECT current_database()");
    assert.strictEqual(
      dbCheck.rows[0].current_database,
      dbName,
      "Connected database must match generated disposable dbName"
    );
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
      process.env.DATABASE_URL = prevDbUrl;
      process.env.DATABASE_URL_TEST = prevTestUrl;
      process.env.ADMIN_SESSION_SECRET = prevAdminSecret;
    }
  });

  it("1. Full gallery multi-image replacement replaces gallery rows and updates Product.image mirror (A, B, D)", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 1",
        slug: `skincare-${Date.now()}-1`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Original Serum",
        price: 1500,
        image: "/uploads/products/original-primary.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 10,
      },
    });

    await prisma.productImage.createMany({
      data: [
        {
          productId: product.id,
          url: "/uploads/products/original-primary.jpg",
          sortOrder: 1,
          sourceKind: "LEGACY_LOCAL",
        },
        {
          productId: product.id,
          url: "/uploads/products/original-secondary.jpg",
          sortOrder: 2,
          sourceKind: "LEGACY_LOCAL",
        },
      ],
    });

    const putPayload = {
      id: product.id,
      name: "Updated Serum",
      category: category.name,
      categoryId: category.id,
      price: 1500,
      images: [
        "/uploads/products/new-primary.jpg",
        "/uploads/products/new-secondary.jpg",
      ],
    };

    const req = new Request("http://localhost:3000/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookieHeader,
      },
      body: JSON.stringify(putPayload),
    });

    const res = await PUT(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}: ${JSON.stringify(data)}`);

    const updatedProduct = await prisma.product.findUnique({
      where: { id: product.id },
    });
    assert.strictEqual(
      updatedProduct?.image,
      "/uploads/products/new-primary.jpg",
      "Product.image mirror must be updated to images[0]"
    );

    const galleryRows = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: "asc" },
    });
    assert.strictEqual(galleryRows.length, 2, "Must have exactly 2 gallery rows");
    assert.strictEqual(galleryRows[0].sortOrder, 1);
    assert.strictEqual(galleryRows[0].url, "/uploads/products/new-primary.jpg");
    assert.strictEqual(galleryRows[1].sortOrder, 2);
    assert.strictEqual(galleryRows[1].url, "/uploads/products/new-secondary.jpg");
  });

  it("2. Full gallery 1-image replacement removes obsolete secondary rows (A, C)", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 2",
        slug: `skincare-${Date.now()}-2`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Triple Image Product",
        price: 990,
        image: "/images/p1.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    await prisma.productImage.createMany({
      data: [
        { productId: product.id, url: "/images/p1.jpg", sortOrder: 1, sourceKind: "LEGACY_LOCAL" },
        { productId: product.id, url: "/images/p2.jpg", sortOrder: 2, sourceKind: "LEGACY_LOCAL" },
        { productId: product.id, url: "/images/p3.jpg", sortOrder: 3, sourceKind: "LEGACY_LOCAL" },
      ],
    });

    const putPayload = {
      id: product.id,
      name: "Single Image Product",
      category: category.name,
      categoryId: category.id,
      price: 990,
      images: ["/images/only-one.jpg"],
    };

    const req = new Request("http://localhost:3000/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookieHeader,
      },
      body: JSON.stringify(putPayload),
    });

    const res = await PUT(req);
    assert.strictEqual(res.status, 200);

    const updatedProduct = await prisma.product.findUnique({
      where: { id: product.id },
    });
    assert.strictEqual(updatedProduct?.image, "/images/only-one.jpg");

    const galleryRows = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: "asc" },
    });
    assert.strictEqual(galleryRows.length, 1, "Obsolete secondaries must be removed");
    assert.strictEqual(galleryRows[0].sortOrder, 1);
    assert.strictEqual(galleryRows[0].url, "/images/only-one.jpg");
  });

  it("3. Syntactic gallery validation rejects empty, oversized, duplicate, and invalid image references (E, F, G, H)", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 3",
        slug: `skincare-${Date.now()}-3`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Validation Test Product",
        price: 500,
        image: "/images/valid.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    const makeReq = (imagesPayload: unknown) =>
      new Request("http://localhost:3000/api/products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookieHeader,
        },
        body: JSON.stringify({
          id: product.id,
          name: "Validation Test Product",
          category: category.name,
          categoryId: category.id,
          price: 500,
          images: imagesPayload,
        }),
      });

    // E: images=[] rejected
    const resEmpty = await PUT(makeReq([]));
    assert.strictEqual(resEmpty.status, 400, "images=[] must return 400");
    const dataEmpty = await resEmpty.json();
    assert.match(dataEmpty.message, /cannot be empty/i);

    // F: images > 4 rejected
    const resOver = await PUT(
      makeReq([
        "/images/1.jpg",
        "/images/2.jpg",
        "/images/3.jpg",
        "/images/4.jpg",
        "/images/5.jpg",
      ])
    );
    assert.strictEqual(resOver.status, 400, "images > 4 must return 400");
    const dataOver = await resOver.json();
    assert.match(dataOver.message, /exceed/i);

    // G: duplicate normalized gallery URLs rejected
    const resDup = await PUT(
      makeReq(["/uploads/products/item.jpg", "/uploads/products/item.jpg"])
    );
    assert.strictEqual(resDup.status, 400, "Duplicate URLs must return 400");
    const dataDup = await resDup.json();
    assert.match(dataDup.message, /duplicate/i);

    // H: invalid persisted reference (data:, javascript:, arbitrary invalid path)
    const resDataScheme = await PUT(makeReq(["data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="]));
    assert.strictEqual(resDataScheme.status, 400, "data: scheme must return 400");

    const resJsScheme = await PUT(makeReq(["javascript:alert(1)"]));
    assert.strictEqual(resJsScheme.status, 400, "javascript: scheme must return 400");

    const resInvalidPath = await PUT(makeReq(["/malformed/unknown/path.jpg"]));
    assert.strictEqual(resInvalidPath.status, 400, "arbitrary unapproved path must return 400");

    const resEmptyStr = await PUT(makeReq(["   "]));
    assert.strictEqual(resEmptyStr.status, 400, "whitespace-only image reference must return 400");
  });

  it("4. Legacy image PUT updates position 1, preserves positions 2..N, and synchronizes mirror (I, J, L)", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 4",
        slug: `skincare-${Date.now()}-4`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Legacy Update Product",
        price: 1200,
        image: "/uploads/products/old-primary.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    await prisma.productImage.createMany({
      data: [
        { productId: product.id, url: "/uploads/products/old-primary.jpg", sortOrder: 1, sourceKind: "LEGACY_LOCAL" },
        { productId: product.id, url: "/uploads/products/preserved-second.jpg", sortOrder: 2, sourceKind: "LEGACY_LOCAL" },
        { productId: product.id, url: "/uploads/products/preserved-third.jpg", sortOrder: 3, sourceKind: "LEGACY_LOCAL" },
      ],
    });

    const putPayload = {
      id: product.id,
      name: "Legacy Update Product",
      category: category.name,
      categoryId: category.id,
      price: 1200,
      image: "/uploads/products/new-legacy-primary.jpg", // legacy image only, no images array
    };

    const req = new Request("http://localhost:3000/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookieHeader,
      },
      body: JSON.stringify(putPayload),
    });

    const res = await PUT(req);
    assert.strictEqual(res.status, 200);

    const updatedProduct = await prisma.product.findUnique({
      where: { id: product.id },
    });
    assert.strictEqual(
      updatedProduct?.image,
      "/uploads/products/new-legacy-primary.jpg",
      "Product.image mirror must match new primary"
    );

    const galleryRows = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: "asc" },
    });
    assert.strictEqual(galleryRows.length, 3, "All 3 positions must remain");
    assert.strictEqual(galleryRows[0].sortOrder, 1);
    assert.strictEqual(galleryRows[0].url, "/uploads/products/new-legacy-primary.jpg");
    assert.strictEqual(galleryRows[1].sortOrder, 2);
    assert.strictEqual(galleryRows[1].url, "/uploads/products/preserved-second.jpg");
    assert.strictEqual(galleryRows[2].sortOrder, 3);
    assert.strictEqual(galleryRows[2].url, "/uploads/products/preserved-third.jpg");
  });

  it("5. Legacy image duplicating an existing secondary is rejected with 400 (K)", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 5",
        slug: `skincare-${Date.now()}-5`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Duplicate Check Product",
        price: 800,
        image: "/images/primary.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    await prisma.productImage.createMany({
      data: [
        { productId: product.id, url: "/images/primary.jpg", sortOrder: 1, sourceKind: "LEGACY_LOCAL" },
        { productId: product.id, url: "/images/secondary.jpg", sortOrder: 2, sourceKind: "LEGACY_LOCAL" },
      ],
    });

    // Send legacy image that matches secondary position 2
    const putPayload = {
      id: product.id,
      name: "Duplicate Check Product",
      category: category.name,
      categoryId: category.id,
      price: 800,
      image: "/images/secondary.jpg",
    };

    const req = new Request("http://localhost:3000/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookieHeader,
      },
      body: JSON.stringify(putPayload),
    });

    const res = await PUT(req);
    assert.strictEqual(res.status, 400, "Must return 400 when legacy image duplicates secondary");
    const data = await res.json();
    assert.match(data.message, /duplicate/i);

    // Verify DB untouched
    const productAfter = await prisma.product.findUnique({ where: { id: product.id } });
    assert.strictEqual(productAfter?.image, "/images/primary.jpg");

    const galleryAfter = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: "asc" },
    });
    assert.strictEqual(galleryAfter[0].url, "/images/primary.jpg");
    assert.strictEqual(galleryAfter[1].url, "/images/secondary.jpg");
  });

  it("6. Conflict semantics: image vs images mismatch returns 400 before DB lookup, while matching pair succeeds (O, P & Section 14)", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 6",
        slug: `skincare-${Date.now()}-6`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Conflict Test Product",
        price: 1000,
        image: "/images/base.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    // Section 14: Deliberately nonexistent Product ID with conflicting image + images
    const reqNonexistentConflict = new Request("http://localhost:3000/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookieHeader,
      },
      body: JSON.stringify({
        id: 999999999, // nonexistent product
        name: "Ghost",
        category: category.name,
        price: 1000,
        images: ["/images/a.jpg"],
        image: "/images/b.jpg", // mismatch!
      }),
    });

    const resConflictPre = await PUT(reqNonexistentConflict);
    assert.strictEqual(
      resConflictPre.status,
      400,
      "Conflict check must occur before product lookup and return 400 instead of 404"
    );
    const dataConflictPre = await resConflictPre.json();
    assert.match(dataConflictPre.message, /Conflicting image authority/i);

    // Case P: Matching normalized pair succeeds
    const reqMatching = new Request("http://localhost:3000/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookieHeader,
      },
      body: JSON.stringify({
        id: product.id,
        name: "Conflict Test Product",
        category: category.name,
        categoryId: category.id,
        price: 1000,
        images: ["/images/same.jpg", "/images/two.jpg"],
        image: " /images/same.jpg ", // matches normalized images[0]
      }),
    });

    const resMatching = await PUT(reqMatching);
    assert.strictEqual(resMatching.status, 200, "Matching normalized legacy image and images[0] must succeed");

    const updatedProduct = await prisma.product.findUnique({ where: { id: product.id } });
    assert.strictEqual(updatedProduct?.image, "/images/same.jpg");
  });

  it("7. Strong metadata-only test: BEFORE UPDATE OF image trigger proves Product.image is omitted from SET (M, N & Section 12)", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 7",
        slug: `skincare-${Date.now()}-7`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Metadata Only Product",
        price: 750,
        image: "/uploads/products/unchanged.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    await prisma.productImage.createMany({
      data: [
        { productId: product.id, url: "/uploads/products/unchanged.jpg", sortOrder: 1, sourceKind: "LEGACY_LOCAL" },
        { productId: product.id, url: "/uploads/products/secondary-unchanged.jpg", sortOrder: 2, sourceKind: "LEGACY_LOCAL" },
      ],
    });

    // Create trigger that raises an exception if Product.image is in the UPDATE SET list
    await rawClient.query(`
      CREATE OR REPLACE FUNCTION fail_on_image_update() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW."image" IS DISTINCT FROM OLD."image" OR OLD."image" IS NOT DISTINCT FROM NEW."image" THEN
          RAISE EXCEPTION 'TRIGGER_VIOLATION: Product.image column was included in UPDATE statement';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_test_prevent_image_update
      BEFORE UPDATE OF "image" ON "Product"
      FOR EACH ROW
      EXECUTE FUNCTION fail_on_image_update();
    `);

    try {
      // Execute METADATA-ONLY PUT updating only description and price
      const putPayload = {
        id: product.id,
        name: "Metadata Only Product",
        category: category.name,
        categoryId: category.id,
        price: 900,
        description: "New updated description without image mutation",
      };

      const req = new Request("http://localhost:3000/api/products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookieHeader,
        },
        body: JSON.stringify(putPayload),
      });

      const res = await PUT(req);
      const data = await res.json();
      assert.strictEqual(
        res.status,
        200,
        `Metadata-only PUT must succeed without triggering BEFORE UPDATE OF image: ${JSON.stringify(data)}`
      );

      const productAfter = await prisma.product.findUnique({ where: { id: product.id } });
      assert.strictEqual(Number(productAfter?.price), 900);
      assert.strictEqual(productAfter?.description, "New updated description without image mutation");
      assert.strictEqual(productAfter?.image, "/uploads/products/unchanged.jpg");

      const galleryAfter = await prisma.productImage.findMany({
        where: { productId: product.id },
        orderBy: { sortOrder: "asc" },
      });
      assert.strictEqual(galleryAfter.length, 2);
      assert.strictEqual(galleryAfter[0].url, "/uploads/products/unchanged.jpg");
      assert.strictEqual(galleryAfter[1].url, "/uploads/products/secondary-unchanged.jpg");
    } finally {
      await rawClient.query(`
        DROP TRIGGER IF EXISTS trg_test_prevent_image_update ON "Product";
        DROP FUNCTION IF EXISTS fail_on_image_update();
      `);
    }
  });

  it("8. Transaction rollback test: forced failure during Product update rolls back gallery mutation (S & Section 13)", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 8",
        slug: `skincare-${Date.now()}-8`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Rollback Test Product",
        price: 1100,
        image: "/images/original-roll.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    await prisma.productImage.createMany({
      data: [
        { productId: product.id, url: "/images/original-roll.jpg", sortOrder: 1, sourceKind: "LEGACY_LOCAL" },
        { productId: product.id, url: "/images/original-roll-2.jpg", sortOrder: 2, sourceKind: "LEGACY_LOCAL" },
      ],
    });

    // Create trigger that fails unconditionally on any Product UPDATE
    await rawClient.query(`
      CREATE OR REPLACE FUNCTION fail_on_rollback_target() RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'TEST_FORCED_TRANSACTION_ROLLBACK';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_test_force_rollback ON "Product";
      CREATE TRIGGER trg_test_force_rollback
      BEFORE UPDATE ON "Product"
      FOR EACH ROW
      EXECUTE FUNCTION fail_on_rollback_target();
    `);

    try {
      const putPayload = {
        id: product.id,
        name: "Rollback Trigger Target",
        category: category.name,
        categoryId: category.id,
        price: 1100,
        images: ["/images/new-roll-1.jpg", "/images/new-roll-2.jpg", "/images/new-roll-3.jpg"],
      };

      const req = new Request("http://localhost:3000/api/products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookieHeader,
        },
        body: JSON.stringify(putPayload),
      });

      const res = await PUT(req);
      assert.strictEqual(res.status, 500, "Forced transaction failure must return 500");

      // Verify complete rollback in DB: ProductImage still has original 2 rows, Product.image unchanged
      const productAfter = await prisma.product.findUnique({ where: { id: product.id } });
      assert.strictEqual(productAfter?.name, "Rollback Test Product");
      assert.strictEqual(productAfter?.image, "/images/original-roll.jpg");

      const galleryAfter = await prisma.productImage.findMany({
        where: { productId: product.id },
        orderBy: { sortOrder: "asc" },
      });
      assert.strictEqual(galleryAfter.length, 2, "Gallery replacement must be completely rolled back");
      assert.strictEqual(galleryAfter[0].url, "/images/original-roll.jpg");
      assert.strictEqual(galleryAfter[1].url, "/images/original-roll-2.jpg");
    } finally {
      await rawClient.query(`
        DROP TRIGGER IF EXISTS trg_test_force_rollback ON "Product";
        DROP FUNCTION IF EXISTS fail_on_rollback_target();
      `);
    }
  });

  it("9. Soft-deleted Product is rejected by in-transaction revalidation (Q)", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 9",
        slug: `skincare-${Date.now()}-9`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Soft Deleted Product",
        price: 500,
        image: "/images/soft.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 0,
        deletedAt: new Date(),
      },
    });

    const putPayload = {
      id: product.id,
      name: "Attempt Update Soft Deleted",
      category: category.name,
      categoryId: category.id,
      price: 500,
      images: ["/images/new-soft.jpg"],
    };

    const req = new Request("http://localhost:3000/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookieHeader,
      },
      body: JSON.stringify(putPayload),
    });

    const res = await PUT(req);
    assert.strictEqual(res.status, 400, "Soft deleted product update must return 400");
    const data = await res.json();
    assert.match(data.message, /soft-deleted/i);
  });

  it("10. Unauthorized PUT remains rejected with 401 (R)", async () => {
    const req = new Request("http://localhost:3000/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: 1,
        name: "Unauthorized Attempt",
        category: "Skincare",
        price: 100,
        images: ["/images/any.jpg"],
      }),
    });

    const res = await PUT(req);
    assert.strictEqual(res.status, 401, "Unauthenticated request must return 401");
  });

  it("11. Legacy image on a product with no prior gallery creates position 1 row", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 11",
        slug: `skincare-${Date.now()}-11`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Zero Gallery Product",
        price: 300,
        image: "/images/zero.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    const putPayload = {
      id: product.id,
      name: "Zero Gallery Product",
      category: category.name,
      categoryId: category.id,
      price: 300,
      image: "/images/new-zero.jpg",
    };

    const req = new Request("http://localhost:3000/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookieHeader,
      },
      body: JSON.stringify(putPayload),
    });

    const res = await PUT(req);
    assert.strictEqual(res.status, 200);

    const galleryRows = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: "asc" },
    });
    assert.strictEqual(galleryRows.length, 1);
    assert.strictEqual(galleryRows[0].sortOrder, 1);
    assert.strictEqual(galleryRows[0].url, "/images/new-zero.jpg");
  });

  it("12. Full gallery reordering changes sortOrder and updates Product.image mirror", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 12",
        slug: `skincare-${Date.now()}-12`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Reorder Product",
        price: 450,
        image: "/images/first.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    await prisma.productImage.createMany({
      data: [
        { productId: product.id, url: "/images/first.jpg", sortOrder: 1, sourceKind: "LEGACY_LOCAL" },
        { productId: product.id, url: "/images/second.jpg", sortOrder: 2, sourceKind: "LEGACY_LOCAL" },
      ],
    });

    // Invert order: second becomes first
    const putPayload = {
      id: product.id,
      name: "Reorder Product",
      category: category.name,
      categoryId: category.id,
      price: 450,
      images: ["/images/second.jpg", "/images/first.jpg"],
    };

    const req = new Request("http://localhost:3000/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookieHeader,
      },
      body: JSON.stringify(putPayload),
    });

    const res = await PUT(req);
    assert.strictEqual(res.status, 200);

    const productAfter = await prisma.product.findUnique({ where: { id: product.id } });
    assert.strictEqual(productAfter?.image, "/images/second.jpg");

    const galleryRows = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: "asc" },
    });
    assert.strictEqual(galleryRows.length, 2);
    assert.strictEqual(galleryRows[0].sortOrder, 1);
    assert.strictEqual(galleryRows[0].url, "/images/second.jpg");
    assert.strictEqual(galleryRows[1].sortOrder, 2);
    assert.strictEqual(galleryRows[1].url, "/images/first.jpg");
  });

  it("13. External HTTPS URLs are accepted if valid, and rejected if insecure or credentialed", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 13",
        slug: `skincare-${Date.now()}-13`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "HTTPS Product",
        price: 600,
        image: "/images/base.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    // Valid HTTPS
    const resValid = await PUT(
      new Request("http://localhost:3000/api/products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookieHeader,
        },
        body: JSON.stringify({
          id: product.id,
          name: "HTTPS Product",
          category: category.name,
          categoryId: category.id,
          price: 600,
          images: ["https://example.com/cdn/prod1.jpg"],
        }),
      })
    );
    assert.strictEqual(resValid.status, 200);

    // Insecure HTTP rejected
    const resHttp = await PUT(
      new Request("http://localhost:3000/api/products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookieHeader,
        },
        body: JSON.stringify({
          id: product.id,
          name: "HTTPS Product",
          category: category.name,
          categoryId: category.id,
          price: 600,
          images: ["http://example.com/cdn/prod1.jpg"],
        }),
      })
    );
    assert.strictEqual(resHttp.status, 400);

    // Credentials in URL rejected
    const resCreds = await PUT(
      new Request("http://localhost:3000/api/products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookieHeader,
        },
        body: JSON.stringify({
          id: product.id,
          name: "HTTPS Product",
          category: category.name,
          categoryId: category.id,
          price: 600,
          images: ["https://user:pass@example.com/cdn/prod1.jpg"],
        }),
      })
    );
    assert.strictEqual(resCreds.status, 400);
  });

  it("14. Normalization boundary: strictly approved vs rejected forms", () => {
    // Approved
    assert.deepEqual(normalizeProductImageReference("/uploads/products/a.jpg"), {
      ok: true,
      url: "/uploads/products/a.jpg",
    });
    assert.deepEqual(normalizeProductImageReference("/images/a.jpg"), {
      ok: true,
      url: "/images/a.jpg",
    });
    assert.deepEqual(normalizeProductImageReference("https://example.com/a.jpg"), {
      ok: true,
      url: "https://example.com/a.jpg",
    });

    // Rejected
    const rejectedPaths = [
      "/uploads/other/a.jpg",
      "/brands/a.svg",
      "/brand-logos/a.svg",
      "uploads/products/a.jpg",
      "images/a.jpg",
      "/a.jpg",
      "http://example.com/a.jpg",
      "https://user:pass@example.com/a.jpg",
      "data:image/png;base64,abc",
      "javascript:alert(1)",
      "/uploads/products/../secret.jpg",
      "",
      "   ",
    ];

    for (const r of rejectedPaths) {
      const res = normalizeProductImageReference(r);
      assert.strictEqual(
        res.ok,
        false,
        `Path '${r}' must be rejected by persistence normalization`
      );
    }
  });

  it("15. Legacy image field presence semantics: explicit image: null, non-string, or empty rejected with 400", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 15",
        slug: `skincare-${Date.now()}-15`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Presence Test Product",
        price: 400,
        image: "/uploads/products/base.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    // Case A: image: null (not metadata-only! Must be rejected 400)
    const resNull = await PUT(
      new Request("http://localhost:3000/api/products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookieHeader,
        },
        body: JSON.stringify({
          id: product.id,
          name: "Presence Test Product",
          category: category.name,
          categoryId: category.id,
          price: 400,
          image: null,
        }),
      })
    );
    assert.strictEqual(resNull.status, 400, "Explicit image: null must return 400");

    // Case B: images: [...] alongside image: null (must be rejected 400, not silently ignored)
    const resBothNull = await PUT(
      new Request("http://localhost:3000/api/products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookieHeader,
        },
        body: JSON.stringify({
          id: product.id,
          name: "Presence Test Product",
          category: category.name,
          categoryId: category.id,
          price: 400,
          images: ["/uploads/products/valid.jpg"],
          image: null,
        }),
      })
    );
    assert.strictEqual(resBothNull.status, 400, "image: null alongside valid images must return 400");

    // Case C: image: 123 (non-string)
    const resNum = await PUT(
      new Request("http://localhost:3000/api/products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookieHeader,
        },
        body: JSON.stringify({
          id: product.id,
          name: "Presence Test Product",
          category: category.name,
          categoryId: category.id,
          price: 400,
          image: 123,
        }),
      })
    );
    assert.strictEqual(resNum.status, 400, "image: 123 must return 400");
  });

  it("16. Normalized legacy-secondary duplicate check rejects primary matching normalized secondary", async () => {
    const category = await prisma.category.create({
      data: {
        name: "Skincare Cat 16",
        slug: `skincare-${Date.now()}-16`,
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        name: "Normalized Dup Product",
        price: 500,
        image: "/uploads/products/p1.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
      },
    });

    await prisma.productImage.createMany({
      data: [
        { productId: product.id, url: "/uploads/products/p1.jpg", sortOrder: 1, sourceKind: "LEGACY_LOCAL" },
        { productId: product.id, url: " /uploads/products/p2.jpg ", sortOrder: 2, sourceKind: "LEGACY_LOCAL" }, // secondary has whitespace
      ],
    });

    // Request submits trimmed normalized version of secondary
    const res = await PUT(
      new Request("http://localhost:3000/api/products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookieHeader,
        },
        body: JSON.stringify({
          id: product.id,
          name: "Normalized Dup Product",
          category: category.name,
          categoryId: category.id,
          price: 500,
          image: "/uploads/products/p2.jpg",
        }),
      })
    );
    assert.strictEqual(res.status, 400, "Duplicate secondary via normalized match must return 400");
    const data = await res.json();
    assert.match(data.message, /duplicate/i);
  });

  it("17. Production mock fallback removal: applyGalleryMutation throws if tx.productImage is missing", async () => {
    const fakeTx = {} as unknown as Parameters<typeof applyGalleryMutation>[0];
    await assert.rejects(
      async () => {
        await applyGalleryMutation(fakeTx, {
          productId: 1,
          intent: { kind: "gallery", images: ["/uploads/products/a.jpg"] },
        });
      },
      (err: unknown) => {
        return err instanceof Error || err instanceof TypeError;
      },
      "applyGalleryMutation must not silently succeed when tx.productImage is missing"
    );
  });
});

describe("Phase 6 Task 5 — Bridge Legacy Product Image Classification", () => {
  it("classifies approved legacy local and external roots", () => {
    assert.equal(classifyLegacyProductImageUrl("/uploads/products/a.jpg"), "LEGACY_LOCAL");
    assert.equal(classifyLegacyProductImageUrl("/images/a.jpg"), "LEGACY_LOCAL");
    assert.equal(classifyLegacyProductImageUrl("https://cdn.example.com/a.jpg"), "LEGACY_EXTERNAL");
  });

  it("rejects unsupported, insecure, or traversal references", () => {
    assert.throws(
      () => classifyLegacyProductImageUrl("http://example.com/a.jpg"),
      /PRODUCT_IMAGE_REFERENCE_UNSUPPORTED/
    );
    assert.throws(
      () => classifyLegacyProductImageUrl("data:image/png;base64,abc"),
      /PRODUCT_IMAGE_REFERENCE_UNSUPPORTED/
    );
    assert.throws(
      () => classifyLegacyProductImageUrl("blob:https://example.com/uuid"),
      /PRODUCT_IMAGE_REFERENCE_UNSUPPORTED/
    );
    assert.throws(
      () => classifyLegacyProductImageUrl("/other/path/a.jpg"),
      /PRODUCT_IMAGE_REFERENCE_UNSUPPORTED/
    );
    assert.throws(
      () => classifyLegacyProductImageUrl("/uploads/products/../secret.jpg"),
      /PRODUCT_IMAGE_REFERENCE_UNSUPPORTED/
    );
  });

  it("resolves bridge sourceKind for null and explicit sourceKind", () => {
    assert.equal(resolveBridgeSourceKind({ sourceKind: "MANAGED", url: "/any.jpg" }), "MANAGED");
    assert.equal(
      resolveBridgeSourceKind({ sourceKind: null, url: "/uploads/products/a.jpg" }),
      "LEGACY_LOCAL"
    );
    assert.equal(
      resolveBridgeSourceKind({ sourceKind: null, url: "https://cdn.example.com/a.jpg" }),
      "LEGACY_EXTERNAL"
    );
  });
});
