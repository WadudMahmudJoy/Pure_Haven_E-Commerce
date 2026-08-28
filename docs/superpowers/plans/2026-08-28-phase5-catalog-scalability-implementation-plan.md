# Phase 5 Catalog Scalability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved bounded, server-authoritative Phase-5 catalog architecture without changing the Phase-1–4 commerce, security, inventory, or relational invariants.

**Architecture:** Replace unpaginated full-table scans with server-authoritative bounded pagination, relational category slug resolution, dual-format scoped subcategory matching (slug and display name), deterministic sorting, and minimal DTO projections across public and admin catalog subsystems. Implement progressive client-side chunk loading (+24 items) with pure-state URL synchronization, request-race safety, a cold-reload restoration safety cap (`MAX_RESTORABLE_PUBLIC_PAGE = 10`), a single-batch subcategory representative image query joining active subcategories, and an evidence-gated PostgreSQL composite index strategy. Preserve PostgreSQL Decimal precision and checkout independence.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Prisma 7, PostgreSQL/Neon, Node.js native test runner (`tsx --test`), Chrome DevTools MCP.

**Spec:** [`docs/superpowers/specs/2026-08-28-phase5-catalog-scalability-design.md`](file:///e:/Joy/pure-haven-bd-joy/pure-haven-bd/docs/superpowers/specs/2026-08-28-phase5-catalog-scalability-design.md)

---

## Global Constraints & Locked Boundaries

1. **Public Catalog Chunking (D1)**: Initial load renders 24 products; clicking "Load More" requests the next 24 products (+24). Hard server cap of `pageSize = 48`. No endless/uncontrolled infinite scroll.
2. **Public Sort Modes (D2)**: Strictly `latest` (`id DESC`), `price-asc` (`price ASC, id DESC`), and `price-desc` (`price DESC, id DESC`). Deterministic `id DESC` secondary tiebreaker.
3. **Public Search Scope (D3)**: Matches `Product.name`, relational `Category.name`, and `Product.subcategory`. `Product.description` is **strictly excluded**.
4. **Admin Catalog Bounds (D4)**: Default `pageSize = 20`, maximum `pageSize = 50`. Admin list queries (`AdminProductListDTO`) do not load full variant arrays; full variants load on-demand only for product edit/detail. Admin list initializes with `isActive = true, deletedAt = null` preserving existing lifecycle visibility.
5. **Category & Subcategory UX (D5 & D9)**: Selecting a parent category immediately displays all its products. Subcategory is an optional refinement filter relationally scoped under active `Category.id`. The query predicate supports existing dual-format storage (`lower(Product.subcategory) = lower(s.slug) OR lower(Product.subcategory) = lower(s.name)`). Cross-category or unscoped subcategories return empty results (`totalItems: 0`). No `Product.subcategoryId` migration in Phase 5.
6. **Result Metadata Envelope (D6)**: Every paginated endpoint returns `{ success: true, items: T[], page: number, pageSize: number, totalItems: number, totalPages: number, hasMore: boolean, nextPage: number | null }`. Count and item queries run concurrently via `Promise.all`.
7. **Read Model & DTO Separation (D7 & D8)**: `PublicProductCardDTO` includes `hasVariants: boolean` (computed on active variants without loading `variants[]` or N+1 queries) and omits `description` and `variants[]`. `PublicProductDetailDTO` returns active variants only and rejects inactive/deleted products with 404.
8. **Load-More URL & Restoration**: `page = N` represents results progressively revealed through logical page N. Server component renders Page 1 (`initialParams = { ...parsed, page: 1, skip: 0 }`). For `requestedPage <= 10`, client restoration fetches pages `2..requestedPage`. For `requestedPage > 10`, client replaces URL to `page = 10` via history `replaceState` and restores pages `2..10`.
9. **Defensive Input Safety**: `MAX_PUBLIC_PAGE = 10_000`, `MAX_ADMIN_PAGE = 10_000`. Requests exceeding maximum or with unsafe skip arithmetic fail closed with HTTP 400 `INVALID_PAGE`.
10. **Admin Discount Predicate**: Exact business rule: `compareAtPrice IS NOT NULL AND compareAtPrice > price`.
11. **Homepage Bounded Reads**: All homepage product dependencies (New Arrivals `take: 1`, Hot Deals `findFirst`, Category thumbnails via `Category.image`, Subcategory thumbnails via single-batch relational query joining active Subcategory) must never load the complete active product table.
12. **Locked Phase 1–4 Invariants**: All admin mutations and admin views require `requireAdmin` first. Inactive/deleted products never appear in public queries. Soft-delete historical protection, reservation delete guards (`PRODUCT_RESERVED_ACTIVE`, `VARIANT_RESERVED_ACTIVE`), variant stock authority / product aggregate mirror, PostgreSQL Decimal monetary precision, and checkout independence direct re-reads must remain 100% intact.

---

## Planned File Responsibility Map

| File Path | Action | Single Responsibility | Task Ownership |
|---|---|---|---|
| `lib/catalog/types.ts` | **CREATE** | Authoritative TypeScript interfaces for DTOs (`PublicProductCardDTO`, `PublicProductDetailDTO`, `AdminProductListDTO`, `AdminProductDetailDTO`), Query Inputs (`ParsedPublicCatalogParams`, `ParsedAdminCatalogParams`), and `PaginatedResult<T>`. | Task 1 |
| `lib/catalog/queryParams.ts` | **CREATE** | Pure parameter normalization, bounds clamping, slug validation regex, explicit `invalidFilter` state tracking, defensive page safety limits, and safe skip calculation. | Task 1 |
| `lib/catalog/progressiveCatalogState.ts` | **CREATE** | Pure client-state management for progressive catalog chunking, deduplication by ID, request generation / race safety, URL query formatting, and restoration normalization. | Task 1, Task 6 |
| `lib/catalog/publicCatalogQuery.ts` | **CREATE** | Database-side public catalog queries, relational category/subcategory resolution (slug & display name matching), deterministic sorting, concurrent `findMany` + `count`, public detail lookup, and keyset sitemap batching. | Task 2, Task 9 |
| `lib/catalog/adminCatalogQuery.ts` | **CREATE** | Database-side admin catalog queries (preserving `isActive: true, deletedAt: null`), server-side filters (including exact discount predicate), lightweight list projections, active variant counts, and full admin detail lookup. | Task 3 |
| `app/api/products/route.ts` | **MODIFY** | Atomic API route handlers for `GET /api/products`: routes `view=admin` through `requireAdmin` first, then public list/detail. | Task 4 |
| `app/admin/products/page.tsx` | **MODIFY** | Paginated admin products table consuming `AdminProductListDTO` envelope and fetching `AdminProductDetailDTO` on Edit. | Task 4 |
| `app/admin/products/[id]/edit/page.tsx` | **MODIFY** | Admin edit page fetching `GET /api/products?view=admin&id=${productId}`. | Task 4 |
| `app/admin/page.tsx` | **MODIFY** | Admin dashboard fetching lightweight counts instead of full product arrays. | Task 4 |
| `components/home/CategorySection.tsx` | **MODIFY** | Consumes batched subcategory thumbnail image map instead of raw product array, with fallback parsing paginated envelope. | Task 4, Task 8 |
| `components/home/HomePromoGrid.tsx` | **MODIFY** | Consumes targeted newest and hot deal product props directly, with fallback parsing paginated envelope. | Task 4, Task 8 |
| `components/shop/ShopProductGridClient.tsx` | **MODIFY** | Legacy client component updated to consume paginated API envelope `{ items, hasMore }`. | Task 4 |
| `lib/catalogRead.ts` | **MODIFY** | Bridge existing caching helper to wrap new catalog queries without altering memory-cache invariants. | Task 2, Task 8 |
| `lib/getProducts.ts` | **MODIFY** | Provide typed helper `getPaginatedProducts()` and maintain mapped detail functions. | Task 2, Task 9 |
| `prisma/schema.prisma` | **MODIFY** | Candidate composite indexes added if and only if proven by evidence gate. | Task 5 |
| `components/shop/ProgressiveProductGrid.tsx` | **CREATE** | Client-side progressive Load More component consuming `progressiveCatalogState.ts`, handling +24 chunk fetches, URL history synchronization, and restoration. | Task 6 |
| `components/shop/LoadMoreProducts.tsx` | **MODIFY** | Refactor to wrap `ProgressiveProductGrid.tsx` maintaining backward component compatibility. | Task 6 |
| `app/shop/page.tsx` | **MODIFY** | Server Component reading `searchParams`, parsing via `parsePublicCatalogParams`, forcing server initial render to Page 1, invoking `getPublicCatalogQuery`, and passing initial state to `ProgressiveProductGrid`. | Task 6 |
| `lib/catalog/homepageQueries.ts` | **CREATE** | Targeted homepage reads (New Arrivals promo, Hot Deals promo, and single-batch relational query for subcategory representative images). | Task 8 |
| `app/page.tsx` | **MODIFY** | Replace unbounded `findMany` with targeted bounded homepage queries (`getHomepagePromos`, `getRepresentativeSubcategoryImages`). | Task 8 |
| `app/sitemap.ts` | **MODIFY** | Bounded keyset traversal (`getSitemapProductRowsBatch`) emitting complete sitemap without memory spikes. | Task 9 |
| `tests/catalog-query-params.test.ts` | **CREATE** | Unit tests for query parameter parsing, normalization, bounds, slug syntax validation, safe skip calculation, and `invalidFilter` handling. | Task 1 |
| `tests/catalog-progressive-state.test.ts` | **CREATE** | Unit tests for pure progressive Load More state, ID deduplication, race token cancellation, and restoration normalization. | Task 1 |
| `tests/public-catalog-query.test.ts` | **CREATE** | Database integration tests for public catalog queries, relational category/subcategory scoping (slug & name), sorting, search, DTO shapes, and active `hasVariants`. | Task 2 |
| `tests/admin-catalog-query.test.ts` | **CREATE** | Unit/integration tests for admin catalog queries, lifecycle preservation, exact discount filter, active `variantCount`, and admin detail endpoint. | Task 3 |
| `tests/products-api-atomic-cutover.test.ts` | **CREATE** | API route integration tests for public/admin route separation, `requireAdmin` enforcement on `view=admin` (list & detail), and migrated consumer compatibility. | Task 4 |
| `tests/shop-load-more.test.ts` | **CREATE** | Tests for shop server initial render forcing to page 1, requested restoration target calculation, and query builder. | Task 6 |
| `tests/homepage-bounded-reads.test.ts` | **CREATE** | Tests verifying bounded homepage queries and single-batch relational representative image retrieval. | Task 8 |
| `tests/catalog-consumer-migration.test.ts` | **CREATE** | Regression tests verifying sitemap keyset batching, admin counts, and Decimal monetary authority. | Task 9 |

---

## Consumer Inventory & Atomic Migration Plan

Every consumer of catalog data across the repository is audited and migrated in lockstep with API cutovers:

1. **`app/api/products/route.ts`**: Core API endpoint. Cut over in **Task 4** with strict auth-first precedence for `view=admin`.
2. **`components/home/CategorySection.tsx`**: Consumes product array for subcategory thumbnails and has a fallback `fetch("/api/products")`. Updated in **Task 4** to parse paginated envelope and in **Task 8** to receive batched thumbnail map.
3. **`components/home/HomePromoGrid.tsx`**: Consumes product array for newest/hot deal and has a fallback `fetch("/api/products")`. Updated in **Task 4** to parse paginated envelope and in **Task 8** to receive targeted promo props.
4. **`components/shop/ShopProductGridClient.tsx`**: Legacy component fetching `/api/products?page=...`. Updated in **Task 4** to consume the paginated envelope `{ items, hasMore }`.
5. **`app/admin/page.tsx`**: Calls `fetch("/api/products")` for dashboard counts. Updated in **Task 4** to consume the paginated envelope / targeted counts.
6. **`app/admin/products/page.tsx`**: Calls `fetch("/api/products?view=admin")` expecting full product list. Updated in **Task 4** alongside the Admin API cutover to consume `AdminProductListDTO` and fetch `AdminProductDetailDTO` on Edit.
7. **`app/admin/products/[id]/edit/page.tsx`**: Calls `fetch("/api/products?id=...")`. Updated in **Task 4** to `fetch("/api/products?view=admin&id=...")`.
8. **`app/shop/page.tsx`**: Calls `getProducts()` with in-memory filtering. Migrated in **Task 6** to use `parsePublicCatalogParams` + `getPublicCatalogQuery` + `ProgressiveProductGrid`.
9. **`components/shop/LoadMoreProducts.tsx`**: Slices in-memory product array. Refactored in **Task 6** to delegate to `ProgressiveProductGrid`.
10. **`app/page.tsx`**: Calls unpaginated `prisma.product.findMany`. Migrated in **Task 8** to use `getHomepagePromos()` and `getRepresentativeSubcategoryImages()`.
11. **`app/sitemap.ts`**: Calls `getProducts()`. Migrated in **Task 9** to use keyset batching `getSitemapProductRowsBatch`.
12. **`app/product/[id]/page.tsx`**: Calls `getProductById(id)`. Migrated in **Task 2 / Task 9** to use `getPublicProductDetailQuery(id)`.

---

## Test Database Safety Pattern

All Phase-5 tests executing database queries reuse the repository's established skip pattern:

```ts
import { describe, it, before } from "node:test";
import { validateTestDatabaseSafety } from "./integration/db-safety";

const safety = validateTestDatabaseSafety();

describe(
  "Phase 5 DB Suite",
  {
    skip:
      !safety.safe &&
      "TEST_DATABASE_REQUIRED: Set DATABASE_URL_TEST to run real PostgreSQL catalog tests",
  },
  () => {
    // Tests execute against DATABASE_URL_TEST only
  }
);
```

**Invariants:**
- `DATABASE_URL_TEST` must exist and be distinct from `DATABASE_URL`.
- Default/production `DATABASE_URL` is **never** touched during tests.
- Never use `process.exit(0)` to skip tests; only the affected test suite is skipped, letting unit tests continue running.
- Fixtures use unique run prefixes (`p5_fixture_${Date.now()}_`), are cleaned up in `finally` blocks, and never perform destructive global truncates.

---

## Implementation Tasks

### Task 1: Query Parameter Parsing, Normalization, DTO Types & Progressive State (Wave A)

**Files:**
- Create: `lib/catalog/types.ts`
- Create: `lib/catalog/queryParams.ts`
- Create: `lib/catalog/progressiveCatalogState.ts`
- Test: `tests/catalog-query-params.test.ts`
- Test: `tests/catalog-progressive-state.test.ts`

**Interfaces:**
- Consumes: Raw URL query parameters (`Record<string, string | string[] | undefined>`).
- Produces: Normalized `ParsedPublicCatalogParams` (with `invalidFilter: boolean`), `ParsedAdminCatalogParams`, DTO types, and pure Load More state transitions.

**Steps:**
- [ ] **Step 1.1: Create compile-safe scaffolds for Task 1 modules**
  - Create `lib/catalog/types.ts` with all DTO interfaces (`PublicProductCardDTO`, `PublicProductDetailDTO`, `AdminProductListDTO`, `AdminProductDetailDTO`, `PaginatedResult<T>`).
  - Create scaffold for `lib/catalog/queryParams.ts` exporting stubbed `parsePublicCatalogParams` and `parseAdminCatalogParams` throwing `Error("NOT_YET_IMPLEMENTED")`.
  - Create scaffold for `lib/catalog/progressiveCatalogState.ts` exporting stubbed state helpers throwing `Error("NOT_YET_IMPLEMENTED")`.
- [ ] **Step 1.2: Write behavioral unit tests in `tests/catalog-query-params.test.ts`**
  ```ts
  import { describe, it } from "node:test";
  import assert from "node:assert/strict";
  import { parsePublicCatalogParams, parseAdminCatalogParams, CatalogQueryParamError } from "@/lib/catalog/queryParams";

  describe("Catalog Query Params Unit Tests", () => {
    it("normalizes default public parameters", () => {
      const parsed = parsePublicCatalogParams({});
      assert.strictEqual(parsed.page, 1);
      assert.strictEqual(parsed.pageSize, 24);
      assert.strictEqual(parsed.sort, "latest");
      assert.strictEqual(parsed.category, null);
      assert.strictEqual(parsed.subcategory, null);
      assert.strictEqual(parsed.q, null);
      assert.strictEqual(parsed.skip, 0);
      assert.strictEqual(parsed.invalidFilter, false);
    });

    it("marks invalid category slug as invalidFilter=true rather than null", () => {
      const invalid = parsePublicCatalogParams({ category: "invalid/slug*!" });
      assert.strictEqual(invalid.invalidFilter, true);
      assert.strictEqual(invalid.category, null);
    });

    it("marks subcategory without category as invalidFilter=true", () => {
      const invalid = parsePublicCatalogParams({ subcategory: "serum" });
      assert.strictEqual(invalid.invalidFilter, true);
    });

    it("rejects page > MAX_PUBLIC_PAGE (10,000) with CatalogQueryParamError", () => {
      assert.throws(() => parsePublicCatalogParams({ page: "10001" }), (err: any) => {
        return err instanceof CatalogQueryParamError && err.code === "INVALID_PAGE";
      });
    });

    it("rejects unsafe skip calculation with CatalogQueryParamError", () => {
      assert.throws(() => parsePublicCatalogParams({ page: "9007199254740992" }), (err: any) => {
        return err instanceof CatalogQueryParamError && err.code === "INVALID_PAGE";
      });
    });

    it("clamps admin pageSize to default 20 and max 50", () => {
      assert.strictEqual(parseAdminCatalogParams({}).pageSize, 20);
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "100" }).pageSize, 50);
    });
  });
  ```
- [ ] **Step 1.3: Write behavioral unit tests in `tests/catalog-progressive-state.test.ts`**
  - Test ID deduplication: merging incoming items with existing cards rejects duplicate IDs.
  - Test restoration normalization: `computeRestorationTarget(page = 15)` returns `{ targetPage: 10, shouldNormalizeUrl: true }`.
  - Test race token: generating a new query token invalidates responses from previous tokens.
- [ ] **Step 1.4: Run tests to confirm behavioral RED (NOT_YET_IMPLEMENTED)**
  ```bash
  npx tsx --test tests/catalog-query-params.test.ts tests/catalog-progressive-state.test.ts
  ```
- [ ] **Step 1.5: Implement `lib/catalog/queryParams.ts`**
  ```ts
  export class CatalogQueryParamError extends Error {
    constructor(public code: "INVALID_PAGE" | "INVALID_PAGE_SIZE", message: string) {
      super(message);
      this.name = "CatalogQueryParamError";
    }
  }

  const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  export const MAX_PUBLIC_PAGE = 10_000;
  export const MAX_ADMIN_PAGE = 10_000;

  export function parsePublicCatalogParams(raw: Record<string, unknown>): ParsedPublicCatalogParams {
    let invalidFilter = false;

    // Page normalization
    let page = 1;
    if (raw.page !== undefined && raw.page !== null && raw.page !== "") {
      const p = Number(raw.page);
      if (!Number.isInteger(p) || p < 1) {
        page = 1;
      } else if (p > MAX_PUBLIC_PAGE) {
        throw new CatalogQueryParamError("INVALID_PAGE", `Requested page exceeds maximum allowed page boundary (${MAX_PUBLIC_PAGE}).`);
      } else {
        page = p;
      }
    }

    // PageSize normalization
    let pageSize = 24;
    if (raw.pageSize !== undefined && raw.pageSize !== null && raw.pageSize !== "") {
      const ps = Number(raw.pageSize);
      pageSize = Number.isInteger(ps) && ps >= 1 ? Math.min(ps, 48) : 24;
    }

    // Sort normalization
    const sortVal = String(raw.sort || "").trim().toLowerCase();
    const sort: PublicSortMode = sortVal === "price-asc" || sortVal === "price-desc" ? sortVal : "latest";

    // Category normalization & validation
    let category: string | null = null;
    if (raw.category !== undefined && raw.category !== null && String(raw.category).trim() !== "") {
      const catTrim = String(raw.category).trim().toLowerCase();
      if (catTrim.length <= 100 && SLUG_REGEX.test(catTrim)) {
        category = catTrim;
      } else {
        invalidFilter = true;
      }
    }

    // Subcategory normalization & validation
    let subcategory: string | null = null;
    if (raw.subcategory !== undefined && raw.subcategory !== null && String(raw.subcategory).trim() !== "") {
      const subTrim = String(raw.subcategory).trim().toLowerCase();
      if (category && subTrim.length <= 100 && SLUG_REGEX.test(subTrim)) {
        subcategory = subTrim;
      } else {
        invalidFilter = true;
      }
    }

    // Search query normalization
    let q: string | null = null;
    if (raw.q !== undefined && raw.q !== null && String(raw.q).trim() !== "") {
      const qTrim = String(raw.q).trim().slice(0, 80);
      q = qTrim.length > 0 ? qTrim : null;
    }

    const skipNum = (page - 1) * pageSize;
    if (!Number.isSafeInteger(skipNum)) {
      throw new CatalogQueryParamError("INVALID_PAGE", "Requested page/pageSize exceeds safe integer calculation.");
    }
    const skip = skipNum;

    return { page, pageSize, sort, category, subcategory, q, skip, invalidFilter };
  }

  export function parseAdminCatalogParams(raw: Record<string, unknown>): ParsedAdminCatalogParams {
    let page = 1;
    if (raw.page !== undefined && raw.page !== null && raw.page !== "") {
      const p = Number(raw.page);
      if (!Number.isInteger(p) || p < 1) page = 1;
      else if (p > MAX_ADMIN_PAGE) throw new CatalogQueryParamError("INVALID_PAGE", "Requested admin page exceeds maximum.");
      else page = p;
    }

    let pageSize = 20;
    if (raw.pageSize !== undefined && raw.pageSize !== null && raw.pageSize !== "") {
      const ps = Number(raw.pageSize);
      pageSize = Number.isInteger(ps) && ps >= 1 ? Math.min(ps, 50) : 20;
    }

    const filterVal = String(raw.filter || "").trim().toLowerCase();
    const filter = ["hot", "upcoming", "discount", "badge"].includes(filterVal) ? (filterVal as any) : "all";

    let q: string | null = null;
    if (raw.q !== undefined && raw.q !== null && String(raw.q).trim() !== "") {
      const qTrim = String(raw.q).trim().slice(0, 80);
      q = qTrim.length > 0 ? qTrim : null;
    }

    const skipNum = (page - 1) * pageSize;
    if (!Number.isSafeInteger(skipNum)) {
      throw new CatalogQueryParamError("INVALID_PAGE", "Requested admin page/pageSize exceeds safe integer calculation.");
    }
    const skip = skipNum;

    return { page, pageSize, filter, q, skip };
  }
  ```
- [ ] **Step 1.6: Implement `lib/catalog/progressiveCatalogState.ts`**
  - Implement `deduplicateProducts(existing, incoming)`, `computeRestorationTarget(page, maxRestore = 10)`, and `createProgressiveQueryUrl(params)`.
- [ ] **Step 1.7: Run tests to confirm GREEN**
  ```bash
  npx tsx --test tests/catalog-query-params.test.ts tests/catalog-progressive-state.test.ts
  ```
- [ ] **Step 1.8: Commit Task 1**
  ```bash
  git diff --check
  git add lib/catalog/ tests/catalog-query-params.test.ts tests/catalog-progressive-state.test.ts
  git commit -m "feat(phase5): add catalog parameter parsing, DTO contracts, and progressive state helpers"
  ```

---

### Task 2: Public Database Catalog Reads & Dual-Format Subcategory Matching (Wave B)

**Files:**
- Create: `lib/catalog/publicCatalogQuery.ts`
- Modify: `lib/catalogRead.ts`
- Modify: `lib/getProducts.ts`
- Test: `tests/public-catalog-query.test.ts`

**Interfaces:**
- Consumes: `ParsedPublicCatalogParams`, PostgreSQL database via Prisma client.
- Produces: `PaginatedResult<PublicProductCardDTO>`, `PublicProductDetailDTO`.

**Steps:**
- [ ] **Step 2.1: Create compile-safe scaffold for `lib/catalog/publicCatalogQuery.ts`**
  - Export stubs for `getPublicCatalogQuery` and `getPublicProductDetailQuery` throwing `Error("NOT_YET_IMPLEMENTED")`.
- [ ] **Step 2.2: Write behavioral integration test in `tests/public-catalog-query.test.ts`**
  - Use `describe("...", { skip: !safety.safe && "TEST_DATABASE_REQUIRED..." }, () => { ... })`.
  - Test pagination chunking: page 1 returns 24 items, page 2 returns items 25–48 with zero ID overlap.
  - Test `invalidFilter: true` immediately returns `{ success: true, items: [], totalItems: 0 }` without hitting products table.
  - Test deterministic sorting: `latest` (`id DESC`), `price-asc` (`price ASC, id DESC`), `price-desc` (`price DESC, id DESC`).
  - Test relational category slug resolution: queries `Product.categoryId = Category.id`.
  - Test dual-format subcategory matching: seed a product with `subcategory = "serum"` (slug) and another with `subcategory = "Serum"` (name); verify both resolve under `?category=skincare&subcategory=serum`.
  - Test cross-category subcategory mismatch: returns `totalItems: 0` and `items: []`.
  - Test search scope: matches `Product.name`, `Category.name`, `Product.subcategory`, and excludes `Product.description`.
  - Test DTO projection: asserts `PublicProductCardDTO` has `hasVariants: boolean` (reflecting active variants only) and omits `description` and `variants[]`. No N+1 queries.
  - Test lifecycle filter: asserts `isActive = false` or `deletedAt != null` products are never returned.
- [ ] **Step 2.3: Run test to confirm behavioral RED (NOT_YET_IMPLEMENTED)**
  ```bash
  npx tsx --test tests/public-catalog-query.test.ts
  ```
- [ ] **Step 2.4: Implement `getPublicCatalogQuery` in `lib/catalog/publicCatalogQuery.ts`**
  ```ts
  export async function getPublicCatalogQuery(params: ParsedPublicCatalogParams): Promise<PaginatedResult<PublicProductCardDTO>> {
    if (params.invalidFilter) {
      return {
        success: true,
        items: [],
        page: params.page,
        pageSize: params.pageSize,
        totalItems: 0,
        totalPages: 0,
        hasMore: false,
        nextPage: null,
      };
    }

    const where: any = {
      isActive: true,
      deletedAt: null,
    };

    if (params.category) {
      const categories = await getCachedCategoryRows(false);
      const matchedCategory = categories.find((c) => c.slug === params.category && c.isActive);
      if (!matchedCategory) {
        return { success: true, items: [], page: params.page, pageSize: params.pageSize, totalItems: 0, totalPages: 0, hasMore: false, nextPage: null };
      }
      where.categoryId = matchedCategory.id;

      if (params.subcategory) {
        const matchedSub = matchedCategory.subcategories?.find(
          (s) => s.slug === params.subcategory && s.isActive
        );
        if (!matchedSub) {
          return { success: true, items: [], page: params.page, pageSize: params.pageSize, totalItems: 0, totalPages: 0, hasMore: false, nextPage: null };
        }
        where.AND = [
          {
            OR: [
              { subcategory: { equals: matchedSub.slug, mode: "insensitive" } },
              { subcategory: { equals: matchedSub.name, mode: "insensitive" } },
            ],
          },
        ];
      }
    }

    if (params.q) {
      where.OR = [
        { name: { contains: params.q, mode: "insensitive" } },
        { subcategory: { contains: params.q, mode: "insensitive" } },
        { categoryRel: { name: { contains: params.q, mode: "insensitive" } } },
      ];
    }

    const orderBy =
      params.sort === "price-asc"
        ? [{ price: "asc" as const }, { id: "desc" as const }]
        : params.sort === "price-desc"
        ? [{ price: "desc" as const }, { id: "desc" as const }]
        : [{ id: "desc" as const }];

    const [rows, totalItems] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy,
        skip: params.skip,
        take: params.pageSize,
        select: {
          id: true,
          name: true,
          price: true,
          compareAtPrice: true,
          image: true,
          category: true,
          stock: true,
          isHotDeal: true,
          isUpcoming: true,
          badgeText: true,
          badgeTone: true,
          _count: {
            select: {
              variants: {
                where: { isActive: true },
              },
            },
          },
        },
      }),
      prisma.product.count({ where }),
    ]);

    const items: PublicProductCardDTO[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      price: Number(r.price),
      compareAtPrice: r.compareAtPrice !== null ? Number(r.compareAtPrice) : null,
      image: r.image,
      category: r.category,
      stock: r.stock,
      isHotDeal: r.isHotDeal,
      isUpcoming: r.isUpcoming,
      badgeText: r.badgeText,
      badgeTone: r.badgeTone,
      hasVariants: r._count.variants > 0,
    }));

    const totalPages = Math.ceil(totalItems / params.pageSize);
    const hasMore = params.page < totalPages;
    const nextPage = hasMore ? params.page + 1 : null;

    return { success: true, items, page: params.page, pageSize: params.pageSize, totalItems, totalPages, hasMore, nextPage };
  }
  ```
- [ ] **Step 2.5: Implement `getPublicProductDetailQuery(id)` in `lib/catalog/publicCatalogQuery.ts`**
  - Enforce `where: { id, isActive: true, deletedAt: null }`.
  - Include `variants: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }`.
  - Return `PublicProductDetailDTO` or `null`.
- [ ] **Step 2.6: Update `lib/getProducts.ts` to export `getPaginatedProducts`**
- [ ] **Step 2.7: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/public-catalog-query.test.ts
  ```
- [ ] **Step 2.8: Commit Task 2**
  ```bash
  git diff --check
  git add lib/catalog/publicCatalogQuery.ts lib/catalogRead.ts lib/getProducts.ts tests/public-catalog-query.test.ts
  git commit -m "feat(phase5): implement public catalog query helper with dual-format subcategory matching"
  ```

---

### Task 3: Admin Catalog Read Model & Exact Discount Predicate (Wave C)

**Files:**
- Create: `lib/catalog/adminCatalogQuery.ts`
- Test: `tests/admin-catalog-query.test.ts`

**Interfaces:**
- Consumes: `ParsedAdminCatalogParams`, PostgreSQL database via Prisma client.
- Produces: `PaginatedResult<AdminProductListDTO>`, `AdminProductDetailDTO`.

**Steps:**
- [ ] **Step 3.1: Create compile-safe scaffold for `lib/catalog/adminCatalogQuery.ts`**
  - Export stubs for `getAdminCatalogQuery` and `getAdminProductDetailQuery` throwing `Error("NOT_YET_IMPLEMENTED")`.
- [ ] **Step 3.2: Write behavioral tests in `tests/admin-catalog-query.test.ts`**
  - Use `describe("...", { skip: !safety.safe && "TEST_DATABASE_REQUIRED..." }, () => { ... })`.
  - Test admin list preserves lifecycle filter: `isActive = true, deletedAt = null`.
  - Test admin discount filter `filter=discount`: matches strictly `compareAtPrice IS NOT NULL AND compareAtPrice > price`.
  - Test admin filters: `filter=hot`, `filter=upcoming`, `filter=badge`.
  - Test projection: verifies `variantCount` counts active variants only, `description` and full `variants[]` omitted.
  - Test admin detail `getAdminProductDetailQuery(id)`: returns all variants (active and inactive) and audit fields.
- [ ] **Step 3.3: Run test to confirm behavioral RED (NOT_YET_IMPLEMENTED)**
  ```bash
  npx tsx --test tests/admin-catalog-query.test.ts
  ```
- [ ] **Step 3.4: Implement `lib/catalog/adminCatalogQuery.ts`**
  ```ts
  export async function getAdminCatalogQuery(params: ParsedAdminCatalogParams): Promise<PaginatedResult<AdminProductListDTO>> {
    const where: any = {
      isActive: true,
      deletedAt: null,
    };

    if (params.filter === "hot") where.isHotDeal = true;
    else if (params.filter === "upcoming") where.isUpcoming = true;
    else if (params.filter === "badge") where.badgeText = { not: null };
    else if (params.filter === "discount") {
      where.AND = [
        { compareAtPrice: { not: null } },
        { compareAtPrice: { gt: prisma.product.fields.price } },
      ];
    }

    if (params.q) {
      const qNum = Number(params.q);
      if (Number.isInteger(qNum) && qNum > 0) {
        where.OR = [{ id: qNum }, { name: { contains: params.q, mode: "insensitive" } }];
      } else {
        where.OR = [
          { name: { contains: params.q, mode: "insensitive" } },
          { category: { contains: params.q, mode: "insensitive" } },
          { subcategory: { contains: params.q, mode: "insensitive" } },
        ];
      }
    }

    const [rows, totalItems] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: [{ id: "desc" }],
        skip: params.skip,
        take: params.pageSize,
        select: {
          id: true,
          name: true,
          price: true,
          compareAtPrice: true,
          image: true,
          category: true,
          categoryId: true,
          subcategory: true,
          stock: true,
          isHotDeal: true,
          isUpcoming: true,
          badgeText: true,
          badgeTone: true,
          isActive: true,
          createdAt: true,
          _count: {
            select: {
              variants: {
                where: { isActive: true },
              },
            },
          },
        },
      }),
      prisma.product.count({ where }),
    ]);

    const items: AdminProductListDTO[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      price: Number(r.price),
      compareAtPrice: r.compareAtPrice !== null ? Number(r.compareAtPrice) : null,
      image: r.image,
      category: r.category,
      categoryId: r.categoryId,
      subcategory: r.subcategory,
      stock: r.stock,
      isHotDeal: r.isHotDeal,
      isUpcoming: r.isUpcoming,
      badgeText: r.badgeText,
      badgeTone: r.badgeTone,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      variantCount: r._count.variants,
      hasVariants: r._count.variants > 0,
    }));

    const totalPages = Math.ceil(totalItems / params.pageSize);
    const hasMore = params.page < totalPages;
    const nextPage = hasMore ? params.page + 1 : null;

    return { success: true, items, page: params.page, pageSize: params.pageSize, totalItems, totalPages, hasMore, nextPage };
  }
  ```
- [ ] **Step 3.5: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/admin-catalog-query.test.ts
  ```
