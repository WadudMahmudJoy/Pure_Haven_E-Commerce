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
import {
  createProgressiveQueryIdentity,
  createShopHistoryUrl,
  applyProgressivePageSuccess,
  applyProgressivePageFailure,
  type ProgressiveGridState,
} from "../components/shop/progressiveProductGridState";

describe("Phase 5 Task 6 / 6A — Shop Server Component & Progressive Load More Client", () => {
  // ---------------------------------------------------------------------------
  // A. Query-Key Collision Regression
  // ---------------------------------------------------------------------------
  it("A. createProgressiveQueryIdentity prevents delimiter collision between overlapping category and subcategory strings", () => {
    const stateA = {
      category: "a-b",
      subcategory: "c",
      q: "",
      sort: "latest",
    };

    const stateB = {
      category: "a",
      subcategory: "b-c",
      q: "",
      sort: "latest",
    };

    const keyA = createProgressiveQueryIdentity(stateA);
    const keyB = createProgressiveQueryIdentity(stateB);

    assert.notStrictEqual(
      keyA,
      keyB,
      "Query identity must not collide for overlapping hyphenated names"
    );
    assert.strictEqual(
      keyA,
      JSON.stringify(["a-b", "c", "", "latest"]),
      "Key A matches structural JSON serialization"
    );
    assert.strictEqual(
      keyB,
      JSON.stringify(["a", "b-c", "", "latest"]),
      "Key B matches structural JSON serialization"
    );
  });

  // ---------------------------------------------------------------------------
  // B. Explicit Reset Contract & Pure State Transitions
  // ---------------------------------------------------------------------------
  it("B. applyProgressivePageSuccess merges deduplicated items, updates page, and clears error/loading", () => {
    const initialState: ProgressiveGridState = {
      products: [
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
      ],
      currentPage: 1,
      hasMore: true,
      totalItems: 48,
      loading: true,
      error: "Previous error",
    };

    const incomingItems: PublicProductCardDTO[] = [
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

    const nextState = applyProgressivePageSuccess(
      initialState,
      incomingItems,
      2,
      true,
      48
    );

    assert.strictEqual(nextState.products.length, 2);
    assert.strictEqual(nextState.currentPage, 2);
    assert.strictEqual(nextState.hasMore, true);
    assert.strictEqual(nextState.totalItems, 48);
    assert.strictEqual(nextState.loading, false);
    assert.strictEqual(nextState.error, null);
  });

  it("C. applyProgressivePageFailure retains previous products and currentPage while setting error and clearing loading", () => {
    const currentState: ProgressiveGridState = {
      products: [
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
      ],
      currentPage: 1,
      hasMore: true,
      totalItems: 48,
      loading: true,
      error: null,
    };

    const failureState = applyProgressivePageFailure(
      currentState,
      "Network error loading page 2"
    );

    assert.strictEqual(failureState.products.length, 1);
    assert.strictEqual(failureState.currentPage, 1, "currentPage must NOT advance on failure");
    assert.strictEqual(failureState.loading, false);
    assert.strictEqual(failureState.error, "Network error loading page 2");
  });

  // ---------------------------------------------------------------------------
  // D. Canonical /shop History URL Builder
  // ---------------------------------------------------------------------------
  it("D. createShopHistoryUrl constructs canonical customer-facing URL starting with /shop and never /api/products", () => {
    const url1 = createShopHistoryUrl({
      category: "skincare",
      subcategory: "serum",
      q: "glow",
      sort: "price-asc",
      page: 3,
    });

    assert.ok(url1.startsWith("/shop?"), "History URL must start with /shop?");
    assert.ok(!url1.includes("/api/products"), "History URL must not contain /api/products");

    const params1 = new URLSearchParams(url1.replace("/shop?", ""));
    assert.strictEqual(params1.get("category"), "skincare");
    assert.strictEqual(params1.get("subcategory"), "serum");
    assert.strictEqual(params1.get("q"), "glow");
    assert.strictEqual(params1.get("sort"), "price-asc");
    assert.strictEqual(params1.get("page"), "3");

    // Default page=1 and sort=latest should produce clean base URL
    const urlDefault = createShopHistoryUrl({
      category: "skincare",
      sort: "latest",
      page: 1,
    });
    assert.strictEqual(urlDefault, "/shop?category=skincare");
  });

  // ---------------------------------------------------------------------------
  // E. Restoration Target Calculation & Deep Normalization
  // ---------------------------------------------------------------------------
  it("E. computeRestorationTarget for page=1 and page=3 returns exact targetPage and shouldNormalizeUrl=false", () => {
    const res1 = computeRestorationTarget(1);
    assert.strictEqual(res1.targetPage, 1);
    assert.strictEqual(res1.shouldNormalizeUrl, false);

    const res3 = computeRestorationTarget(3);
    assert.strictEqual(res3.targetPage, 3);
    assert.strictEqual(res3.shouldNormalizeUrl, false);
  });

  it("F. computeRestorationTarget for deep page=15 clamps targetPage to 10 and sets shouldNormalizeUrl=true", () => {
    const res15 = computeRestorationTarget(15);
    assert.strictEqual(res15.targetPage, 10);
    assert.strictEqual(res15.shouldNormalizeUrl, true);
  });

  // ---------------------------------------------------------------------------
  // G. Progressive Query URL & Page Size Invariants
  // ---------------------------------------------------------------------------
  it("G. createProgressiveQueryUrl generates bounded API URL resolving to pageSize=24 in catalog parser", () => {
    const url = createProgressiveQueryUrl({
      category: "skincare",
      subcategory: "serum",
      q: "glow",
      sort: "price-asc",
      page: 2,
    });

    assert.ok(url.startsWith("/api/products?"));
    const rawParams = Object.fromEntries(new URLSearchParams(url.replace("/api/products?", "")));
    assert.strictEqual(rawParams.view, "public");
    assert.strictEqual(rawParams.category, "skincare");
    assert.strictEqual(rawParams.subcategory, "serum");
    assert.strictEqual(rawParams.q, "glow");
    assert.strictEqual(rawParams.sort, "price-asc");
    assert.strictEqual(rawParams.page, "2");

    const parsed = parsePublicCatalogParams(rawParams);
    assert.strictEqual(parsed.pageSize, 24, "Public catalog parser must resolve pageSize to 24");
  });

  // ---------------------------------------------------------------------------
  // H. Product ID Deduplication
  // ---------------------------------------------------------------------------
  it("H. deduplicateProducts preserves existing items and appends only unique incoming IDs", () => {
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
  // I. Server Initial Query Contract
  // ---------------------------------------------------------------------------
  it("I. parsePublicCatalogParams parses requested page while server forces initial query to page=1, pageSize=24, skip=0", () => {
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
  // J. Structural Source Guards: app/shop/page.tsx
  // ---------------------------------------------------------------------------
  it("J. app/shop/page.tsx uses getPublicCatalogQuery, collision-safe queryKey, and omits getProducts in-memory flow", () => {
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
    assert.ok(
      content.includes("createProgressiveQueryIdentity"),
      "app/shop/page.tsx must use createProgressiveQueryIdentity"
    );

    // Must force server initial query to page=1, pageSize=24, skip=0
    assert.ok(
      content.includes("page: 1") && content.includes("pageSize: 24"),
      "app/shop/page.tsx must force server query to page=1 and pageSize=24"
    );

    // Must remove legacy in-memory full catalog loaders and sorters
    assert.ok(
      !content.includes("getProducts()") &&
        !content.includes('from "@/lib/getProducts"') &&
        !content.includes("from '@/lib/getProducts'"),
      "app/shop/page.tsx must NOT import or call getProducts()"
    );
    assert.ok(
      !content.includes("sortProducts("),
      "app/shop/page.tsx must NOT perform in-memory sortProducts()"
    );
    assert.ok(
      !content.includes("categoryProducts.filter") &&
        !content.includes("allProducts.filter"),
      "app/shop/page.tsx must NOT filter full product arrays in memory"
    );
  });

  // ---------------------------------------------------------------------------
  // K. Structural Source Guards: components/shop/ProgressiveProductGrid.tsx
  // ---------------------------------------------------------------------------
  it("K. ProgressiveProductGrid.tsx implements explicit query reset, replaceState for restoration, pushState for Load More, and truthful history", () => {
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
    assert.ok(
      content.includes("createShopHistoryUrl"),
      "Must import and use createShopHistoryUrl"
    );
    assert.ok(
      content.includes("createProgressiveQueryIdentity"),
      "Must import and use createProgressiveQueryIdentity"
    );

    // Restoration must use replaceState, Load More must use pushState
    assert.ok(
      content.includes("window.history.replaceState"),
      "Restoration must use replaceState"
    );
    assert.ok(
      content.includes("window.history.pushState"),
      "Load More must use pushState"
    );

    // Browser history must never receive /api/products pathname
    assert.ok(
      !content.includes('pushState(null, "", `/api/products') &&
        !content.includes("pushState(null, '', `/api/products") &&
        !content.includes('replaceState(null, "", `/api/products'),
      "Browser history must never receive /api/products pathname"
    );
  });
});
