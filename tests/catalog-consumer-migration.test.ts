/**
 * Phase 5 Task 8 / Wave I — Keyset Sitemap Traversal & Decimal Authority Regression Suite
 *
 * Verifies:
 *   1. getSitemapProductRowsBatch keyset contract & defensive parameter bounds
 *   2. Multi-batch keyset traversal with strict id ASC ordering and zero OFFSET
 *   3. Sitemap lifecycle exclusions (inactive, soft-deleted)
 *   4. app/sitemap.ts keyset traversal, URL structure, and lastModified preservation
 *   5. PostgreSQL NUMERIC / Prisma Decimal monetary authority (checkout re-reads DB price)
 *   6. DTO Number presentation-only boundary
 *   7. Database-authoritative stock verification at checkout
 */

import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { validateTestDatabaseSafety } from "./integration/db-safety";
import type { PrismaClient } from "../generated/prisma/client";

const safety = validateTestDatabaseSafety();

describe(
  "Phase 5 Task 8 — Keyset Sitemap Traversal & Decimal Authority Regression",
  {
    skip:
      !safety.safe &&
      "TEST_DATABASE_REQUIRED: Set DATABASE_URL_TEST to run real PostgreSQL keyset sitemap tests",
  },
  () => {
    const runKey = `p5t8_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const catSlug = `sitemap-cat-${runKey}`;

    let prisma: PrismaClient;
    let getSitemapProductRowsBatch: typeof import("../lib/catalog/publicCatalogQuery").getSitemapProductRowsBatch;
    let sitemapDefaultFn: typeof import("../app/sitemap").default;
    let postOrdersFn: typeof import("../app/api/orders/route").POST;
    let getPublicCatalogQuery: typeof import("../lib/catalog/publicCatalogQuery").getPublicCatalogQuery;
    let getPublicProductDetailQuery: typeof import("../lib/catalog/publicCatalogQuery").getPublicProductDetailQuery;

    // Fixture tracking for reverse cleanup
    const createdCategoryIds: number[] = [];
    const createdProductIds: number[] = [];
    const createdOrderIds: string[] = [];

    // Specific product IDs
    const activeProductIds: number[] = [];
    let inactiveProductId: number;
    let deletedProductId: number;
    let decimalPriceProductId: number;

    before(async () => {
      // 1. Establish DATABASE_URL_TEST before importing Prisma
      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";

      const prismaModule = await import("../lib/prisma");
      prisma = prismaModule.prisma;

      const publicCatalogModule = await import("../lib/catalog/publicCatalogQuery");
      getSitemapProductRowsBatch = publicCatalogModule.getSitemapProductRowsBatch;
      getPublicCatalogQuery = publicCatalogModule.getPublicCatalogQuery;
      getPublicProductDetailQuery = publicCatalogModule.getPublicProductDetailQuery;

      const sitemapModule = await import("../app/sitemap");
      sitemapDefaultFn = sitemapModule.default;

      const ordersRouteModule = await import("../app/api/orders/route");
      postOrdersFn = ordersRouteModule.POST;

      // 2. Create Category fixture
      const cat = await prisma.category.create({
        data: {
          name: `Sitemap Category ${runKey}`,
          slug: catSlug,
          isActive: true,
          sortOrder: 1,
        },
      });
      createdCategoryIds.push(cat.id);

      // 3. Create 7 active products for multi-batch testing (e.g. batches of 3)
      for (let i = 1; i <= 7; i++) {
        const prod = await prisma.product.create({
          data: {
            name: `Active Product ${i} ${runKey}`,
            price: 100 + i,
            image: `/img-${i}-${runKey}.jpg`,
            category: catSlug,
            categoryId: cat.id,
            isActive: true,
          },
        });
        activeProductIds.push(prod.id);
        createdProductIds.push(prod.id);
      }

      // Sort activeProductIds in ascending order for deterministic comparison
      activeProductIds.sort((a, b) => a - b);

      // 4. Create 1 inactive product (must be excluded)
      const inactiveProd = await prisma.product.create({
        data: {
          name: `Inactive Product ${runKey}`,
          price: 50,
          image: `/img-inactive-${runKey}.jpg`,
          category: catSlug,
          categoryId: cat.id,
          isActive: false,
        },
      });
      inactiveProductId = inactiveProd.id;
      createdProductIds.push(inactiveProd.id);

      // 5. Create 1 soft-deleted product (must be excluded)
      const deletedProd = await prisma.product.create({
        data: {
          name: `Deleted Product ${runKey}`,
          price: 60,
          image: `/img-deleted-${runKey}.jpg`,
          category: catSlug,
          categoryId: cat.id,
          isActive: true,
          deletedAt: new Date(),
        },
      });
      deletedProductId = deletedProd.id;
      createdProductIds.push(deletedProd.id);

      // 6. Create 1 precise Decimal price product (1234.57) for Decimal authority verification
      const decimalProd = await prisma.product.create({
        data: {
          name: `Decimal Authority Product ${runKey}`,
          price: 1234.57,
          image: `/img-dec-${runKey}.jpg`,
          category: catSlug,
          categoryId: cat.id,
          stock: 25,
          isActive: true,
        },
      });
      decimalPriceProductId = decimalProd.id;
      createdProductIds.push(decimalProd.id);
    });

    after(async () => {
      // Reverse dependency cleanup
      if (createdOrderIds.length > 0) {
        // Clean order-related tables
        await prisma.orderItem.deleteMany({
          where: { orderId: { in: createdOrderIds } },
        });
        await prisma.inventoryReservation.deleteMany({
          where: { orderId: { in: createdOrderIds } },
        });
        await prisma.paymentEvidenceAttempt.deleteMany({
          where: { paymentRecord: { orderId: { in: createdOrderIds } } },
        });
        await prisma.paymentRecord.deleteMany({
          where: { orderId: { in: createdOrderIds } },
        });
        await prisma.order.deleteMany({
          where: { id: { in: createdOrderIds } },
        });
      }

      if (createdProductIds.length > 0) {
        await prisma.productVariant.deleteMany({
          where: { productId: { in: createdProductIds } },
        });
        await prisma.product.deleteMany({
          where: { id: { in: createdProductIds } },
        });
      }

      if (createdCategoryIds.length > 0) {
        await prisma.category.deleteMany({
          where: { id: { in: createdCategoryIds } },
        });
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // Section A: Keyset Sitemap Helper Contract & Bounds Validation
    // ──────────────────────────────────────────────────────────────────────────

    it("1. getSitemapProductRowsBatch is exported and is a function", () => {
      assert.strictEqual(
        typeof getSitemapProductRowsBatch,
        "function",
        "Task 8 requires getSitemapProductRowsBatch to be exported from lib/catalog/publicCatalogQuery"
      );
    });

    it("2. getSitemapProductRowsBatch rejects invalid take values (fail-closed bounds)", async () => {
      if (!getSitemapProductRowsBatch) {
        assert.fail("getSitemapProductRowsBatch not implemented");
      }

      const invalidTakes = [0, -1, -100, 1001, 5000, 1.5, NaN, Infinity, -Infinity];

      for (const take of invalidTakes) {
        await assert.rejects(
          async () => {
            await getSitemapProductRowsBatch!({ take });
          },
          /invalid|bound|take/i,
          `take=${take} must be rejected with an error`
        );
      }
    });

    it("3. getSitemapProductRowsBatch defaults take to 1000 when omitted", async () => {
      if (!getSitemapProductRowsBatch) {
        assert.fail("getSitemapProductRowsBatch not implemented");
      }

      const rows = await getSitemapProductRowsBatch!();
      assert.ok(Array.isArray(rows), "must return array");
      assert.ok(rows.length <= 1000, "rows must not exceed 1000");
    });

    it("4. getSitemapProductRowsBatch returns projection containing strictly { id, updatedAt }", async () => {
      if (!getSitemapProductRowsBatch) {
        assert.fail("getSitemapProductRowsBatch not implemented");
      }

      const rows = await getSitemapProductRowsBatch!({ take: 10 });
      assert.ok(rows.length > 0, "must return rows");

      for (const row of rows) {
        assert.ok(typeof row.id === "number", "row.id must be a number");
        assert.ok(row.updatedAt instanceof Date, "row.updatedAt must be a Date instance");

        // Forbidden fields must NOT be present
        assert.ok(!("price" in row), "row must not select price");
        assert.ok(!("name" in row), "row must not select name");
        assert.ok(!("description" in row), "row must not select description");
        assert.ok(!("category" in row), "row must not select category");
        assert.ok(!("stock" in row), "row must not select stock");
        assert.ok(!("variants" in row), "row must not select variants");
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // Section B: Keyset Multi-Batch Traversal & Lifecycle Exclusions
    // ──────────────────────────────────────────────────────────────────────────

    it("5. Multi-batch keyset traversal emits all fixture products in strict id ASC order with zero duplicates", async () => {
      if (!getSitemapProductRowsBatch) {
        assert.fail("getSitemapProductRowsBatch not implemented");
      }

      // We query active products in batches of 3
      const collectedIds: number[] = [];
      let afterId: number | undefined;

      while (true) {
        const batch = await getSitemapProductRowsBatch!({
          afterId,
          take: 3,
        });

        if (batch.length === 0) break;

        const lastItem = batch[batch.length - 1];
        if (afterId !== undefined) {
          assert.ok(
            lastItem.id > afterId,
            `Keyset must advance forward: lastItem.id (${lastItem.id}) > afterId (${afterId})`
          );
        }

        for (const item of batch) {
          collectedIds.push(item.id);
        }

        afterId = lastItem.id;
        if (batch.length < 3) break;
      }

      // Verify all our active fixture IDs are present
      for (const id of activeProductIds) {
        assert.ok(
          collectedIds.includes(id),
          `Active fixture product id=${id} must be collected in keyset traversal`
        );
      }

      // Verify collected active fixture IDs are in strict ascending order
      const collectedFixtureIds = collectedIds.filter((id) => activeProductIds.includes(id));
      assert.deepStrictEqual(
        collectedFixtureIds,
        activeProductIds,
        "Fixture IDs must be emitted in exact ascending order"
      );

      // Verify no duplicates
      const uniqueIds = new Set(collectedIds);
      assert.strictEqual(uniqueIds.size, collectedIds.length, "Keyset traversal must contain zero duplicate IDs");
    });

    it("6. Keyset traversal excludes inactive and soft-deleted products", async () => {
      if (!getSitemapProductRowsBatch) {
        assert.fail("getSitemapProductRowsBatch not implemented");
      }

      // Collect all products via keyset traversal
      const collectedIds: number[] = [];
      let afterId: number | undefined;

      while (true) {
        const batch = await getSitemapProductRowsBatch!({
          afterId,
          take: 100,
        });
        if (batch.length === 0) break;
        for (const item of batch) {
          collectedIds.push(item.id);
        }
        afterId = batch[batch.length - 1].id;
        if (batch.length < 100) break;
      }

      assert.ok(
        !collectedIds.includes(inactiveProductId),
        `Inactive product (id=${inactiveProductId}) must be excluded from sitemap`
      );
      assert.ok(
        !collectedIds.includes(deletedProductId),
        `Soft-deleted product (id=${deletedProductId}) must be excluded from sitemap`
      );
    });

    // ──────────────────────────────────────────────────────────────────────────
    // Section C: app/sitemap.ts End-to-End Traversal & URL Structure
    // ──────────────────────────────────────────────────────────────────────────

    it("7. app/sitemap.ts traverses products using keyset batching and emits valid entries", async () => {
      if (!sitemapDefaultFn) {
        assert.fail("app/sitemap.ts default export not found");
      }

      const entries = await sitemapDefaultFn();
      assert.ok(Array.isArray(entries), "sitemap must return an array of entries");

      const baseUrl = "https://pure-haven-bd-final-wdb1.vercel.app";

      // Verify static routes are present
      const urls = entries.map((e) => e.url);
      assert.ok(urls.includes(baseUrl), "sitemap must include root URL");
      assert.ok(urls.includes(`${baseUrl}/shop`), "sitemap must include /shop URL");
      assert.ok(urls.includes(`${baseUrl}/track-order`), "sitemap must include /track-order URL");

      // Verify active fixture product URLs are present and lastModified matches database updatedAt
      const dbProd = await prisma.product.findUnique({
        where: { id: activeProductIds[0] },
        select: { updatedAt: true },
      });
      assert.ok(dbProd !== null);

      for (const id of activeProductIds) {
        const expectedUrl = `${baseUrl}/product/${id}`;
        const entry = entries.find((e) => e.url === expectedUrl);
        assert.ok(entry !== undefined, `sitemap must include active product URL: ${expectedUrl}`);
        assert.ok(entry!.lastModified !== undefined, "entry.lastModified must be set from updatedAt");
      }

      const sampleEntry = entries.find((e) => e.url === `${baseUrl}/product/${activeProductIds[0]}`);
      assert.ok(sampleEntry !== null && sampleEntry?.lastModified !== undefined);
      const entryTime = new Date(sampleEntry!.lastModified!).getTime();
      const expectedTime = new Date(dbProd.updatedAt).getTime();
      assert.strictEqual(
        entryTime,
        expectedTime,
        "entry.lastModified must equal the database product updatedAt timestamp, not new Date()"
      );

      // Verify inactive & deleted are absent
      assert.ok(
        !urls.includes(`${baseUrl}/product/${inactiveProductId}`),
        "sitemap must NOT include inactive product URL"
      );
      assert.ok(
        !urls.includes(`${baseUrl}/product/${deletedProductId}`),
        "sitemap must NOT include soft-deleted product URL"
      );
    });

    it("8. Source guard: getSitemapProductRowsBatch has no skip and app/sitemap.ts uses keyset helper", () => {
      const queryFileContent = fs.readFileSync(
        path.join(process.cwd(), "lib/catalog/publicCatalogQuery.ts"),
        "utf8"
      );
      const sitemapFileContent = fs.readFileSync(
        path.join(process.cwd(), "app/sitemap.ts"),
        "utf8"
      );

      // getSitemapProductRowsBatch must use keyset and NOT skip
      assert.ok(
        queryFileContent.includes("getSitemapProductRowsBatch"),
        "lib/catalog/publicCatalogQuery.ts must contain getSitemapProductRowsBatch"
      );

      // Extract getSitemapProductRowsBatch body
      const fnIndex = queryFileContent.indexOf("getSitemapProductRowsBatch");
      const fnSlice = queryFileContent.slice(fnIndex, fnIndex + 1200);
      assert.ok(!fnSlice.includes("skip:"), "getSitemapProductRowsBatch must not use skip: parameter");

      // app/sitemap.ts must use keyset helper and not unbounded getProducts()
      assert.ok(
        sitemapFileContent.includes("getSitemapProductRowsBatch"),
        "app/sitemap.ts must use getSitemapProductRowsBatch"
      );
      assert.ok(
        !sitemapFileContent.includes("getProducts()"),
        "app/sitemap.ts must not call getProducts()"
      );
    });

    // ──────────────────────────────────────────────────────────────────────────
    // Section D: PostgreSQL Decimal Monetary Authority Regression
    // ──────────────────────────────────────────────────────────────────────────

    it("9. Decimal authority: POST /api/orders re-reads PostgreSQL Decimal price and ignores client pricing", async () => {
      if (!postOrdersFn) {
        assert.fail("POST /api/orders not found");
      }

      // Prepare order request with deliberate incorrect client prices (if client attempted to pass any)
      const submissionToken = `sub_dec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const req = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `192.168.1.${Math.floor(Math.random() * 200) + 1}`,
        },
        body: JSON.stringify({
          submissionToken,
          customerName: "Decimal Authority Test",
          customerPhone: "01711998877",
          customerCity: "Dhaka",
          customerAddress: "123 Test Street",
          paymentMethod: "Cash on Delivery",
          items: [
            {
              productId: decimalPriceProductId,
              quantity: 2,
              // Stale/tampered client price that MUST be ignored
              price: 1.00,
              subtotal: 2.00,
              total: 2.00,
            },
          ],
        }),
      });

      const res = await postOrdersFn(req);
      const data = await res.json();

      assert.strictEqual(res.status, 200, `Order creation must succeed. Got: ${JSON.stringify(data)}`);
      assert.strictEqual(data.success, true);
      assert.ok(data.order, "Order data must be returned");

      const createdOrderId = data.order.id;
      createdOrderIds.push(createdOrderId);

      // Verify authoritative calculations in PostgreSQL database:
      // Expected: price = 1234.57, qty = 2 -> subtotal = 2469.14, deliveryFee = 60.00 -> total = 2529.14
      const dbOrder = await prisma.order.findUnique({
        where: { id: createdOrderId },
        include: { items: true },
      });

      assert.ok(dbOrder !== null, "Order must exist in database");
      assert.strictEqual(dbOrder.items.length, 1);

      // Verify item price was set from PostgreSQL Decimal (1234.57), NOT client price (1.00)
      assert.strictEqual(
        Number(dbOrder.items[0].price),
        1234.57,
        "Order item price in DB must be exactly 1234.57 (PostgreSQL Decimal authority)"
      );

      // Verify subtotal in DB
      assert.strictEqual(
        Number(dbOrder.subtotal),
        2469.14,
        "Order subtotal in DB must be 2469.14 (1234.57 * 2)"
      );

      // Verify total in DB (subtotal 2469.14 + delivery fee 120.00 = 2589.14)
      assert.strictEqual(
        Number(dbOrder.total),
        2589.14,
        "Order total in DB must be 2589.14 (2469.14 subtotal + 120.00 delivery fee)"
      );
    });

    it("10. DTO presentation number boundary: DTO output produces JavaScript number from Prisma Decimal", async () => {
      const detail = await getPublicProductDetailQuery(decimalPriceProductId);
      assert.ok(detail !== null, "product detail must exist");
      assert.strictEqual(typeof detail.price, "number", "DTO price must be a JavaScript number");
      assert.strictEqual(detail.price, 1234.57, "DTO price must equal 1234.57");

      const catalog = await getPublicCatalogQuery({
        page: 1,
        pageSize: 24,
        sort: "latest",
        category: null,
        subcategory: null,
        q: `Decimal Authority Product ${runKey}`,
        skip: 0,
        invalidFilter: false,
      });

      assert.strictEqual(catalog.items.length, 1);
      assert.strictEqual(typeof catalog.items[0].price, "number");
      assert.strictEqual(catalog.items[0].price, 1234.57);
    });

    it("11. Stock authority: POST /api/orders validates stock from database and rejects over-quantity", async () => {
      if (!postOrdersFn) {
        assert.fail("POST /api/orders not found");
      }

      // decimalProd has stock = 25 (created above). Requesting quantity = 100 must fail with 409
      const req = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `192.168.1.${Math.floor(Math.random() * 200) + 1}`,
        },
        body: JSON.stringify({
          customerName: "Over Stock Test",
          customerPhone: "01711998866",
          customerCity: "Dhaka",
          customerAddress: "123 Test Street",
          paymentMethod: "Cash on Delivery",
          items: [
            {
              productId: decimalPriceProductId,
              quantity: 100, // exceeds available stock 25
            },
          ],
        }),
      });

      const res = await postOrdersFn(req);
      const data = await res.json();

      assert.strictEqual(res.status, 409, "Excess quantity must return HTTP 409");
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, "INSUFFICIENT_STOCK");
    });
  }
);