- [ ] **Step 3.6: Commit Task 3**
  ```bash
  git diff --check
  git add lib/catalog/adminCatalogQuery.ts tests/admin-catalog-query.test.ts
  git commit -m "feat(phase5): implement admin catalog query model and exact discount predicate"
  ```

---

### Task 4: Atomic API Contract Cutover & Full Consumer Migration (Wave D)

**Files:**
- Modify: `app/api/products/route.ts`
- Modify: `app/admin/products/page.tsx`
- Modify: `app/admin/products/[id]/edit/page.tsx`
- Modify: `app/admin/page.tsx`
- Modify: `components/home/CategorySection.tsx`
- Modify: `components/home/HomePromoGrid.tsx`
- Modify: `components/shop/ShopProductGridClient.tsx`
- Test: `tests/products-api-atomic-cutover.test.ts`

**Interfaces:**
- Consumes: HTTP GET requests to `/api/products` (public and admin).
- Produces: Locked API contracts (A, B, C, D) and fully migrated callers with zero broken intermediate states.

**Steps:**
- [ ] **Step 4.1: Write failing API route test in `tests/products-api-atomic-cutover.test.ts`**
  - Test unauthenticated `GET /api/products?view=admin&page=1` returns HTTP 401.
  - Test unauthenticated `GET /api/products?view=admin&id=123` returns HTTP 401 (never falls through to public detail).
  - Test authenticated admin list returns `AdminProductListDTO` envelope.
  - Test authenticated admin detail returns `AdminProductDetailDTO`.
  - Test public list `GET /api/products?view=public&page=1` returns `PublicProductCardDTO` envelope.
  - Test public default `GET /api/products` returns public Page 1 envelope.
  - Test public detail `GET /api/products?id=123` returns `PublicProductDetailDTO` (active only; inactive/deleted returns 404).
