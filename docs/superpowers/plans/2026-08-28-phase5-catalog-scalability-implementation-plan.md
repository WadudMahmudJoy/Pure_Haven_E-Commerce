# Phase 5 Catalog Scalability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved bounded, server-authoritative Phase-5 catalog architecture without changing the Phase-1–4 commerce, security, inventory, or relational invariants.

**Architecture:** Replace unpaginated full-table scans with server-authoritative bounded pagination, relational category slug resolution, scoped subcategory filtering, deterministic sorting, and minimal DTO projections across public and admin catalog subsystems. Implement progressive client-side chunk loading (+24 items) with pure-state URL synchronization, request-race safety, a cold-reload restoration safety cap (`MAX_RESTORABLE_PUBLIC_PAGE = 10`), a single-batch subcategory representative image query, and an evidence-gated PostgreSQL composite index strategy. Preserve PostgreSQL Decimal precision and checkout independence.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Prisma 7, PostgreSQL/Neon, Node.js native test runner (`tsx --test`), Chrome DevTools MCP.

**Spec:** [`docs/superpowers/specs/2026-08-28-phase5-catalog-scalability-design.md`](file:///e:/Joy/pure-haven-bd-joy/pure-haven-bd/docs/superpowers/specs/2026-08-28-phase5-catalog-scalability-design.md)

---

## Global Constraints & Locked Boundaries

1. **Public Catalog Chunking (D1)**: Initial load renders 24 products; clicking "Load More" requests the next 24 products (+24). Hard server cap of `pageSize = 48`. No endless/uncontrolled infinite scroll.
2. **Public Sort Modes (D2)**: Strictly `latest` (`id DESC`), `price-asc` (`price ASC, id DESC`), and `price-desc` (`price DESC, id DESC`). Deterministic `id DESC` secondary tiebreaker.
3. **Public Search Scope (D3)**: Matches `Product.name`, relational `Category.name`, and `Product.subcategory`. `Product.description` is **strictly excluded**.
4. **Admin Catalog Bounds (D4)**: Default `pageSize = 20`, maximum `pageSize = 50`. Admin list queries (`AdminProductListDTO`) do not load full variant arrays; full variants load on-demand only for product edit/detail.
5. **Category & Subcategory UX (D5 & D9)**: Selecting a parent category immediately displays all its products. Subcategory is an optional refinement filter relationally scoped under `Category.id`. Cross-category or unscoped subcategories return empty results (`totalItems: 0`). No `Product.subcategoryId` migration in Phase 5.
6. **Result Metadata Envelope (D6)**: Every paginated endpoint returns `{ success: true, items: T[], page: number, pageSize: number, totalItems: number, totalPages: number, hasMore: boolean, nextPage: number | null }`. Count and item queries run concurrently via `Promise.all`.
7. **Read Model & DTO Separation (D7 & D8)**: `PublicProductCardDTO` includes `hasVariants: boolean` (computed on active variants without loading `variants[]` or N+1 queries) and omits `description` and `variants[]`. `PublicProductDetailDTO` returns active variants only and rejects inactive/deleted products with 404.
8. **Load-More URL & Restoration**: `page = N` represents results progressively revealed through logical page N. For `page <= 10`, direct navigation/refresh reconstructs pages `1..N` via bounded page-sized requests (`pageSize = 24`). For `page > 10`, client/server state normalizes to `page = 10` via history `replaceState` and restores through page 10.
9. **Defensive Input Safety**: `MAX_PUBLIC_PAGE = 10_000`, `MAX_ADMIN_PAGE = 10_000`. Requests exceeding maximum are rejected with HTTP 400 `INVALID_PAGE`. Skip arithmetic is guarded by `Number.isSafeInteger`.
10. **Admin Discount Predicate**: Exact business rule: `compareAtPrice IS NOT NULL AND compareAtPrice > price`.
11. **Homepage Bounded Reads**: All homepage product dependencies (New Arrivals `take: 1`, Hot Deals `findFirst`, Category thumbnails via `Category.image`, Subcategory thumbnails via single-batch representative query) must never load the complete active product table.
12. **Locked Phase 1–4 Invariants**: All admin mutations and admin views require `requireAdmin`. Inactive/deleted products never appear in public queries. Soft-delete historical protection, reservation delete guards (`PRODUCT_RESERVED_ACTIVE`, `VARIANT_RESERVED_ACTIVE`), variant stock authority / product aggregate mirror, PostgreSQL Decimal monetary precision, and checkout independence direct re-reads must remain 100% intact.

---

## Planned File Responsibility Map

| File Path | Action | Single Responsibility | Task Ownership |
|---|---|---|---|
| `lib/catalog/types.ts` | **CREATE** | Authoritative TypeScript interfaces for DTOs (`PublicProductCardDTO`, `PublicProductDetailDTO`, `AdminProductListDTO`, `AdminProductDetailDTO`), Query Inputs (`ParsedPublicCatalogParams`, `ParsedAdminCatalogParams`), and `PaginatedResult<T>`. | Task 1 |
| `lib/catalog/queryParams.ts` | **CREATE** | Pure parameter normalization, bounds clamping, slug validation regex, explicit `invalidFilter` state tracking, defensive page safety limits, and safe skip calculation. | Task 1 |
| `lib/catalog/progressiveCatalogState.ts` | **CREATE** | Pure client-state management for progressive catalog chunking, deduplication by ID, request generation / race safety, URL query formatting, and restoration normalization. | Task 1, Task 6 |
| `lib/catalog/publicCatalogQuery.ts` | **CREATE** | Database-side public catalog queries, relational category/subcategory resolution, deterministic sorting, concurrent `findMany` + `count`, and public detail lookup. | Task 2 |
| `lib/catalog/adminCatalogQuery.ts` | **CREATE** | Database-side admin catalog queries, server-side filters (including exact discount predicate), lightweight list projections, active variant counts, and full admin detail lookup. | Task 4 |
| `lib/catalog/homepageQueries.ts` | **CREATE** | Targeted homepage reads (New Arrivals promo, Hot Deals promo, and batched bounded subcategory representative images via single SQL query). | Task 8 |
| `lib/catalogRead.ts` | **MODIFY** | Bridge existing caching helper to wrap new catalog queries without altering memory-cache invariants. | Task 2, Task 8 |
| `lib/getProducts.ts` | **MODIFY** | Provide typed helper `getPaginatedProducts()` and maintain mapped detail functions. | Task 2, Task 9 |
| `app/api/products/route.ts` | **MODIFY** | Route handlers for `GET /api/products` (public paginated list, public detail, admin paginated list, admin detail) with strict parameter separation and auth enforcement. | Task 3, Task 7 |
| `components/shop/ProgressiveProductGrid.tsx` | **CREATE** | Client-side progressive Load More component consuming `progressiveCatalogState.ts`, handling +24 chunk fetches, URL history synchronization, and restoration. | Task 6 |
| `components/shop/LoadMoreProducts.tsx` | **MODIFY** | Refactor to wrap `ProgressiveProductGrid.tsx` maintaining backward component compatibility. | Task 6 |
| `app/shop/page.tsx` | **MODIFY** | Server Component reading `searchParams`, parsing via `parsePublicCatalogParams`, invoking `getPublicCatalogQuery`, and rendering initial Page 1. | Task 6 |
| `app/admin/products/page.tsx` | **MODIFY** | Update admin products dashboard to consume `AdminProductListDTO` envelope, server-side pagination, search/filter, and fetch `AdminProductDetailDTO` on Edit. | Task 7 |
| `app/admin/products/[id]/edit/page.tsx` | **MODIFY** | Update admin edit page to fetch `GET /api/products?view=admin&id=${productId}` for full `AdminProductDetailDTO`. | Task 7 |
| `app/page.tsx` | **MODIFY** | Replace unbounded `findMany` with targeted bounded homepage queries (`getHomepagePromos`, `getRepresentativeSubcategoryImages`). | Task 8 |
| `components/home/CategorySection.tsx` | **MODIFY** | Consume batched subcategory thumbnail image map instead of raw product array. | Task 8 |
| `components/home/HomePromoGrid.tsx` | **MODIFY** | Consume targeted newest and hot deal product props directly. | Task 8 |
| `app/sitemap.ts` | **MODIFY** | Bounded keyset traversal (`getSitemapProductRowsBatch`) emitting complete sitemap without memory spikes. | Task 9 |
| `app/admin/page.tsx` | **MODIFY** | Admin dashboard overview fetching lightweight counts instead of downloading full product arrays. | Task 9 |
| `components/shop/ShopProductGridClient.tsx` | **MODIFY** | Legacy client component updated to consume paginated API envelope. | Task 9 |
| `prisma/schema.prisma` | **MODIFY** | Candidate composite indexes added if and only if proven by evidence gate. | Task 5 |
| `tests/catalog-query-params.test.ts` | **CREATE** | Unit tests for query parameter parsing, normalization, bounds, slug syntax validation, and safe skip calculation. | Task 1 |
| `tests/catalog-progressive-state.test.ts` | **CREATE** | Unit tests for pure progressive Load More state, ID deduplication, race token cancellation, and restoration normalization. | Task 1 |
| `tests/public-catalog-query.test.ts` | **CREATE** | Database integration tests for public catalog queries, relational category/subcategory scoping, sorting, search, DTO shapes, and active `hasVariants`. | Task 2 |
| `tests/public-products-api.test.ts` | **CREATE** | API route integration tests for public paginated list and public product detail endpoints. | Task 3 |
| `tests/admin-products-api.test.ts` | **CREATE** | API route integration tests for admin paginated list, exact discount filter, active `variantCount`, and admin detail endpoint. | Task 4 |
| `tests/shop-load-more.test.ts` | **CREATE** | Integration tests for shop server rendering and progressive query parameters. | Task 6 |
| `tests/admin-products-ui.test.ts` | **CREATE** | Tests for admin products pagination query building and edit detail fetching. | Task 7 |
| `tests/homepage-bounded-reads.test.ts` | **CREATE** | Tests verifying bounded homepage queries and batched representative image retrieval. | Task 8 |
| `tests/catalog-consumer-migration.test.ts` | **CREATE** | Regression tests verifying all migrated consumers, sitemap keyset batching, and Decimal monetary authority. | Task 9 |

---

## Consumer Inventory & Migration Map

Every consumer of catalog data across the repository has been audited and mapped to an atomic migration task:

1. **`app/shop/page.tsx`**: Calls `getProducts()` and performs in-memory filtering. Migrated atomically in **Task 6** to use `parsePublicCatalogParams` + `getPublicCatalogQuery` + `ProgressiveProductGrid`.
2. **`app/product/[id]/page.tsx`**: Calls `getProductById(id)`. Migrated in **Task 2 / Task 9** to use `getPublicProductDetailQuery(id)`.
3. **`app/page.tsx`**: Calls unpaginated `prisma.product.findMany`. Migrated atomically in **Task 8** to use `getHomepagePromos()` and `getRepresentativeSubcategoryImages()`.
4. **`components/home/CategorySection.tsx`**: Consumes product array for subcategory thumbnails and has a fallback `fetch("/api/products")`. Migrated atomically in **Task 8** to consume the batched subcategory thumbnail map, with fallback extracting from the paginated envelope.
5. **`components/home/HomePromoGrid.tsx`**: Consumes product array for newest/hot deal and has a fallback `fetch("/api/products")`. Migrated atomically in **Task 8** to accept targeted promo product props directly.
6. **`components/shop/LoadMoreProducts.tsx`**: Slices in-memory product array. Refactored in **Task 6** to delegate to `ProgressiveProductGrid`.
7. **`components/shop/ShopProductGridClient.tsx`**: Legacy component fetching `/api/products?page=...`. Updated in **Task 9** to consume the paginated envelope `{ items, hasMore }`.
8. **`app/admin/products/page.tsx`**: Calls `fetch("/api/products?view=admin")` expecting full product list with variants. Migrated atomically in **Task 7** alongside the Admin API cutover to consume `AdminProductListDTO` and fetch `AdminProductDetailDTO` on Edit.
9. **`app/admin/products/[id]/edit/page.tsx`**: Calls `fetch("/api/products?id=...")`. Migrated in **Task 7** to `fetch("/api/products?view=admin&id=...")`.
10. **`app/admin/page.tsx`**: Calls `fetch("/api/products")` for dashboard counts. Migrated in **Task 9** to use targeted count queries.
11. **`app/sitemap.ts`**: Calls `getProducts()`. Migrated in **Task 9** to use keyset batching `getSitemapProductRowsBatch`.

---

## Test Database Safety Pattern

All Phase-5 tests executing database queries or query-plan benchmarks reuse the repository's fail-closed safety gate:

```ts
import { validateTestDatabaseSafety } from "./integration/db-safety";

const safety = validateTestDatabaseSafety();
if (!safety.safe) {
  console.warn(`[Phase 5 Test Skipped] ${safety.reason}`);
  process.exit(0); // Gracefully skip in environments without dedicated test database
}
```

**Invariants:**
- `DATABASE_URL_TEST` must exist and be distinct from `DATABASE_URL`.
- Default/production `DATABASE_URL` is **never** touched during tests.
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
- Produces: Normalized `ParsedPublicCatalogParams`, `ParsedAdminCatalogParams`, DTO types, and pure Load More state transitions.

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
    const skip = Number.isSafeInteger(skipNum) ? skipNum : 0;

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
    const skip = Number.isSafeInteger(skipNum) ? skipNum : 0;

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

### Task 2: Public Database Catalog Reads & Scoped Query Pipeline (Wave B)

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
  - Verify `validateTestDatabaseSafety()`.
  - Test pagination chunking: page 1 returns 24 items, page 2 returns items 25–48 with zero ID overlap.
  - Test `invalidFilter: true` immediately returns `{ success: true, items: [], totalItems: 0 }` without hitting products table.
  - Test deterministic sorting: `latest` (`id DESC`), `price-asc` (`price ASC, id DESC`), `price-desc` (`price DESC, id DESC`).
  - Test relational category slug resolution: queries `Product.categoryId = Category.id`.
  - Test scoped subcategory validation: valid subcategory under parent category filters correctly; cross-category or unscoped subcategory returns `totalItems: 0` and `items: []`.
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

    // Category & Subcategory relational resolution
    if (params.category) {
      const categories = await getCachedCategoryRows(false);
      const matchedCategory = categories.find((c) => c.slug === params.category);
      if (!matchedCategory) {
        return { success: true, items: [], page: params.page, pageSize: params.pageSize, totalItems: 0, totalPages: 0, hasMore: false, nextPage: null };
      }
      where.categoryId = matchedCategory.id;

      if (params.subcategory) {
        const matchedSub = matchedCategory.subcategories?.find((s) => s.slug === params.subcategory && s.isActive);
        if (!matchedSub) {
          return { success: true, items: [], page: params.page, pageSize: params.pageSize, totalItems: 0, totalPages: 0, hasMore: false, nextPage: null };
        }
        where.subcategory = { equals: matchedSub.slug, mode: "insensitive" };
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
- [ ] **Step 2.8: Run catalog safety suite**
  ```bash
  npx tsx --test tests/catalog-safety.test.ts
  ```
- [ ] **Step 2.9: Commit Task 2**
  ```bash
  git diff --check
  git add lib/catalog/publicCatalogQuery.ts lib/catalogRead.ts lib/getProducts.ts tests/public-catalog-query.test.ts
  git commit -m "feat(phase5): implement bounded public catalog queries and DTO projections"
  ```

---

### Task 3: Public API Contract Cutover & Atomic Consumer Migration (Wave C)

**Files:**
- Modify: `app/api/products/route.ts`
- Modify: `components/home/CategorySection.tsx`
- Modify: `components/home/HomePromoGrid.tsx`
- Modify: `components/shop/ShopProductGridClient.tsx`
- Test: `tests/public-products-api.test.ts`

**Interfaces:**
- Consumes: HTTP GET requests to `/api/products` (public views).
- Produces: Locked API contracts (A & B), updated self-fetch fallbacks.

**Steps:**
- [ ] **Step 3.1: Write failing API route test in `tests/public-products-api.test.ts`**
  - Test `GET /api/products?view=public&page=1&pageSize=24` returns paginated envelope with `PublicProductCardDTO[]`.
  - Test `GET /api/products` (no view parameter) defaults to public paginated Page 1 (never returns unbounded array).
  - Test `GET /api/products?id=123` returns `{ success: true, product: PublicProductDetailDTO }` with active variants only.
  - Test `GET /api/products?id=999` (inactive or deleted product) returns HTTP 404.
  - Test `GET /api/products?page=10001` returns HTTP 400 with `{ success: false, code: "INVALID_PAGE" }`.
- [ ] **Step 3.2: Run test to confirm RED**
  ```bash
  npx tsx --test tests/public-products-api.test.ts
  ```
- [ ] **Step 3.3: Implement public API routes in `app/api/products/route.ts`**
  - In `GET` handler:
    - If `searchParams.has("id")`: resolve `id`, call `getPublicProductDetailQuery(id)`. If null, return 404.
    - If not `view=admin`: parse params with `parsePublicCatalogParams`, call `getPublicCatalogQuery`, return JSON envelope with `publicCacheHeaders()`.
  - Catch `CatalogQueryParamError` and return HTTP 400 with `{ success: false, code: error.code, message: error.message }`.
- [ ] **Step 3.4: Atomically update public components that call `fetch("/api/products")`**
  - In `components/home/CategorySection.tsx`: update `loadData()` to parse `productPayload.data?.items || productPayload.data?.products`.
  - In `components/home/HomePromoGrid.tsx`: update `loadData()` to parse `productData?.items || productData?.products`.
  - In `components/shop/ShopProductGridClient.tsx`: update to parse `data?.items || data?.products`.
- [ ] **Step 3.5: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/public-products-api.test.ts
  ```
- [ ] **Step 3.6: Run catalog safety suite**
  ```bash
  npx tsx --test tests/catalog-safety.test.ts
  ```
- [ ] **Step 3.7: Commit Task 3**
  ```bash
  git diff --check
  git add app/api/products/route.ts components/home/ components/shop/ tests/public-products-api.test.ts
  git commit -m "feat(phase5): cut over public catalog API contracts and migrate public callers"
  ```

---

### Task 4: Admin Catalog Read Model & Exact Discount Predicate (Wave D)

**Files:**
- Create: `lib/catalog/adminCatalogQuery.ts`
- Test: `tests/admin-products-api.test.ts`

**Interfaces:**
- Consumes: `ParsedAdminCatalogParams`, PostgreSQL database via Prisma client.
- Produces: `PaginatedResult<AdminProductListDTO>`, `AdminProductDetailDTO`.

**Steps:**
- [ ] **Step 4.1: Create compile-safe scaffold for `lib/catalog/adminCatalogQuery.ts`**
  - Export stubs for `getAdminCatalogQuery` and `getAdminProductDetailQuery` throwing `Error("NOT_YET_IMPLEMENTED")`.
- [ ] **Step 4.2: Write failing unit/integration tests in `tests/admin-products-api.test.ts`**
  - Verify `validateTestDatabaseSafety()`.
  - Test admin discount filter `filter=discount`: matches strictly `compareAtPrice IS NOT NULL AND compareAtPrice > price`.
  - Test admin filters: `filter=hot`, `filter=upcoming`, `filter=badge`.
  - Test projection: verifies `variantCount` counts active variants only, `description` and full `variants[]` omitted.
  - Test admin detail `getAdminProductDetailQuery(id)`: returns all variants (active and inactive) and audit fields.
- [ ] **Step 4.3: Run test to confirm behavioral RED (NOT_YET_IMPLEMENTED)**
  ```bash
  npx tsx --test tests/admin-products-api.test.ts
  ```
- [ ] **Step 4.4: Implement `lib/catalog/adminCatalogQuery.ts`**
  ```ts
  export async function getAdminCatalogQuery(params: ParsedAdminCatalogParams): Promise<PaginatedResult<AdminProductListDTO>> {
    const where: any = {};

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
- [ ] **Step 4.5: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/admin-products-api.test.ts
  ```
- [ ] **Step 4.6: Commit Task 4**
  ```bash
  git diff --check
  git add lib/catalog/adminCatalogQuery.ts tests/admin-products-api.test.ts
  git commit -m "feat(phase5): implement admin catalog query model and exact discount predicate"
  ```

---

### Task 5: Database Index Evidence Gate & Query-Plan Verification (Wave E)

**Files:**
- Modify: `prisma/schema.prisma` (if and only if justified by evidence)
- Create: `prisma/migrations/...` (if and only if justified by evidence)

**Interfaces:**
- Consumes: Real PostgreSQL query execution plans via `EXPLAIN (ANALYZE, BUFFERS)`.
- Produces: Query-proven composite indexes in Prisma schema and migration SQL.

**Steps:**
- [ ] **Step 5.1: Verify test database safety**
  - Check `validateTestDatabaseSafety()`. If not safe, abort evidence benchmark.
- [ ] **Step 5.2: Execute baseline query plan measurements on synthetic catalog**
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
  - If evidence justifies new composite indexes, add them to `model Product` and run `npx prisma migrate dev --name phase5_catalog_indexes`.
  - If no candidate index provides measurable improvement over existing indexes, leave `prisma/schema.prisma` unchanged and record evidence.
- [ ] **Step 5.5: Commit Task 5**
  ```bash
  git diff --check
  git add prisma/
  git commit -m "perf(phase5): apply query-proven catalog composite indexes" # or docs(phase5): record index plan evidence if 0 indexes added
  ```

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
- [ ] **Step 6.1: Write integration tests in `tests/shop-load-more.test.ts`**
  - Test initial render delivers Page 1 (24 items).
  - Test client fetch requests `page = 2` with `pageSize = 24`.
  - Test duplicate product IDs are rejected during array merge.
  - Test filter/sort change resets state to `page = 1`.
  - Test restoration logic: for `page <= 10`, fetches pages `1..N` via controlled `pageSize = 24` requests; for `page > 10`, normalizes URL/state to `page = 10` via `replaceState` and restores through page 10.
- [ ] **Step 6.2: Implement `components/shop/ProgressiveProductGrid.tsx`**
  - Import `deduplicateProducts`, `computeRestorationTarget`, `createProgressiveQueryUrl` from `lib/catalog/progressiveCatalogState.ts`.
  - Maintain request generation counter / `AbortController` to prevent race conditions from stale queries.
  - Disable Load More button while `loading = true`.
  - Use `window.history.pushState` or Next router to keep `page = N` in URL.
  - Render ProductCard grid preserving current UI styling.
- [ ] **Step 6.3: Refactor `components/shop/LoadMoreProducts.tsx`**
  - Forward props to `ProgressiveProductGrid.tsx`.
- [ ] **Step 6.4: Update `app/shop/page.tsx`**
  - Parse `searchParams` with `parsePublicCatalogParams`.
  - Call `getPublicCatalogQuery(parsedParams)` directly on the server.
  - Pass the resulting `PaginatedResult` envelope directly to `ProgressiveProductGrid`.
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

### Task 7: Admin Products UI Server-Side Pagination & Atomic API Cutover (Wave G)

**Files:**
- Modify: `app/api/products/route.ts`
- Modify: `app/admin/products/page.tsx`
- Modify: `app/admin/products/[id]/edit/page.tsx`
- Test: `tests/admin-products-ui.test.ts`

**Interfaces:**
- Consumes: `GET /api/products?view=admin&page=...` (list) and `GET /api/products?view=admin&id=...` (edit detail).
- Produces: Paginated admin product table with server-side filters and on-demand detail editing.

**Steps:**
- [ ] **Step 7.1: Write integration tests in `tests/admin-products-ui.test.ts`**
  - Test admin table fetches `page=1&pageSize=20`.
  - Test clicking Next/Prev or page numbers requests corresponding server page.
  - Test filter tabs (`all`, `hot`, `upcoming`, `discount`, `badge`) trigger server-side query.
  - Test clicking "Edit" issues `GET /api/products?view=admin&id=123` to load full editable variants.
- [ ] **Step 7.2: Update `app/api/products/route.ts` to cut over Admin API**
  - In `GET` handler:
    - If `view === "admin"`:
      - Require admin session (`requireAdmin(req)`).
      - If `id`: call `getAdminProductDetailQuery(id)`. Return `{ success: true, product: AdminProductDetailDTO }`.
      - If list: parse with `parseAdminCatalogParams`, call `getAdminCatalogQuery(parsedParams)`. Return `PaginatedResult<AdminProductListDTO>`.
- [ ] **Step 7.3: Atomically update `app/admin/products/page.tsx`**
  - Update `loadProducts(page = 1, filter = "all", query = "")` to fetch `/api/products?view=admin&page=${page}&pageSize=20&filter=${filter}&q=${encodeURIComponent(query)}`.
  - Store `items: AdminProductListDTO[]`, `page`, `totalPages`, `totalItems`.
  - Add Previous / Next / Page Number pagination controls to the admin product list.
  - Refactor `startEdit(productId: number)`: fetch `GET /api/products?view=admin&id=${productId}` to populate the edit form and variant rows with complete `AdminProductDetailDTO`.
- [ ] **Step 7.4: Update `app/admin/products/[id]/edit/page.tsx`**
  - Update `fetch(/api/products?id=...)` to `fetch(/api/products?view=admin&id=${productId})`.
- [ ] **Step 7.5: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/admin-products-ui.test.ts
  ```
- [ ] **Step 7.6: Run catalog safety tests**
  ```bash
  npx tsx --test tests/catalog-safety.test.ts
  ```
- [ ] **Step 7.7: Commit Task 7**
  ```bash
  git diff --check
  git add app/api/products/route.ts app/admin/products/page.tsx app/admin/products/[id]/edit/page.tsx tests/admin-products-ui.test.ts
  git commit -m "feat(phase5): paginate admin products UI with server-side filters and atomic API cutover"
  ```

---

### Task 8: Homepage Bounded Catalog Reads & Batched Thumbnail Resolution (Wave H)

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
- [ ] **Step 8.1: Create compile-safe scaffold for `lib/catalog/homepageQueries.ts`**
  - Export stubs for `getHomepagePromos` and `getRepresentativeSubcategoryImages` throwing `Error("NOT_YET_IMPLEMENTED")`.
- [ ] **Step 8.2: Write failing behavioral test in `tests/homepage-bounded-reads.test.ts`**
  - Test New Arrivals query fetches at most 1 product (`take: 1`).
  - Test Hot Deals query fetches at most 1 product (`findFirst`).
  - Test subcategory thumbnail query fetches representative images via a single batched query with zero full-table scans and zero N+1 queries.
  - Test lifecycle exclusions: inactive/deleted products are excluded.
- [ ] **Step 8.3: Run test to confirm behavioral RED (NOT_YET_IMPLEMENTED)**
  ```bash
  npx tsx --test tests/homepage-bounded-reads.test.ts
  ```
- [ ] **Step 8.4: Implement `lib/catalog/homepageQueries.ts`**
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
      SELECT DISTINCT ON (c."slug", p."subcategory")
        c."slug" AS "categorySlug",
        p."subcategory" AS "subcategorySlug",
        p."image"
      FROM "Product" p
      JOIN "Category" c ON p."categoryId" = c."id"
      WHERE p."isActive" = true
        AND p."deletedAt" IS NULL
        AND c."isActive" = true
        AND p."subcategory" IS NOT NULL
        AND p."image" IS NOT NULL
        AND p."image" <> ''
      ORDER BY c."slug", p."subcategory", p."id" DESC;
    `;

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[`${row.categorySlug.toLowerCase()}:${row.subcategorySlug.toLowerCase()}`] = row.image;
    }
    return map;
  }
  ```
- [ ] **Step 8.5: Update `app/page.tsx`, `HomePromoGrid.tsx`, and `CategorySection.tsx`**
  - `app/page.tsx`: replace unpaginated `prisma.product.findMany` with `getHomepagePromos()` and `getRepresentativeSubcategoryImages()`.
  - `HomePromoGrid.tsx`: accept `newestProduct` and `hotDealProduct` directly as props, preserving all existing promo tiles (`Top Picks`, `New Arrivals`, `Hot Deals`).
  - `CategorySection.tsx`: accept `subcategoryImageMap` directly as props; resolve subcategory thumbnail via map lookup with fallback to `Category.image`.
- [ ] **Step 8.6: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/homepage-bounded-reads.test.ts
  ```
- [ ] **Step 8.7: Commit Task 8**
  ```bash
  git diff --check
  git add lib/catalog/homepageQueries.ts app/page.tsx components/home/ tests/homepage-bounded-reads.test.ts
  git commit -m "perf(phase5): bound homepage catalog reads and batch subcategory thumbnail resolution"
  ```

---

### Task 9: Backward-Compatibility Consumer Migration, Keyset Sitemap & Decimal Authority (Wave I)

**Files:**
- Modify: `app/sitemap.ts`
- Modify: `app/admin/page.tsx`
- Modify: `components/shop/ShopProductGridClient.tsx`
- Modify: `lib/getProducts.ts`
- Test: `tests/catalog-consumer-migration.test.ts`

**Interfaces:**
- Consumes: All internal consumers of products.
- Produces: Fully migrated, bounded call sites with zero unbounded legacy endpoints.

**Steps:**
- [ ] **Step 9.1: Write migration regression tests in `tests/catalog-consumer-migration.test.ts`**
  - Test keyset batched sitemap traversal: emits all active product URLs across multiple 1000-item batches without memory spikes.
  - Test admin dashboard count queries execute without loading full product tables into memory.
  - Test Decimal monetary authority: PostgreSQL Decimal remains authoritative; DTO JavaScript `Number` is presentation-only; checkout (`POST /api/orders`) re-reads authoritative Decimal prices and stock from PostgreSQL.
- [ ] **Step 9.2: Run test to confirm RED**
  ```bash
  npx tsx --test tests/catalog-consumer-migration.test.ts
  ```
- [ ] **Step 9.3: Migrate all internal consumers**
  - In `lib/catalog/publicCatalogQuery.ts`, implement `getSitemapProductRowsBatch({ afterId, take = 1000 })`.
  - In `app/sitemap.ts`: loop `getSitemapProductRowsBatch` with keyset ID traversal until all products are collected for the sitemap.
  - In `app/admin/page.tsx`: replace `fetch("/api/products")` with targeted count queries (or admin paginated metadata query).
  - In `components/shop/ShopProductGridClient.tsx`: update to consume paginated API contract `{ items, totalItems, hasMore }`.
- [ ] **Step 9.4: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/catalog-consumer-migration.test.ts
  ```
- [ ] **Step 9.5: Run full repository test suite**
  ```bash
  npm test
  ```
- [ ] **Step 9.6: Commit Task 9**
  ```bash
  git diff --check
  git add app/sitemap.ts app/admin/page.tsx components/shop/ lib/getProducts.ts lib/catalog/publicCatalogQuery.ts tests/catalog-consumer-migration.test.ts
  git commit -m "refactor(phase5): migrate internal catalog consumers and enforce Decimal authority"
  ```

---

### Task 10: Full Regression Verification & Responsive Real Browser QA (Wave J)

**Files:**
- Verification only across all test suites and browser viewports.

**Interfaces:**
- Consumes: Complete public, admin, and homepage catalog flows.
- Produces: 100% automated test pass, zero new lint regressions, and visual browser verification report.

**Steps:**
- [ ] **Step 10.1: Run complete automated test suite**
  ```bash
  npm test
  ```
  Assert 100% test pass with 0 failures across all existing Phase 1–4 tests and new Phase 5 suites.
- [ ] **Step 10.2: Run TypeScript and Prisma validation**
  ```bash
  npx tsc --noEmit
  npx prisma validate
  ```
- [ ] **Step 10.3: Run scoped ESLint on newly created/modified Phase 5 files**
  ```bash
  npx eslint lib/catalog/ components/shop/ tests/
  ```
  Verify zero new Phase-5 lint regressions.
- [ ] **Step 10.4: Perform responsive browser QA using Chrome DevTools MCP on isolated synthetic test fixture**
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
    - Navigate to `/product/1`. Verify active variants and description render.
    - Verify inactive/deleted product returns 404.
  - **Admin Products QA Flow**:
    - Log in as admin. Navigate to `/admin/products`.
    - Verify server-side paginated table (20 per page) with Next/Prev controls.
    - Test filters: `Hot Deals`, `Upcoming`, `Discounted`, `Image Badges`.
    - Create a test synthetic product `PHASE5-QA-PRODUCT`. Click "Edit" and verify full editable variants and description load cleanly. Clean up synthetic product afterwards.
  - **Homepage QA Flow**:
    - Navigate to `/`. Verify New Arrivals promo, Hot Deals promo, and Category/Subcategory thumbnails render correctly with zero console errors.
- [ ] **Step 10.5: Run production build verification**
  ```bash
  npm run build
  ```
- [ ] **Step 10.6: Verification complete**
  - Confirm all verification gates passed. No empty commit created for verification step.

---

## Plan Self-Review Checklist

- [x] **No Invalid Slug Unfiltered Bug**: `ParsedPublicCatalogParams` has explicit `invalidFilter: boolean` flag. If `invalidFilter: true`, `getPublicCatalogQuery` immediately returns empty envelope without hitting products table.
- [x] **Behavioral RED**: All newly created modules have compile-safe scaffolds throwing typed `Error("NOT_YET_IMPLEMENTED")` so tests fail on behavioral assertion, not module-not-found.
- [x] **Interface Signature Consistency**: `parsePublicCatalogParams` and `parseAdminCatalogParams` strictly feed `getPublicCatalogQuery` and `getAdminCatalogQuery` with safe skip and bounds.
- [x] **Atomic API Cutovers**: Public API cutover + public caller migrations are in Task 3; Admin API cutover + Admin UI migrations are in Task 7. Zero broken intermediate commits.
- [x] **Exact Consumer Inventory**: Complete 11-point inventory audited and mapped.
- [x] **Test DB Safety Gate**: Uses `validateTestDatabaseSafety()` fail-closed check on `DATABASE_URL_TEST`.
- [x] **Index Evidence Gate**: Candidate composite indexes evaluated via `EXPLAIN (ANALYZE, BUFFERS)` on test database; non-destructive migration only if proven.
- [x] **No Generic Prisma Distinct**: Single-batch SQL `DISTINCT ON` query used for subcategory representative images.
- [x] **Keyset Sitemap**: Keyset ID batching (`take: 1000`) emits complete sitemap without memory spikes.
- [x] **UI Test Strategy**: Pure Load More state extracted to `progressiveCatalogState.ts` and tested with `node:test`; integration verified via Chrome DevTools MCP.
- [x] **Load More Race Safety**: Request generation token and disabled state prevent stale/concurrent query races.
- [x] **Complete File Map**: Every created, modified, and test file is accurately listed.
- [x] **Phase 1–4 Invariants**: Admin auth (`requireAdmin`), soft delete, reservation delete guards, variant stock authority / product aggregate mirror, Decimal precision, and checkout independence re-reads are 100% protected.
- [x] **Phase Boundaries**: Strictly isolated from Phases 6–9.
