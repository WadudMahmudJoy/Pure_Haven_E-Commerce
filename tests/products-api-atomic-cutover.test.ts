import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateTestDatabaseSafety } from "./integration/db-safety";
import type { PrismaClient } from "../generated/prisma/client";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "../lib/adminSession";

const safety = validateTestDatabaseSafety();

describe(
  "Phase 5 Task 4 / 4A — Products API Atomic Cutover & Full Consumer Migration",
  {
    skip:
      !safety.safe &&
      "TEST_DATABASE_REQUIRED: Set DATABASE_URL_TEST to run real PostgreSQL API cutover integration tests",
  },
  () => {
    const runKey = `p5_api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    process.env.ADMIN_SESSION_SECRET =
      process.env.ADMIN_SESSION_SECRET ||
      "test_secret_for_admin_session_auth_testing_32chars_long";

    let prisma: PrismaClient;
    let GET: (req: Request) => Promise<Response>;

    const createdCategoryIds: number[] = [];
    const createdProductIds: number[] = [];
    const createdVariantIds: number[] = [];

    let pPublicActiveId: number;
    let pInactiveId: number;
    let pDeletedId: number;
    let pAdminTargetId: number;

    // Task 4A specific fixture IDs
    let pLowStock0Id: number;
    let pLowStock3Id: number;
    let pStock4Id: number;
    let pInactiveStock0Id: number;
    let pDeletedStock0Id: number;

    let pHotFilterId: number;
    let pUpcomingFilterId: number;
    let pDiscountFilterId: number;
    let pEqualPriceFilterId: number;
    let pBadgeFilterId: number;

    let authCookieHeader: string;

    before(async () => {
      // 1. Establish test database environment BEFORE dynamic import
      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";

      const prismaModule = await import("../lib/prisma");
      prisma = prismaModule.prisma;

      const routeModule = await import("../app/api/products/route");
      GET = routeModule.GET;

      const adminToken = createAdminSessionToken("admin@purehaven.test");
      authCookieHeader = `${ADMIN_SESSION_COOKIE}=${adminToken}`;

      // 2. Create Category
      const cat = await prisma.category.create({
        data: {
          name: `API Cat ${runKey}`,
          slug: `api-cat-${runKey}`,
          isActive: true,
          sortOrder: 1,
        },
      });
      createdCategoryIds.push(cat.id);

      // 3. Create Public Active Product with active + inactive variants
      const pActive = await prisma.product.create({
        data: {
          name: `Public Active Prod ${runKey}`,
          price: 120.0,
          compareAtPrice: 150.0,
          image: "/images/p-active.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          subcategory: `Sub ${runKey}`,
          description: `Public detailed description ${runKey}`,
          isActive: true,
          stock: 20,
        },
      });
      pPublicActiveId = pActive.id;
      createdProductIds.push(pActive.id);

      const vActive = await prisma.productVariant.create({
        data: {
          productId: pActive.id,
          label: "50ml Active",
          price: 120.0,
          stock: 12,
          isActive: true,
          sortOrder: 1,
        },
      });
      createdVariantIds.push(vActive.id);

      const vInactive = await prisma.productVariant.create({
        data: {
          productId: pActive.id,
          label: "100ml Inactive",
          price: 220.0,
          stock: 8,
          isActive: false,
          sortOrder: 2,
        },
      });
      createdVariantIds.push(vInactive.id);

      // 4. Create Inactive Product
      const pInact = await prisma.product.create({
        data: {
          name: `Inactive Prod ${runKey}`,
          price: 100.0,
          image: "/images/inact.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isActive: false,
          stock: 0,
        },
      });
      pInactiveId = pInact.id;
      createdProductIds.push(pInact.id);

      // 5. Create Soft-Deleted Product
      const pDel = await prisma.product.create({
        data: {
          name: `Deleted Prod ${runKey}`,
          price: 100.0,
          image: "/images/del.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isActive: true,
          deletedAt: new Date(),
          stock: 0,
        },
      });
      pDeletedId = pDel.id;
      createdProductIds.push(pDel.id);

      // 6. Create Admin Detail Target Product
      const pAdmin = await prisma.product.create({
        data: {
          name: `Admin Target Prod ${runKey}`,
          price: 300.0,
          compareAtPrice: 350.0,
          image: "/images/admin-target.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          subcategory: `Night Care ${runKey}`,
          description: `Admin detailed description ${runKey}`,
          isHotDeal: true,
          isUpcoming: false,
          badgeText: "Admin Choice",
          badgeTone: "festival",
          isActive: true,
          stock: 40,
        },
      });
      pAdminTargetId = pAdmin.id;
      createdProductIds.push(pAdmin.id);

      const vAdminActive = await prisma.productVariant.create({
        data: {
          productId: pAdmin.id,
          label: "Size A Active",
          price: 300.0,
          stock: 25,
          isActive: true,
          sortOrder: 2,
        },
      });
      createdVariantIds.push(vAdminActive.id);

      const vAdminInactive = await prisma.productVariant.create({
        data: {
          productId: pAdmin.id,
          label: "Size B Inactive",
          price: 400.0,
          stock: 15,
          isActive: false,
          sortOrder: 1,
        },
      });
      createdVariantIds.push(vAdminInactive.id);

      // 7. Task 4A Low-Stock Fixtures
      const pLow0 = await prisma.product.create({
        data: {
          name: `LowStock 0 ${runKey}`,
          price: 100.0,
          image: "/images/low0.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isActive: true,
          stock: 0,
        },
      });
      pLowStock0Id = pLow0.id;
      createdProductIds.push(pLow0.id);

      const pLow3 = await prisma.product.create({
        data: {
          name: `LowStock 3 ${runKey}`,
          price: 100.0,
          image: "/images/low3.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isActive: true,
          stock: 3,
        },
      });
      pLowStock3Id = pLow3.id;
      createdProductIds.push(pLow3.id);

      const pStk4 = await prisma.product.create({
        data: {
          name: `Stock 4 ${runKey}`,
          price: 100.0,
          image: "/images/stk4.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isActive: true,
          stock: 4,
        },
      });
      pStock4Id = pStk4.id;
      createdProductIds.push(pStk4.id);

      const pInactStk0 = await prisma.product.create({
        data: {
          name: `Inactive Stock 0 ${runKey}`,
          price: 100.0,
          image: "/images/inact0.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isActive: false,
          stock: 0,
        },
      });
      pInactiveStock0Id = pInactStk0.id;
      createdProductIds.push(pInactStk0.id);

      const pDelStk0 = await prisma.product.create({
        data: {
          name: `Deleted Stock 0 ${runKey}`,
          price: 100.0,
          image: "/images/del0.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isActive: true,
          deletedAt: new Date(),
          stock: 0,
        },
      });
      pDeletedStock0Id = pDelStk0.id;
      createdProductIds.push(pDelStk0.id);

      // 8. Task 4A Admin Filter Fixtures
      const pHot = await prisma.product.create({
        data: {
          name: `Hot Filter Prod ${runKey}`,
          price: 100.0,
          image: "/images/hot.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isHotDeal: true,
          isActive: true,
          stock: 10,
        },
      });
      pHotFilterId = pHot.id;
      createdProductIds.push(pHot.id);

      const pUpc = await prisma.product.create({
        data: {
          name: `Upcoming Filter Prod ${runKey}`,
          price: 100.0,
          image: "/images/upc.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isUpcoming: true,
          isActive: true,
          stock: 10,
        },
      });
      pUpcomingFilterId = pUpc.id;
      createdProductIds.push(pUpc.id);

      const pDisc = await prisma.product.create({
        data: {
          name: `Discount Filter Prod ${runKey}`,
          price: 100.0,
          compareAtPrice: 150.0, // > price
          image: "/images/disc.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isActive: true,
          stock: 10,
        },
      });
      pDiscountFilterId = pDisc.id;
      createdProductIds.push(pDisc.id);

      const pEqPrice = await prisma.product.create({
        data: {
          name: `Equal Price Prod ${runKey}`,
          price: 100.0,
          compareAtPrice: 100.0, // == price (excluded)
          image: "/images/eq.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isActive: true,
          stock: 10,
        },
      });
      pEqualPriceFilterId = pEqPrice.id;
      createdProductIds.push(pEqPrice.id);

      const pBdg = await prisma.product.create({
        data: {
          name: `Badge Filter Prod ${runKey}`,
          price: 100.0,
          badgeText: `Badge ${runKey}`,
          image: "/images/bdg.png",
          category: `API Cat ${runKey}`,
          categoryId: cat.id,
          isActive: true,
          stock: 10,
        },
      });
      pBadgeFilterId = pBdg.id;
      createdProductIds.push(pBdg.id);
    });

    after(async () => {
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
        if (createdCategoryIds.length > 0) {
          await prisma.category.deleteMany({
            where: { id: { in: createdCategoryIds } },
          }).catch(() => {});
        }
        await prisma.$disconnect().catch(() => {});
      }
    });

    // -------------------------------------------------------------------------
    // A. Public API Contracts
    // -------------------------------------------------------------------------
    it("GET /api/products returns canonical public Page-1 paginated envelope and omits legacy products array", async () => {
      const res = await GET(new Request("http://localhost/api/products"));
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(Array.isArray(data.items), "Must return items array");
      assert.strictEqual(data.page, 1);
      assert.strictEqual(data.pageSize, 24);
      assert.strictEqual(typeof data.totalItems, "number");
      assert.strictEqual(typeof data.totalPages, "number");
      assert.strictEqual(typeof data.hasMore, "boolean");
      assert.strictEqual(data.products, undefined, "Must NOT return legacy products array");
    });

    it("GET /api/products?view=public&page=1&pageSize=24 returns canonical public envelope", async () => {
      const res = await GET(
        new Request("http://localhost/api/products?view=public&page=1&pageSize=24")
      );
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(Array.isArray(data.items));
      assert.strictEqual(data.page, 1);
      assert.strictEqual(data.pageSize, 24);
    });

    it("GET /api/products?id=<activeId> returns PublicProductDetailDTO with ACTIVE variants only and omits audit fields", async () => {
      const res = await GET(
        new Request(`http://localhost/api/products?id=${pPublicActiveId}`)
      );
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.product);
      assert.strictEqual(data.product.id, pPublicActiveId);
      assert.strictEqual(data.product.name, `Public Active Prod ${runKey}`);
      assert.strictEqual(typeof data.product.description, "string");
      assert.strictEqual(data.product.hasVariants, true);

      // Active variants only
      assert.strictEqual(data.product.variants.length, 1);
      assert.strictEqual(data.product.variants[0].label, "50ml Active");
      assert.strictEqual(data.product.variants[0].price, 120.0);

      // Audit fields omitted
      const rawProduct = data.product as Record<string, unknown>;
      assert.strictEqual(rawProduct.deletedAt, undefined);
      assert.strictEqual(rawProduct.updatedAt, undefined);
      assert.strictEqual(rawProduct.isActive, undefined);
    });

    it("GET /api/products?id=<inactiveId> returns 404 on public route", async () => {
      const res = await GET(
        new Request(`http://localhost/api/products?id=${pInactiveId}`)
      );
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    it("GET /api/products?id=<deletedId> returns 404 on public route", async () => {
      const res = await GET(
        new Request(`http://localhost/api/products?id=${pDeletedId}`)
      );
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    it("GET /api/products?page=10001 returns 400 INVALID_PAGE", async () => {
      const res = await GET(new Request("http://localhost/api/products?page=10001"));
      assert.strictEqual(res.status, 400);

      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, "INVALID_PAGE");
    });

    it("Public product card projection strictly omits forbidden fields", async () => {
      const res = await GET(
        new Request(`http://localhost/api/products?q=${encodeURIComponent(runKey)}`)
      );
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      const card = data.items.find((i: { id: number }) => i.id === pPublicActiveId);
      assert.ok(card, "Card must exist in public search list");

      const rawCard = card as Record<string, unknown>;
      assert.strictEqual(rawCard.hasVariants, true);
      assert.strictEqual(rawCard.description, undefined);
      assert.strictEqual(rawCard.variants, undefined);
      assert.strictEqual(rawCard.deletedAt, undefined);
      assert.strictEqual(rawCard.updatedAt, undefined);
      assert.strictEqual(rawCard.isActive, undefined);
    });

    // -------------------------------------------------------------------------
    // B. Admin API Contracts & Strict Auth-First Precedence
    // -------------------------------------------------------------------------
    it("Unauthenticated GET /api/products?view=admin&page=1 returns 401", async () => {
      const res = await GET(
        new Request("http://localhost/api/products?view=admin&page=1")
      );
      assert.strictEqual(res.status, 401);

      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    it("Unauthenticated GET /api/products?view=admin&id=<validPublicId> returns 401 (auth-first precedence)", async () => {
      const res = await GET(
        new Request(`http://localhost/api/products?view=admin&id=${pPublicActiveId}`)
      );
      assert.strictEqual(
        res.status,
        401,
        "Admin authentication check must precede detail routing"
      );

      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    it("Authenticated GET /api/products?view=admin&page=1&pageSize=20 returns AdminProductListDTO envelope", async () => {
      const res = await GET(
        new Request(
          `http://localhost/api/products?view=admin&page=1&pageSize=20&q=${encodeURIComponent(runKey)}`,
          {
            headers: { cookie: authCookieHeader },
          }
        )
      );
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(Array.isArray(data.items));

      const adminCard = data.items.find((i: { id: number }) => i.id === pPublicActiveId);
      assert.ok(adminCard, "Admin card must exist in list");
      assert.strictEqual(adminCard.variantCount, 1, "Must count active variants only");
      assert.strictEqual(adminCard.hasVariants, true);

      const rawAdminCard = adminCard as Record<string, unknown>;
      assert.strictEqual(rawAdminCard.variants, undefined, "Admin list must omit variants[]");
      assert.strictEqual(rawAdminCard.description, undefined, "Admin list must omit description");
    });

    it("Authenticated GET /api/products?view=admin&id=<adminTargetId> returns AdminProductDetailDTO with all variants and audit fields", async () => {
      const res = await GET(
        new Request(`http://localhost/api/products?view=admin&id=${pAdminTargetId}`, {
          headers: { cookie: authCookieHeader },
        })
      );
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.product);
      assert.strictEqual(data.product.id, pAdminTargetId);
      assert.strictEqual(data.product.name, `Admin Target Prod ${runKey}`);
      assert.strictEqual(data.product.variants.length, 2, "Must include BOTH active and inactive variants");
      assert.strictEqual(typeof data.product.description, "string");
      assert.strictEqual(typeof data.product.updatedAt, "string");
      assert.strictEqual(typeof data.product.createdAt, "string");
    });

    it("Authenticated GET /api/products?view=admin&page=10001 returns 400 INVALID_PAGE", async () => {
      const res = await GET(
        new Request("http://localhost/api/products?view=admin&page=10001", {
          headers: { cookie: authCookieHeader },
        })
      );
      assert.strictEqual(res.status, 400);

      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, "INVALID_PAGE");
    });

    it("Public cache boundary: public responses receive Cache-Control, admin responses do NOT", async () => {
      // 1. Public list has Cache-Control
      const pubListRes = await GET(new Request("http://localhost/api/products"));
      assert.ok(pubListRes.headers.get("cache-control")?.includes("public"));

      // 2. Public detail has Cache-Control
      const pubDetailRes = await GET(
        new Request(`http://localhost/api/products?id=${pPublicActiveId}`)
      );
      assert.ok(pubDetailRes.headers.get("cache-control")?.includes("public"));

      // 3. Admin list has NO public Cache-Control
      const adminListRes = await GET(
        new Request("http://localhost/api/products?view=admin", {
          headers: { cookie: authCookieHeader },
        })
      );
      assert.ok(!adminListRes.headers.get("cache-control")?.includes("public"));

      // 4. Admin detail has NO public Cache-Control
      const adminDetailRes = await GET(
        new Request(`http://localhost/api/products?view=admin&id=${pAdminTargetId}`, {
          headers: { cookie: authCookieHeader },
        })
      );
      assert.ok(!adminDetailRes.headers.get("cache-control")?.includes("public"));
    });

    // -------------------------------------------------------------------------
    // C. Task 4A Targeted Low-Stock Metric & Validation
    // -------------------------------------------------------------------------
    it("Authenticated GET /api/products?view=admin&metric=low-stock returns 200 with accurate totalItems and no public cache headers", async () => {
      const res = await GET(
        new Request("http://localhost/api/products?view=admin&metric=low-stock", {
          headers: { cookie: authCookieHeader },
        })
      );
      assert.strictEqual(res.status, 200);
      assert.ok(!res.headers.get("cache-control")?.includes("public"), "Metric response must NOT have public cache headers");

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.metric, "low-stock");
      assert.strictEqual(typeof data.totalItems, "number");
      assert.ok(data.totalItems >= 2, "Expected at least pLowStock0 and pLowStock3 to be counted");
      assert.ok(
        pLowStock0Id > 0 &&
          pLowStock3Id > 0 &&
          pStock4Id > 0 &&
          pInactiveStock0Id > 0 &&
          pDeletedStock0Id > 0
      );
    });

    it("Unauthenticated GET /api/products?view=admin&metric=low-stock returns 401", async () => {
      const res = await GET(
        new Request("http://localhost/api/products?view=admin&metric=low-stock")
      );
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    it("Authenticated GET /api/products?view=admin&metric=unknown-metric returns 400", async () => {
      const res = await GET(
        new Request("http://localhost/api/products?view=admin&metric=unknown-metric", {
          headers: { cookie: authCookieHeader },
        })
      );
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.message, "Invalid admin metric.");
    });

    it("Authenticated GET /api/products?view=admin&metric=low-stock&id=123 prioritizes metric mode", async () => {
      const res = await GET(
        new Request(`http://localhost/api/products?view=admin&metric=low-stock&id=${pPublicActiveId}`, {
          headers: { cookie: authCookieHeader },
        })
      );
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.metric, "low-stock");
      assert.strictEqual(typeof data.totalItems, "number");
      assert.strictEqual(data.product, undefined, "Must not return product detail when metric is requested");
    });

    // -------------------------------------------------------------------------
    // D. Task 4A View=Full Privileged Alias Security & Detail Semantics
    // -------------------------------------------------------------------------
    it("Unauthenticated GET /api/products?view=full&page=1 returns 401", async () => {
      const res = await GET(
        new Request("http://localhost/api/products?view=full&page=1")
      );
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    it("Unauthenticated GET /api/products?view=full&id=<validPublicId> returns 401 (auth-first precedence)", async () => {
      const res = await GET(
        new Request(`http://localhost/api/products?view=full&id=${pPublicActiveId}`)
      );
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    it("Authenticated GET /api/products?view=full&id=<adminTargetId> returns AdminProductDetailDTO semantics", async () => {
      const res = await GET(
        new Request(`http://localhost/api/products?view=full&id=${pAdminTargetId}`, {
          headers: { cookie: authCookieHeader },
        })
      );
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.product);
      assert.strictEqual(data.product.id, pAdminTargetId);
      assert.strictEqual(data.product.variants.length, 2);
    });

    // -------------------------------------------------------------------------
    // E. Task 4A API-Level Admin Filter Route Wires Correctly
    // -------------------------------------------------------------------------
    it("Authenticated GET /api/products?view=admin&filter=hot includes hot fixture", async () => {
      const res = await GET(
        new Request(
          `http://localhost/api/products?view=admin&filter=hot&q=${encodeURIComponent(runKey)}`,
          {
            headers: { cookie: authCookieHeader },
          }
        )
      );
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const ids = data.items.map((i: { id: number }) => i.id);
      assert.ok(ids.includes(pHotFilterId), "Must include hot deal product");
      assert.ok(!ids.includes(pUpcomingFilterId), "Must not include upcoming product");
    });

    it("Authenticated GET /api/products?view=admin&filter=upcoming includes upcoming fixture", async () => {
      const res = await GET(
        new Request(
          `http://localhost/api/products?view=admin&filter=upcoming&q=${encodeURIComponent(runKey)}`,
          {
            headers: { cookie: authCookieHeader },
          }
        )
      );
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const ids = data.items.map((i: { id: number }) => i.id);
      assert.ok(ids.includes(pUpcomingFilterId), "Must include upcoming product");
      assert.ok(!ids.includes(pHotFilterId), "Must not include hot deal product");
    });

    it("Authenticated GET /api/products?view=admin&filter=discount matches compareAtPrice > price and excludes compareAtPrice == price", async () => {
      const res = await GET(
        new Request(
          `http://localhost/api/products?view=admin&filter=discount&q=${encodeURIComponent(runKey)}`,
          {
            headers: { cookie: authCookieHeader },
          }
        )
      );
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const ids = data.items.map((i: { id: number }) => i.id);
      assert.ok(ids.includes(pDiscountFilterId), "Must include compareAtPrice > price product");
      assert.ok(!ids.includes(pEqualPriceFilterId), "Must EXCLUDE compareAtPrice == price product");
    });

    it("Authenticated GET /api/products?view=admin&filter=badge includes badge fixture", async () => {
      const res = await GET(
        new Request(
          `http://localhost/api/products?view=admin&filter=badge&q=${encodeURIComponent(runKey)}`,
          {
            headers: { cookie: authCookieHeader },
          }
        )
      );
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const ids = data.items.map((i: { id: number }) => i.id);
      assert.ok(ids.includes(pBadgeFilterId), "Must include custom badge product");
    });

    // -------------------------------------------------------------------------
    // F. Task 4A Consumer Migration Structural Guards
    // -------------------------------------------------------------------------
    it("app/admin/products/page.tsx requests view=admin with server pagination, on-demand detail edit, and fail-closed error handling", () => {
      const content = fs.readFileSync(
        path.join(process.cwd(), "app/admin/products/page.tsx"),
        "utf8"
      );
      assert.ok(
        content.includes("/api/products?") && content.includes("view=admin"),
        "Admin products page must request view=admin"
      );
      assert.ok(
        content.includes("view=admin&id=") || content.includes('view=admin&id=${'),
        "Admin products page must request on-demand detail for edit via view=admin&id="
      );
      assert.ok(
        !content.includes("setProducts(data.products)") && content.includes("data.items"),
        "Admin products page must consume data.items, not legacy data.products"
      );
      // Fail-closed inline edit: NO fallback to list DTO `product`
      assert.ok(
        !content.includes(": product;") && !content.includes("? data.product : product"),
        "startEdit must NOT fall back to incomplete list DTO on detail fetch error"
      );
      // Relational category authority
      assert.ok(
        content.includes("c.id === detail.categoryId") || content.includes("c.id === (detail.categoryId"),
        "startEdit must use relational categoryId as primary authority"
      );
    });

    it("app/admin/products/[id]/edit/page.tsx requests view=admin&id=", () => {
      const content = fs.readFileSync(
        path.join(process.cwd(), "app/admin/products/[id]/edit/page.tsx"),
        "utf8"
      );
      assert.ok(
        content.includes("/api/products?view=admin&id="),
        "Admin edit page must request view=admin&id="
      );
    });

    it("app/admin/page.tsx consumes totalItems from bounded requests, fetches metric=low-stock, and does not hardcode lowStock: 0", () => {
      const content = fs.readFileSync(
        path.join(process.cwd(), "app/admin/page.tsx"),
        "utf8"
      );
      assert.ok(
        content.includes("metric=low-stock"),
        "Admin dashboard must request metric=low-stock"
      );
      assert.ok(
        !content.includes("lowStock: 0"),
        "Admin dashboard must NOT have hardcoded lowStock: 0"
      );
      assert.ok(
        content.includes("totalItems"),
        "Admin dashboard must consume totalItems for accurate catalog metrics"
      );
    });

    it("components/home/CategorySection.tsx extracts products from data.items without legacy .products fallback", () => {
      const content = fs.readFileSync(
        path.join(process.cwd(), "components/home/CategorySection.tsx"),
        "utf8"
      );
      assert.ok(
        content.includes("data?.items") || content.includes("data.items"),
        "CategorySection fallback must extract products from data.items"
      );
      assert.ok(
        !content.includes("data?.items || productPayload?.data?.products") &&
          !content.includes("data.items || data.products"),
        "CategorySection must NOT have legacy .products fallback"
      );
    });

    it("components/home/HomePromoGrid.tsx extracts products from data.items without legacy .products fallback", () => {
      const content = fs.readFileSync(
        path.join(process.cwd(), "components/home/HomePromoGrid.tsx"),
        "utf8"
      );
      assert.ok(
        content.includes("productData?.items") ||
          content.includes("data?.items") ||
          content.includes("data.items"),
        "HomePromoGrid fallback must extract products from data.items"
      );
      assert.ok(
        !content.includes("productData?.items || productData?.products") &&
          !content.includes("data.items || data.products"),
        "HomePromoGrid must NOT have legacy .products fallback"
      );
    });

    it("components/shop/ShopProductGridClient.tsx consumes items and hasMore without legacy .products fallback", () => {
      const content = fs.readFileSync(
        path.join(process.cwd(), "components/shop/ShopProductGridClient.tsx"),
        "utf8"
      );
      assert.ok(
        content.includes("data.items"),
        "ShopProductGridClient must consume data.items"
      );
      assert.ok(
        content.includes("data.hasMore"),
        "ShopProductGridClient must consume data.hasMore"
      );
      assert.ok(
        !content.includes("data.items || data.products"),
        "ShopProductGridClient must NOT have legacy .products fallback"
      );
    });
  }
);