- [ ] **Step 4.2: Implement `app/api/products/route.ts` with strict route precedence**
  ```ts
  export async function GET(req: Request) {
    try {
      const url = new URL(req.url);
      const searchParams = url.searchParams;
      const view = (searchParams.get("view") || "").trim().toLowerCase();

      // 1. Admin Branch (Auth First)
      if (view === "admin" || view === "full") {
        const unauthorized = requireAdmin(req);
        if (unauthorized) return unauthorized;

        const idParam = searchParams.get("id");
        if (idParam) {
          const id = Number(idParam);
          if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ success: false, message: "Invalid product id." }, { status: 400 });
          }
          const product = await getAdminProductDetailQuery(id);
          if (!product) {
            return NextResponse.json({ success: false, message: "Product not found." }, { status: 404 });
          }
          return NextResponse.json({ success: true, product });
        }

        const parsed = parseAdminCatalogParams(Object.fromEntries(searchParams.entries()));
        const result = await getAdminCatalogQuery(parsed);
        return NextResponse.json(result);
      }

      // 2. Public Single Product Detail
      const idParam = searchParams.get("id");
      if (idParam) {
        const id = Number(idParam);
        if (!Number.isInteger(id) || id <= 0) {
          return NextResponse.json({ success: false, message: "Invalid product id." }, { status: 400 });
        }
        const product = await getPublicProductDetailQuery(id);
        if (!product) {
          return NextResponse.json({ success: false, message: "Product not found." }, { status: 404 });
        }
        return NextResponse.json({ success: true, product }, { headers: publicCacheHeaders() });
      }

      // 3. Public Paginated List
      const parsed = parsePublicCatalogParams(Object.fromEntries(searchParams.entries()));
      const result = await getPublicCatalogQuery(parsed);
      return NextResponse.json(result, { headers: publicCacheHeaders() });
    } catch (error) {
      if (error instanceof CatalogQueryParamError) {
        return NextResponse.json({ success: false, code: error.code, message: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: false, message: "Failed to load products." }, { status: 500 });
    }
  }
  ```
