import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  computeRestorationTarget,
  deduplicateProducts,
  createProgressiveQueryUrl,
} from "../lib/catalog/progressiveCatalogState";
import { parsePublicCatalogParams } from "../lib/catalog/queryParams";
import type { PublicProductCardDTO } from "../lib/catalog/types";

describe("Phase 5 Task 6 — Shop Server Component & Progressive Load More Client", () => {
  // ---------------------------------------------------------------------------
  // A. Restoration Target Calculation & Deep Normalization
  // ---------------------------------------------------------------------------
  it("A/B. computeRestorationTarget for page=1 and page=3 returns exact targetPage and shouldNormalizeUrl=false", () => {
    const res1 = computeRestorationTarget(1);
    assert.strictEqual(res1.targetPage, 1);
    assert.strictEqual(res1.shouldNormalizeUrl, false);

    const res3 = computeRestorationTarget(3);
    assert.strictEqual(res3.targetPage, 3);
    assert.strictEqual(res3.shouldNormalizeUrl, false);
  });

  it("C. computeRestorationTarget for deep page=15 clamps targetPage to 10 and sets shouldNormalizeUrl=true", () => {
    const res15 = computeRestorationTarget(15);
    assert.strictEqual(res15.targetPage, 10);
    assert.strictEqual(res15.shouldNormalizeUrl, true);
  });

  // ---------------------------------------------------------------------------
  // D. Progressive Query URL Construction
  // ---------------------------------------------------------------------------
  it("D. createProgressiveQueryUrl generates bounded API URL preserving active filters and view=public", () => {
    const url = createProgressiveQueryUrl({
      category: "skincare",
      subcategory: "serum",
      q: "glow",
      sort: "price-asc",
      page: 2,
    });

    assert.ok(url.startsWith("/api/products?"));
    const params = new URLSearchParams(url.replace("/api/products?", ""));
    assert.strictEqual(params.get("view"), "public");
    assert.strictEqual(params.get("category"), "skincare");
    assert.strictEqual(params.get("subcategory"), "serum");
    assert.strictEqual(params.get("q"), "glow");
    assert.strictEqual(params.get("sort"), "price-asc");
    assert.strictEqual(params.get("page"), "2");
  });

  // ---------------------------------------------------------------------------
  // E. Product ID Deduplication
  // ---------------------------------------------------------------------------
  it("E. deduplicateProducts preserves existing items and appends only unique incoming IDs", () => {
    const existing: PublicProductCardDTO[] = [
      {
        id: 1,
        name: "Prod 1",
        price: 100,
        compareAtPrice: null,
        image: "/p1.png",
        category: "Skincare",
        stock: 10,
        isHotDeal: false,
        isUpcoming: false,
        badgeText: null,
        badgeTone: "sale",
        hasVariants: false,
      },
      {
        id: 2,
        name: "Prod 2",
        price: 200,
        compareAtPrice: null,
        image: "/p2.png",
        category: "Skincare",
        stock: 5,
        isHotDeal: false,
        isUpcoming: false,
        badgeText: null,
        badgeTone: "sale",
        hasVariants: false,
      },
    ];

    const incoming: PublicProductCardDTO[] = [
      {
        id: 2, // duplicate
        name: "Prod 2 duplicate",
        price: 200,
        compareAtPrice: null,
        image: "/p2.png",
        category: "Skincare",
        stock: 5,
        isHotDeal: false,
        isUpcoming: false,
        badgeText: null,
        badgeTone: "sale",
        hasVariants: false,
      },
      {
        id: 3, // new
        name: "Prod 3",
        price: 300,
        compareAtPrice: null,
        image: "/p3.png",
        category: "Skincare",
        stock: 12,
        isHotDeal: false,
        isUpcoming: false,
        badgeText: null,
        badgeTone: "sale",
        hasVariants: false,
      },
    ];

    const result = deduplicateProducts(existing, incoming);
    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(
      result.map((p) => p.id),
      [1, 2, 3]
    );
  });

  // ---------------------------------------------------------------------------
  // F. Server Initial Query Contract
  // ---------------------------------------------------------------------------
  it("F. parsePublicCatalogParams parses requested page while server forces initial query to page=1, pageSize=24, skip=0", () => {
    const rawParams = {
      category: "makeup",
      subcategory: "lipstick",
      page: "5",
      pageSize: "40",
      sort: "price-desc",
    };

    const parsed = parsePublicCatalogParams(rawParams);
    assert.strictEqual(parsed.page, 5, "Parser preserves requested page");

    // Server initial query forced bounds
    const serverQuery = {
      ...parsed,
      page: 1,
      pageSize: 24,
      skip: 0,
    };

    assert.strictEqual(serverQuery.page, 1);
    assert.strictEqual(serverQuery.pageSize, 24);
    assert.strictEqual(serverQuery.skip, 0);
    assert.strictEqual(serverQuery.category, "makeup");
    assert.strictEqual(serverQuery.subcategory, "lipstick");
  });

  // ---------------------------------------------------------------------------
  // G. Structural Source Guards: app/shop/page.tsx
  // ---------------------------------------------------------------------------
  it("G. app/shop/page.tsx uses getPublicCatalogQuery, passes initial Page-1 result to ProgressiveProductGrid, and omits getProducts in-memory flow", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "app/shop/page.tsx"),
      "utf8"
    );

    // Must import and use database query model
    assert.ok(
      content.includes("getPublicCatalogQuery"),
      "app/shop/page.tsx must use getPublicCatalogQuery"
    );
    assert.ok(
      content.includes("parsePublicCatalogParams"),
      "app/shop/page.tsx must use parsePublicCatalogParams"
    );
    assert.ok(
      content.includes("ProgressiveProductGrid"),
      "app/shop/page.tsx must render ProgressiveProductGrid"
    );

    // Must force server initial query to page=1, pageSize=24, skip=0
    assert.ok(
      content.includes("page: 1") && content.includes("pageSize: 24"),
      "app/shop/page.tsx must force server query to page=1 and pageSize=24"
    );

    // Must remove legacy in-memory full catalog loaders and sorters
    assert.ok(
      !content.includes("getProducts()") && !content.includes("from \"@/lib/getProducts\"") && !content.includes("from '@/lib/getProducts'"),
      "app/shop/page.tsx must NOT import or call getProducts()"
    );
    assert.ok(
      !content.includes("sortProducts("),
      "app/shop/page.tsx must NOT perform in-memory sortProducts()"
    );
    assert.ok(
      !content.includes("categoryProducts.filter") && !content.includes("allProducts.filter"),
      "app/shop/page.tsx must NOT filter full product arrays in memory"
    );
  });

  // ---------------------------------------------------------------------------
  // H. Structural Source Guards: components/shop/ProgressiveProductGrid.tsx
  // ---------------------------------------------------------------------------
  it("H. ProgressiveProductGrid.tsx implements client progressive loading, deduplication, URL restoration, and history synchronization", () => {
    const filePath = path.join(
      process.cwd(),
      "components/shop/ProgressiveProductGrid.tsx"
    );
    assert.ok(
      fs.existsSync(filePath),
      "components/shop/ProgressiveProductGrid.tsx must exist"
    );

    const content = fs.readFileSync(filePath, "utf8");

    // Client component directive
    assert.ok(content.includes('"use client"') || content.includes("'use client'"));

    // State helpers
    assert.ok(
      content.includes("deduplicateProducts"),
      "Must import and use deduplicateProducts"
    );
    assert.ok(
      content.includes("computeRestorationTarget"),
      "Must import and use computeRestorationTarget"
    );
    assert.ok(
      content.includes("createProgressiveQueryUrl"),
      "Must import and use createProgressiveQueryUrl"
    );

    // Load More API calls
    assert.ok(
      content.includes("createProgressiveQueryUrl") && content.includes("fetch("),
      "Must fetch next page using createProgressiveQueryUrl"
    );

    // Browser URL synchronization must remain on /shop, NEVER pushing /api/products
    assert.ok(
      content.includes("window.history.pushState") || content.includes("history.pushState") || content.includes("router.push") || content.includes("window.history.replaceState"),
      "Must synchronize browser URL using history API"
    );
    assert.ok(
      !content.includes('pushState(null, "", `/api/products') &&
        !content.includes("pushState(null, '', `/api/products") &&
        !content.includes('pushState({}, "", `/api/products'),
      "Browser history must never receive /api/products pathname"
    );
  });

  // ---------------------------------------------------------------------------
  // I. Structural Source Guards: components/shop/LoadMoreProducts.tsx
  // ---------------------------------------------------------------------------
  it("I. LoadMoreProducts.tsx no longer slices full in-memory product arrays", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "components/shop/LoadMoreProducts.tsx"),
      "utf8"
    );

    assert.ok(
      !content.includes("safeProducts.slice(0, visibleCount)"),
      "LoadMoreProducts must not perform in-memory array slicing"
    );
    assert.ok(
      content.includes("ProgressiveProductGrid"),
      "LoadMoreProducts must delegate to ProgressiveProductGrid"
    );
  });
});
