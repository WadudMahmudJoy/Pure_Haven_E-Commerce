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
  createInitialProgressiveGridState,
  applyProgressivePageSuccess,
  applyProgressivePageFailure,
  type ProgressiveGridState,
} from "../components/shop/progressiveProductGridState";

describe("Phase 5 Task 6 / 6B — Shop Server Component & Progressive Load More Client", () => {
  // ---------------------------------------------------------------------------
  // 1. Collision-Safe Query Identity
  // ---------------------------------------------------------------------------
  it("1. createProgressiveQueryIdentity prevents delimiter collision between overlapping category and subcategory strings", () => {
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
  // 2. Canonical /shop History URL Construction
  // ---------------------------------------------------------------------------
  it("2. createShopHistoryUrl constructs canonical Page-1 and Page-N URLs strictly on /shop and never /api/products", () => {
    // Page 1 canonicalization omits page=1 and sort=latest
    const urlPage1 = createShopHistoryUrl({
      category: "skincare",
      sort: "latest",
      page: 1,
    });
    assert.strictEqual(urlPage1, "/shop?category=skincare");

    // Page N preserves active filters and appends page=N
    const urlPage3 = createShopHistoryUrl({
      category: "skincare",
      subcategory: "serum",
      q: "glow",
      sort: "price-asc",
      page: 3,
    });
    assert.strictEqual(
      urlPage3,
      "/shop?category=skincare&subcategory=serum&q=glow&sort=price-asc&page=3"
    );
    assert.ok(!urlPage3.includes("/api/products"));
  });

  // ---------------------------------------------------------------------------
  // 3. Direct Raw API URL & Explicit pageSize=24 Assertion
  // ---------------------------------------------------------------------------
  it("3. createProgressiveQueryUrl generates raw URL containing view=public, explicit pageSize=24, and active filters", () => {
    const url = createProgressiveQueryUrl({
      category: "skincare",
      subcategory: "serum",
      q: "glow",
      sort: "price-asc",
      page: 2,
    });

    assert.ok(url.startsWith("/api/products?"));
    const query = url.split("?")[1] ?? "";
    const params = new URLSearchParams(query);

    assert.strictEqual(params.get("view"), "public");
    assert.strictEqual(params.get("pageSize"), "24", "Raw request URL must explicitly include pageSize=24");
    assert.strictEqual(params.get("category"), "skincare");
    assert.strictEqual(params.get("subcategory"), "serum");
    assert.strictEqual(params.get("q"), "glow");
    assert.strictEqual(params.get("sort"), "price-asc");
    assert.strictEqual(params.get("page"), "2");
  });

  // ---------------------------------------------------------------------------
  // 4. Initial State & Pure Transition Reducers
  // ---------------------------------------------------------------------------
  it("4. createInitialProgressiveGridState builds authoritative Page-1 state", () => {
    const initialCards: PublicProductCardDTO[] = [
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
    ];

    const state = createInitialProgressiveGridState({
      initialProducts: initialCards,
      initialHasMore: true,
      initialTotalItems: 48,
    });

    assert.strictEqual(state.products.length, 1);
    assert.strictEqual(state.currentPage, 1);
    assert.strictEqual(state.hasMore, true);
    assert.strictEqual(state.totalItems, 48);
    assert.strictEqual(state.loading, false);
    assert.strictEqual(state.error, null);
  });

  it("5. applyProgressivePageSuccess merges deduplicated items, updates page, and clears error/loading", () => {
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

  it("6. applyProgressivePageFailure retains previous products and currentPage while setting error and clearing loading", () => {
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
  // 5. Zero-Success & Partial Restoration State Transitions
  // ---------------------------------------------------------------------------
  it("7. Zero-success restoration failure retains Page 1 and does not claim Page 2 or Page 3", () => {
    const initial = createInitialProgressiveGridState({
      initialProducts: [
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
      initialHasMore: true,
      initialTotalItems: 72,
    });

    // Page 2 fails immediately
    const failedState = applyProgressivePageFailure(
      initial,
      "Failed to restore page 2"
    );

    assert.strictEqual(failedState.currentPage, 1);
    assert.strictEqual(failedState.products.length, 1);
    assert.strictEqual(failedState.hasMore, true);
    assert.strictEqual(failedState.error, "Failed to restore page 2");
  });

  it("8. Partial restoration (Page 2 success + Page 3 failure) retains Page 2 state and enables manual retry for Page 3", () => {
    const initial = createInitialProgressiveGridState({
      initialProducts: [
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
      initialHasMore: true,
      initialTotalItems: 72,
    });

    // Page 2 succeeds
    const page2State = applyProgressivePageSuccess(
      initial,
      [
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
      ],
      2,
      true,
      72
    );

    assert.strictEqual(page2State.currentPage, 2);
    assert.strictEqual(page2State.products.length, 2);

    // Page 3 fails
    const page3FailedState = applyProgressivePageFailure(
      page2State,
      "Failed to restore page 3"
    );

    assert.strictEqual(page3FailedState.currentPage, 2, "Must remain on Page 2");
    assert.strictEqual(page3FailedState.products.length, 2);
    assert.strictEqual(page3FailedState.error, "Failed to restore page 3");

    // Retry from Page 2 requests Page 3: next page is page3FailedState.currentPage + 1 = 3
    const retryNextPage = page3FailedState.currentPage + 1;
    assert.strictEqual(retryNextPage, 3, "Next manual Load More retry must target Page 3");
  });

  it("9. Early hasMore=false during restoration stops at returned page without requesting later pages", () => {
    const initial = createInitialProgressiveGridState({
      initialProducts: [
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
      initialHasMore: true,
      initialTotalItems: 28,
    });

    // Requested target was 10, but Page 2 returns hasMore=false
    const finalExhaustedState = applyProgressivePageSuccess(
      initial,
      [
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
      ],
      2,
      false, // hasMore = false
      28
    );

    assert.strictEqual(finalExhaustedState.currentPage, 2);
    assert.strictEqual(finalExhaustedState.hasMore, false);
    assert.strictEqual(finalExhaustedState.products.length, 2);
  });

  // ---------------------------------------------------------------------------
  // 6. Restoration Target Clamping & Normalization
  // ---------------------------------------------------------------------------
  it("10. computeRestorationTarget for page=15 clamps targetPage to 10 and sets shouldNormalizeUrl=true", () => {
    const res15 = computeRestorationTarget(15);
    assert.strictEqual(res15.targetPage, 10);
    assert.strictEqual(res15.shouldNormalizeUrl, true);
  });

  // ---------------------------------------------------------------------------
  // 7. Product ID Deduplication
  // ---------------------------------------------------------------------------
  it("11. deduplicateProducts preserves existing items and appends only unique incoming IDs", () => {
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
    ];

    const incoming: PublicProductCardDTO[] = [
      {
        id: 1, // duplicate
        name: "Prod 1 dup",
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
        id: 2, // new
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

    const result = deduplicateProducts(existing, incoming);
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(
      result.map((p) => p.id),
      [1, 2]
    );
  });

  // ---------------------------------------------------------------------------
  // 8. Server Initial Query Contract
  // ---------------------------------------------------------------------------
  it("12. parsePublicCatalogParams parses requested page while server forces initial query to page=1, pageSize=24, skip=0", () => {
    const rawParams = {
      category: "makeup",
      subcategory: "lipstick",
      page: "5",
      pageSize: "40",
      sort: "price-desc",
    };

    const parsed = parsePublicCatalogParams(rawParams);
    assert.strictEqual(parsed.page, 5, "Parser preserves requested page");

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
  // 9. Structural Source Guards: app/shop/page.tsx
  // ---------------------------------------------------------------------------
  it("13. app/shop/page.tsx uses getPublicCatalogQuery, collision-safe queryKey, and omits getProducts in-memory flow", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "app/shop/page.tsx"),
      "utf8"
    );

    assert.ok(content.includes("getPublicCatalogQuery"), "app/shop/page.tsx must use getPublicCatalogQuery");
    assert.ok(content.includes("parsePublicCatalogParams"), "app/shop/page.tsx must use parsePublicCatalogParams");
    assert.ok(content.includes("ProgressiveProductGrid"), "app/shop/page.tsx must render ProgressiveProductGrid");
    assert.ok(content.includes("createProgressiveQueryIdentity"), "app/shop/page.tsx must use createProgressiveQueryIdentity");

    assert.ok(
      content.includes("page: 1") && content.includes("pageSize: 24"),
      "app/shop/page.tsx must force server query to page=1 and pageSize=24"
    );

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
  // 10. Structural Source Guards: components/shop/ProgressiveProductGrid.tsx
  // ---------------------------------------------------------------------------
  it("14. ProgressiveProductGrid.tsx implements explicit identity effect, unmount cleanup, truthful Page-1 start, and no render-time setState", () => {
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
    assert.ok(content.includes("computeRestorationTarget"), "Must import and use computeRestorationTarget");
    assert.ok(content.includes("createProgressiveQueryUrl"), "Must import and use createProgressiveQueryUrl");
    assert.ok(content.includes("createShopHistoryUrl"), "Must import and use createShopHistoryUrl");
    assert.ok(content.includes("createProgressiveQueryIdentity"), "Must import and use createProgressiveQueryIdentity");
    assert.ok(content.includes("applyProgressivePageSuccess"), "Must import and use applyProgressivePageSuccess");
    assert.ok(content.includes("applyProgressivePageFailure"), "Must import and use applyProgressivePageFailure");
    assert.ok(content.includes("createInitialProgressiveGridState"), "Must import and use createInitialProgressiveGridState");

    // MUST NOT have conditional setState during render
    assert.ok(
      !content.includes("if (prevIdentity !== currentIdentity)") &&
        !content.includes("setPrevIdentity("),
      "Must NOT perform conditional setState during render"
    );

    // Identity lifecycle effect must abort controller and invalidate generation
    assert.ok(
      content.includes("identityRef.current !== currentIdentity") ||
        content.includes("identityRef.current = currentIdentity"),
      "Must track authoritative identity in ref"
    );

    // Dedicated unmount cleanup
    assert.ok(
      content.includes("abortControllerRef.current?.abort()"),
      "Must abort active controller on cleanup"
    );

    // Restoration starts with canonical Page-1 replaceState before fetching Page 2
    assert.ok(
      content.includes("page: 1") && content.includes("window.history.replaceState"),
      "Restoration must canonicalize URL to Page 1 before fetching subsequent pages"
    );

    // Restoration uses replaceState, Load More uses pushState
    assert.ok(content.includes("window.history.replaceState"), "Restoration must use replaceState");
    assert.ok(content.includes("window.history.pushState"), "Load More must use pushState");

    // Browser history must never receive /api/products pathname
    assert.ok(
      !content.includes('pushState(null, "", `/api/products') &&
        !content.includes("pushState(null, '', `/api/products") &&
        !content.includes('replaceState(null, "", `/api/products'),
      "Browser history must never receive /api/products pathname"
    );
  });
});