- [ ] **Step 4.3: Atomically migrate all callers of `/api/products`**
  - In `app/admin/products/page.tsx`:
    - Update `loadProducts(page, filter, query)` to consume `data.items`, `data.totalPages`, `data.totalItems`.
    - Update `startEdit(productId)` to fetch `/api/products?view=admin&id=${productId}` and populate form from `AdminProductDetailDTO`.
  - In `app/admin/products/[id]/edit/page.tsx`: update to fetch `/api/products?view=admin&id=${productId}`.
  - In `app/admin/page.tsx`: update `loadDashboard()` to parse `productData?.items || productData?.products` or count.
  - In `components/home/CategorySection.tsx`: update `loadData()` to parse `productPayload.data?.items`.
  - In `components/home/HomePromoGrid.tsx`: update `loadData()` to parse `productData?.items`.
  - In `components/shop/ShopProductGridClient.tsx`: update to parse `data?.items`.
- [ ] **Step 4.4: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/products-api-atomic-cutover.test.ts
  ```
- [ ] **Step 4.5: Run catalog safety suite**
  ```bash
  npx tsx --test tests/catalog-safety.test.ts
  ```
- [ ] **Step 4.6: Commit Task 4**
  ```bash
  git diff --check
  git add app/api/products/route.ts app/admin/ components/home/ components/shop/ tests/products-api-atomic-cutover.test.ts
  git commit -m "feat(phase5): cut over public and admin catalog API contracts and migrate all consumers atomically"
  ```

---

### Task 5: Database Index Evidence Gate & Query-Plan Verification (Wave E)

**Files:**
- Modify: `prisma/schema.prisma` (if and only if justified by evidence)
- Create: `prisma/migrations/...` (if and only if justified by evidence)

**Interfaces:**
- Consumes: Real PostgreSQL query execution plans via `EXPLAIN (ANALYZE, BUFFERS)` on `DATABASE_URL_TEST`.
- Produces: Query-proven composite indexes in Prisma schema and migration SQL.

**Steps:**
- [ ] **Step 5.1: Verify test database safety**
  - Check `validateTestDatabaseSafety()`. If not safe, skip benchmark without modifying schema.
- [ ] **Step 5.2: Execute baseline query plan measurements on synthetic catalog**
  - Seed synthetic test fixture on `DATABASE_URL_TEST`.
  - Record baseline plans for:
    1. Global latest: `WHERE isActive = true AND deletedAt IS NULL ORDER BY id DESC LIMIT 24`
    2. Category latest: `WHERE categoryId = $1 AND isActive = true AND deletedAt IS NULL ORDER BY id DESC LIMIT 24`
    3. Global price ASC / DESC: `WHERE isActive = true AND deletedAt IS NULL ORDER BY price ASC/DESC, id DESC LIMIT 24`
    4. Category price ASC / DESC: `WHERE categoryId = $1 AND isActive = true AND deletedAt IS NULL ORDER BY price ASC/DESC, id DESC LIMIT 24`
- [ ] **Step 5.3: Temporarily test candidate indexes on isolated test database**
  - Evaluate:
    - Candidate 1: `(isActive, deletedAt, id DESC)`
    - Candidate 2: `(categoryId, isActive, deletedAt, id DESC)`
    - Candidate 3: `(isActive, deletedAt, price ASC/DESC, id DESC)`
    - Candidate 4: `(categoryId, isActive, deletedAt, price ASC/DESC, id DESC)`
- [ ] **Step 5.4: Apply only query-proven indexes to `prisma/schema.prisma`**
  - If evidence justifies new composite indexes, add them to `model Product` and run `npx prisma migrate dev --name phase5_catalog_indexes`. Commit: `perf(phase5): apply query-proven catalog composite indexes`.
  - If no candidate index provides measurable improvement over existing indexes, leave `prisma/schema.prisma` unchanged and record evidence. (Zero empty commits created).

---

### Task 6: Shop Server Component & Progressive Load More Client (Wave F)

**Files:**
- Create: `components/shop/ProgressiveProductGrid.tsx`
- Modify: `components/shop/LoadMoreProducts.tsx`
- Modify: `app/shop/page.tsx`
- Test: `tests/shop-load-more.test.ts`

**Interfaces:**
- Consumes: `PaginatedResult<PublicProductCardDTO>` on server render, `/api/products?view=public...` on client Load More.
- Produces: Responsive product grid with progressive chunk loading, URL history synchronization, and restoration.

**Steps:**
- [ ] **Step 6.1: Write unit tests in `tests/shop-load-more.test.ts`**
  - Test server initial params forced to `page: 1, skip: 0`.
  - Test restoration target calculation: for requested `page = 3`, `restoration.targetPage = 3`.
  - Test URL normalization requirement: for requested `page = 15`, `restoration.targetPage = 10, shouldNormalizeUrl = true`.
  - Test filter key reset: changing category/sort produces new clean query key.
- [ ] **Step 6.2: Implement `components/shop/ProgressiveProductGrid.tsx`**
  - Import `deduplicateProducts`, `computeRestorationTarget`, `createProgressiveQueryUrl` from `lib/catalog/progressiveCatalogState.ts`.
  - Maintain request generation counter / `AbortController` to prevent race conditions from stale queries.
  - On mount: if `requestedPage > 1`:
    - If `requestedPage <= 10`: fetch pages `2..requestedPage` sequentially/concurrently and append.
    - If `requestedPage > 10`: normalize URL via `window.history.replaceState` to `page=10` and restore pages `2..10`.
  - Render ProductCard grid preserving current UI styling.
- [ ] **Step 6.3: Refactor `components/shop/LoadMoreProducts.tsx`**
  - Forward props to `ProgressiveProductGrid.tsx`.
- [ ] **Step 6.4: Update `app/shop/page.tsx`**
  - Parse `searchParams` with `parsePublicCatalogParams`.
  - Compute restoration target: `const restoration = computeRestorationTarget(parsed.page)`.
  - Server render Page 1: `const initialResult = await getPublicCatalogQuery({ ...parsed, page: 1, skip: 0 })`.
  - Pass `initialResult`, `requestedPage: restoration.targetPage`, `shouldNormalizeUrl: restoration.shouldNormalizeUrl` to `ProgressiveProductGrid`.
  - Remove in-memory `sortProducts` and manual `products.filter` arrays.
  - Update Category & Subcategory sidebar/pills: selecting a parent category navigates immediately to `?category=slug`; subcategories act as optional filter links.
- [ ] **Step 6.5: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/shop-load-more.test.ts
  ```
- [ ] **Step 6.6: Commit Task 6**
  ```bash
  git diff --check
  git add components/shop/ app/shop/page.tsx tests/shop-load-more.test.ts
  git commit -m "feat(phase5): add progressive shop loading with URL state restoration"
  ```

---

### Task 7: Homepage Bounded Catalog Reads & Batched Thumbnail Resolution (Wave H)

**Files:**
- Create: `lib/catalog/homepageQueries.ts`
- Modify: `app/page.tsx`
- Modify: `components/home/HomePromoGrid.tsx`
- Modify: `components/home/CategorySection.tsx`
- Test: `tests/homepage-bounded-reads.test.ts`

**Interfaces:**
- Consumes: Bounded database queries.
- Produces: Homepage promo products and batched subcategory thumbnail image map without loading full table.

**Steps:**
- [ ] **Step 7.1: Create compile-safe scaffold for `lib/catalog/homepageQueries.ts`**
  - Export stubs for `getHomepagePromos` and `getRepresentativeSubcategoryImages` throwing `Error("NOT_YET_IMPLEMENTED")`.
- [ ] **Step 7.2: Write failing behavioral test in `tests/homepage-bounded-reads.test.ts`**
  - Use `describe("...", { skip: !safety.safe && "TEST_DATABASE_REQUIRED..." }, () => { ... })`.
  - Test New Arrivals query fetches at most 1 product (`take: 1`).
  - Test Hot Deals query fetches at most 1 product (`findFirst`).
  - Test subcategory thumbnail query: single-batch query joining active Subcategory, canonical map keys use `Subcategory.slug`, supports legacy slug and display name product values, no N+1, no complete product materialization.
  - Test lifecycle exclusions: inactive/deleted products are excluded.
- [ ] **Step 7.3: Run test to confirm behavioral RED (NOT_YET_IMPLEMENTED)**
  ```bash
  npx tsx --test tests/homepage-bounded-reads.test.ts
  ```
- [ ] **Step 7.4: Implement `lib/catalog/homepageQueries.ts`**
  ```ts
  export async function getHomepagePromos() {
    const [newArrivals, hotDeal] = await Promise.all([
      prisma.product.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, name: true, image: true, createdAt: true },
      }),
      prisma.product.findFirst({
        where: { isActive: true, deletedAt: null, isHotDeal: true },
        orderBy: [{ id: "desc" }],
        select: { id: true, name: true, image: true, createdAt: true },
      }),
    ]);

    return {
      newestProduct: newArrivals[0] ? { ...newArrivals[0], createdAt: newArrivals[0].createdAt.toISOString() } : null,
      hotDealProduct: hotDeal ? { ...hotDeal, createdAt: hotDeal.createdAt.toISOString() } : null,
    };
  }

  export async function getRepresentativeSubcategoryImages(): Promise<Record<string, string>> {
    const rows = await prisma.$queryRaw<Array<{ categorySlug: string; subcategorySlug: string; image: string }>>`
      SELECT DISTINCT ON (c."slug", s."slug")
        c."slug" AS "categorySlug",
        s."slug" AS "subcategorySlug",
        p."image"
      FROM "Product" p
      JOIN "Category" c ON p."categoryId" = c."id"
      JOIN "Subcategory" s ON s."categoryId" = c."id"
        AND s."isActive" = true
        AND (
          lower(p."subcategory") = lower(s."slug")
          OR lower(p."subcategory") = lower(s."name")
        )
      WHERE p."isActive" = true
        AND p."deletedAt" IS NULL
        AND c."isActive" = true
        AND p."image" IS NOT NULL
        AND p."image" <> ''
      ORDER BY c."slug", s."slug", p."id" DESC;
    `;

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[`${row.categorySlug.toLowerCase()}:${row.subcategorySlug.toLowerCase()}`] = row.image;
    }
    return map;
  }
  ```
- [ ] **Step 7.5: Update `app/page.tsx`, `HomePromoGrid.tsx`, and `CategorySection.tsx`**
  - `app/page.tsx`: replace unpaginated `prisma.product.findMany` with `getHomepagePromos()` and `getRepresentativeSubcategoryImages()`.
  - `HomePromoGrid.tsx`: accept `newestProduct` and `hotDealProduct` directly as props, preserving all existing promo tiles (`Top Picks`, `New Arrivals`, `Hot Deals`).
  - `CategorySection.tsx`: accept `subcategoryImageMap` directly as props; resolve subcategory thumbnail via map lookup with fallback to `Category.image`.
- [ ] **Step 7.6: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/homepage-bounded-reads.test.ts
  ```
- [ ] **Step 7.7: Commit Task 7**
  ```bash
  git diff --check
  git add lib/catalog/homepageQueries.ts app/page.tsx components/home/ tests/homepage-bounded-reads.test.ts
  git commit -m "perf(phase5): bound homepage catalog reads and batch subcategory thumbnail resolution"
  ```

---

### Task 8: Keyset Sitemap Traversal, Admin Overview & Decimal Authority (Wave I)

**Files:**
- Modify: `app/sitemap.ts`
- Modify: `lib/catalog/publicCatalogQuery.ts`
- Test: `tests/catalog-consumer-migration.test.ts`

**Interfaces:**
- Consumes: Keyset ID batches.
- Produces: Complete sitemap traversal without memory spikes and Decimal authority regression checks.

**Steps:**
- [ ] **Step 8.1: Write migration regression tests in `tests/catalog-consumer-migration.test.ts`**
  - Test keyset batched sitemap traversal: emits all active product URLs across multiple batches without memory spikes.
  - Test Decimal monetary authority: PostgreSQL Decimal remains authoritative; DTO JavaScript `Number` is presentation-only; checkout (`POST /api/orders`) re-reads authoritative Decimal prices and stock from PostgreSQL.
- [ ] **Step 8.2: Run test to confirm RED**
  ```bash
  npx tsx --test tests/catalog-consumer-migration.test.ts
  ```
- [ ] **Step 8.3: Implement `getSitemapProductRowsBatch` in `lib/catalog/publicCatalogQuery.ts`**
  ```ts
  export async function getSitemapProductRowsBatch(params: { afterId?: number; take?: number }): Promise<Array<{ id: number; updatedAt: Date }>> {
    const take = params.take ?? 1000;
    const where: any = {
      isActive: true,
      deletedAt: null,
    };
    if (params.afterId) {
      where.id = { gt: params.afterId };
    }
    return prisma.product.findMany({
      where,
      orderBy: [{ id: "asc" }],
      take,
      select: { id: true, updatedAt: true },
    });
  }
  ```
- [ ] **Step 8.4: Update `app/sitemap.ts`**
  - Traverse `getSitemapProductRowsBatch({ afterId, take: 1000 })` in a loop until complete, building the full sitemap without unindexed OFFSET scans.
- [ ] **Step 8.5: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/catalog-consumer-migration.test.ts
  ```
- [ ] **Step 8.6: Run full repository test suite**
  ```bash
  npm test
  ```
- [ ] **Step 8.7: Commit Task 8**
  ```bash
  git diff --check
  git add app/sitemap.ts lib/catalog/publicCatalogQuery.ts tests/catalog-consumer-migration.test.ts
  git commit -m "refactor(phase5): add keyset sitemap traversal and enforce Decimal authority"
  ```

---

### Task 9: Full Regression Verification & Responsive Real Browser QA (Wave J)

**Files:**
- Verification only across all test suites and browser viewports.

**Interfaces:**
- Consumes: Complete public, admin, and homepage catalog flows.
- Produces: 100% automated test pass, zero new Phase-5 lint regressions, and visual browser verification report.

**Steps:**
- [ ] **Step 9.1: Run complete automated test suite**
  ```bash
  npm test
  ```
  Assert 100% test pass with 0 failures across all existing Phase 1–4 tests and new Phase 5 suites.
- [ ] **Step 9.2: Run TypeScript and Prisma validation**
  ```bash
  npx tsc --noEmit
  npx prisma validate
  ```
- [ ] **Step 9.3: Run scoped ESLint on Phase 5 created/modified files**
  ```bash
  npx eslint lib/catalog/ components/shop/ tests/
  ```
  Verify zero new Phase-5 lint regressions.
- [ ] **Step 9.4: Perform responsive browser QA using Chrome DevTools MCP on dynamic synthetic test fixture**
  - Create dynamic active synthetic test product `PHASE5-QA-PRODUCT` and inactive synthetic product on isolated test database.
  - **Viewports Tested**:
    - Mobile: 375px × 667px (iPhone SE)
    - Tablet: 768px × 1024px (iPad)
    - Desktop: 1280px × 800px (Desktop HD)
  - **Public Catalog QA Flow**:
    - Navigate to `/shop`. Verify initial 24 product cards rendered with correct badges, prices, and stock indicators.
    - Click "Load More". Verify +24 products appended, URL updates to `?page=2`, zero duplicate cards.
    - Select parent category (`?category=skincare`). Verify immediate display of all skincare products without subcategory block.
    - Select subcategory (`?category=skincare&subcategory=serum`). Verify refinement.
    - Change sort to `price-asc` and `price-desc`. Verify deterministic ordering with ID tiebreaker.
    - Search for term (`?q=cream`). Verify name, category, and subcategory matches; verify description terms are excluded.
    - Refresh page at `?page=2`. Verify deterministic reconstruction through page 2.
    - Navigate directly to `?page=15`. Verify state/URL normalizes to `page=10` and restores through page 10.
  - **Product Detail QA Flow**:
    - Navigate to `/product/${dynamicActiveProductId}`. Verify active variants and description render.
    - Navigate to `/product/${dynamicInactiveProductId}`. Verify 404.
  - **Admin Products QA Flow**:
    - Log in as admin. Navigate to `/admin/products`.
    - Verify server-side paginated table (20 per page) with Next/Prev controls.
    - Test filters: `Hot Deals`, `Upcoming`, `Discounted`, `Image Badges`.
    - Click "Edit" on `PHASE5-QA-PRODUCT` and verify full editable variants and description load cleanly.
    - Clean up synthetic test records safely in test database.
  - **Homepage QA Flow**:
    - Navigate to `/`. Verify New Arrivals promo, Hot Deals promo, and Category/Subcategory thumbnails render correctly with zero console errors.
- [ ] **Step 9.5: Run production build verification**
  ```bash
  npm run build
  ```
- [ ] **Step 9.6: Verification complete**
  - Confirm all verification gates passed. (No empty commit created for verification step).

---

## Plan Self-Review Checklist

- [x] **No `process.exit(0)` in Tests**: Reuses existing `describe("...", { skip: !safety.safe && "TEST_DATABASE_REQUIRED..." }, ...)` skip pattern.
- [x] **Truly Atomic API Cutover**: Task 4 cuts over public list/detail, admin list/detail, and migrates all callers in one commit.
- [x] **Strict Route Precedence**: `view=admin` enforces `requireAdmin` first and never falls through to public detail.
- [x] **Load More Server Initial Render**: `app/shop/page.tsx` server-renders Page 1 (`page: 1, skip: 0`), client restores pages `2..targetPage`.
- [x] **Dual-Format Subcategory Compatibility**: SQL / Prisma predicates match both `s.slug` and `s.name`.
- [x] **Homepage Subcategory Image SQL**: One bounded relational query joins active Subcategory with `DISTINCT ON (c.slug, s.slug)`.
- [x] **Admin List Lifecycle**: Preserves `isActive: true, deletedAt: null`.
- [x] **Admin Route Auth Tests**: 401 tests for list and detail present in Task 4.
- [x] **Safe Skip Fail-Closed**: Throws `CatalogQueryParamError("INVALID_PAGE")` if skip exceeds safe integer bounds.
- [x] **Index Zero-Evidence Path**: Clear conditional logic without empty commits.
- [x] **Pure UI Testing Strategy**: `progressiveCatalogState.ts` tested with `node:test`; UI verified via Chrome DevTools MCP.
- [x] **Baseline-Aware Linting**: Verified zero new Phase-5 regressions without claiming unrealistic full-repo clean.
- [x] **Dynamic Browser QA Fixtures**: Dynamic IDs used on isolated test DB.
- [x] **Phase 1–4 Invariants Protected**: Admin auth, lifecycle safety, reservation delete guards, variant stock authority / product aggregate mirror, Decimal precision, and checkout independence strictly maintained.
- [x] **Phase Boundaries**: Strictly isolated from Phases 6–9.
