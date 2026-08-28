# Phase 5 Catalog Scalability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved bounded, server-authoritative Phase-5 catalog architecture without changing the Phase-1–4 commerce, security, inventory, or relational invariants.

**Architecture:** Replace unpaginated full-table scans with server-authoritative bounded pagination, relational category slug resolution, scoped subcategory filtering, deterministic sorting, and minimal DTO projections across public and admin catalog subsystems. Implement progressive client-side chunk loading (+24 items) with URL state synchronization, a cold-reload restoration safety cap (`MAX_RESTORABLE_PUBLIC_PAGE = 10`), and an evidence-gated PostgreSQL composite index strategy. Preserve PostgreSQL Decimal precision and checkout independence.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Prisma 7, PostgreSQL/Neon, Node.js native test runner (`tsx --test`).

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
11. **Homepage Bounded Reads**: All homepage product dependencies (New Arrivals `take: 1`, Hot Deals `findFirst`, Category thumbnails via `Category.image`, Subcategory thumbnails via batched bounded representative query) must never load the complete active product table.
12. **Locked Phase 1–4 Invariants**: All admin mutations and admin views require `requireAdmin`. Inactive/deleted products never appear in public queries. Soft-delete historical protection, reservation delete guards (`PRODUCT_RESERVED_ACTIVE`, `VARIANT_RESERVED_ACTIVE`), variant stock authority / product aggregate mirror, PostgreSQL Decimal monetary precision, and checkout independence direct re-reads must remain 100% intact.

---

## Planned File Responsibility Map

| File Path | Action | Single Responsibility | Task Ownership |
|---|---|---|---|
| `lib/catalog/types.ts` | **CREATE** | Authoritative TypeScript interfaces for DTOs (`PublicProductCardDTO`, `PublicProductDetailDTO`, `AdminProductListDTO`, `AdminProductDetailDTO`), Query Options, and `PaginatedResult<T>`. | Task 1 |
| `lib/catalog/queryParams.ts` | **CREATE** | Pure parameter normalization, bounds clamping, slug validation regex, defensive page safety limits, and safe skip calculation. | Task 1 |
| `lib/catalog/publicCatalogQuery.ts` | **CREATE** | Database-side public catalog queries, relational category/subcategory resolution, deterministic sorting, concurrent `findMany` + `count`, and public detail lookup. | Task 2, Task 3 |
| `lib/catalog/adminCatalogQuery.ts` | **CREATE** | Database-side admin catalog queries, server-side filters (including exact discount predicate), lightweight list projections, active variant counts, and full admin detail lookup. | Task 4 |
| `lib/catalog/homepageQueries.ts` | **CREATE** | Targeted homepage reads (New Arrivals promo, Hot Deals promo, and batched bounded subcategory representative images). | Task 8 |
| `lib/catalogRead.ts` | **MODIFY** | Bridge existing caching helper to wrap new catalog queries without altering memory-cache invariants. | Task 2, Task 8 |
| `lib/getProducts.ts` | **MODIFY** | Provide typed helper `getPaginatedProducts()` and maintain backwards-compatible mapped detail functions. | Task 2, Task 9 |
| `app/api/products/route.ts` | **MODIFY** | Route handlers for `GET /api/products` (public paginated list, public detail, admin paginated list, admin detail) with strict parameter separation and auth enforcement. | Task 3, Task 4 |
| `prisma/schema.prisma` | **MODIFY** | Candidate composite indexes added if and only if verified by query-plan evidence gate. | Task 5 |
| `components/shop/ProgressiveProductGrid.tsx` | **CREATE** | Client-side progressive Load More component handling +24 chunks, URL history synchronization, state restoration through `MAX_RESTORABLE_PUBLIC_PAGE = 10`, and ID deduplication. | Task 6 |
| `components/shop/LoadMoreProducts.tsx` | **MODIFY** | Refactor/forward to `ProgressiveProductGrid.tsx` to maintain backward component compatibility. | Task 6 |
| `app/shop/page.tsx` | **MODIFY** | Server Component reading `searchParams`, invoking `getPublicCatalogQuery`, and passing initial Page 1 envelope to `ProgressiveProductGrid`. | Task 6 |
| `app/admin/products/page.tsx` | **MODIFY** | Update admin products dashboard to consume `AdminProductListDTO` envelope, server-side pagination, search/filter, and fetch `AdminProductDetailDTO` on Edit. | Task 7 |
| `app/page.tsx` | **MODIFY** | Replace unbounded `findMany` with targeted bounded homepage queries (`getHomepagePromos`, `getRepresentativeSubcategoryImages`). | Task 8 |
| `components/home/CategorySection.tsx` | **MODIFY** | Consume batched subcategory thumbnail image map instead of raw product array. | Task 8 |
| `components/home/HomePromoGrid.tsx` | **MODIFY** | Consume targeted newest and hot deal product props directly. | Task 8 |
| `tests/catalog-query-params.test.ts` | **CREATE** | Unit tests for query parameter parsing, normalization, bounds, slug syntax validation, and safe skip calculation. | Task 1 |
| `tests/public-catalog-query.test.ts` | **CREATE** | Database integration tests for public catalog queries, relational category/subcategory scoping, sorting, search, DTO shapes, and active `hasVariants`. | Task 2 |
| `tests/public-products-api.test.ts` | **CREATE** | API route integration tests for public paginated list and public product detail endpoints. | Task 3 |
| `tests/admin-products-api.test.ts` | **CREATE** | API route integration tests for admin paginated list, exact discount filter, active `variantCount`, and admin detail endpoint. | Task 4 |
| `tests/homepage-bounded-reads.test.ts` | **CREATE** | Tests verifying bounded homepage queries and batched representative image retrieval. | Task 8 |
| `tests/catalog-consumer-migration.test.ts` | **CREATE** | Regression tests verifying all migrated consumers and Decimal monetary authority. | Task 9 |

---

## Implementation Tasks

### Task 1: Query Parameter Parsing, Normalization & DTO Foundations (Wave A)

**Files:**
- Create: `lib/catalog/types.ts`
- Create: `lib/catalog/queryParams.ts`
- Test: `tests/catalog-query-params.test.ts`

**Interfaces:**
- Consumes: Raw URL query parameters (`searchParams` or URL strings).
- Produces: Normalized `PublicCatalogQueryInput`, `AdminCatalogQueryInput`, `PaginatedResult<T>`, and DTO type definitions.

**Steps:**
- [ ] **Step 1.1: Write failing unit test for query parameter parsing and normalization**
  ```ts
  // tests/catalog-query-params.test.ts
  import { describe, it } from "node:test";
  import assert from "node:assert/strict";
  import { parsePublicCatalogParams, parseAdminCatalogParams } from "@/lib/catalog/queryParams";

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
    });

    it("clamps public pageSize to max 48 and normalizes invalid page to 1", () => {
      const parsed = parsePublicCatalogParams({ page: "-5", pageSize: "500" });
      assert.strictEqual(parsed.page, 1);
      assert.strictEqual(parsed.pageSize, 48);
      assert.strictEqual(parsed.skip, 0);
    });

    it("rejects page > MAX_PUBLIC_PAGE (10,000) with error code INVALID_PAGE", () => {
      assert.throws(() => parsePublicCatalogParams({ page: "10001" }), {
        name: "CatalogQueryParamError",
        message: "INVALID_PAGE",
      });
    });

    it("validates and normalizes slug syntax against regex", () => {
      const valid = parsePublicCatalogParams({ category: "Skin-Care-2026" });
      assert.strictEqual(valid.category, "skin-care-2026");

      const invalid = parsePublicCatalogParams({ category: "invalid/slug*!" });
      assert.strictEqual(invalid.category, null); // Invalid slug normalized to null (causes empty search)
    });

    it("clamps admin pageSize to default 20 and max 50", () => {
      const def = parseAdminCatalogParams({});
      assert.strictEqual(def.pageSize, 20);

      const max = parseAdminCatalogParams({ pageSize: "100" });
      assert.strictEqual(max.pageSize, 50);
    });
  });
  ```
- [ ] **Step 1.2: Run test to confirm RED**
  ```bash
  npx tsx --test tests/catalog-query-params.test.ts
  ```
- [ ] **Step 1.3: Create DTO interfaces in `lib/catalog/types.ts`**
  ```ts
  export type PublicProductCardDTO = {
    id: number;
    name: string;
    price: number;
    compareAtPrice: number | null;
    image: string;
    category: string;
    stock: number;
    isHotDeal: boolean;
    isUpcoming: boolean;
    badgeText: string | null;
    badgeTone: string;
    hasVariants: boolean;
  };

  export type PublicProductVariantDTO = {
    id: number;
    label: string;
    price: number;
    stock: number;
    image: string | null;
  };

  export type PublicProductDetailDTO = PublicProductCardDTO & {
    categoryId: number | null;
    subcategory: string | null;
    description: string | null;
    variants: PublicProductVariantDTO[];
  };

  export type AdminProductListDTO = {
    id: number;
    name: string;
    price: number;
    compareAtPrice: number | null;
    image: string;
    category: string;
    categoryId: number | null;
    subcategory: string | null;
    stock: number;
    isHotDeal: boolean;
    isUpcoming: boolean;
    badgeText: string | null;
    badgeTone: string;
    isActive: boolean;
    createdAt: string;
    variantCount: number;
    hasVariants: boolean;
  };

  export type AdminProductVariantDTO = {
    id: number;
    productId: number;
    label: string;
    price: number;
    stock: number;
    image: string | null;
    isActive: boolean;
    sortOrder: number;
  };

  export type AdminProductDetailDTO = AdminProductListDTO & {
    description: string | null;
    deletedAt: string | null;
    updatedAt: string;
    variants: AdminProductVariantDTO[];
  };

  export type PaginatedResult<T> = {
    success: true;
    items: T[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
    nextPage: number | null;
  };

  export type PublicSortMode = "latest" | "price-asc" | "price-desc";

  export type PublicCatalogQueryInput = {
    page: number;
    pageSize: number;
    sort: PublicSortMode;
    category: string | null;
    subcategory: string | null;
    q: string | null;
    skip: number;
  };

  export type AdminCatalogQueryInput = {
    page: number;
    pageSize: number;
    filter: "all" | "hot" | "upcoming" | "discount" | "badge";
    q: string | null;
    skip: number;
  };
  ```
- [ ] **Step 1.4: Implement parameter normalization in `lib/catalog/queryParams.ts`**
  - Implement `SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`.
  - Validate `MAX_PUBLIC_PAGE = 10_000` and `MAX_ADMIN_PAGE = 10_000`.
  - Validate safe skip arithmetic with `Number.isSafeInteger((page - 1) * pageSize)`.
- [ ] **Step 1.5: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/catalog-query-params.test.ts
  ```
- [ ] **Step 1.6: Verify clean git diff and commit**
  ```bash
  git diff --check
  git add lib/catalog/types.ts lib/catalog/queryParams.ts tests/catalog-query-params.test.ts
  git commit -m "feat(phase5): add catalog types and query parameter normalization"
  ```

---

### Task 2: Public Database Catalog Reads & Scoped Query Pipeline (Wave B)

**Files:**
- Create: `lib/catalog/publicCatalogQuery.ts`
- Modify: `lib/catalogRead.ts`
- Modify: `lib/getProducts.ts`
- Test: `tests/public-catalog-query.test.ts`

**Interfaces:**
- Consumes: `PublicCatalogQueryInput`, PostgreSQL database via Prisma client.
- Produces: `PaginatedResult<PublicProductCardDTO>`, `PublicProductDetailDTO`.

**Steps:**
- [ ] **Step 2.1: Write failing database integration test for public queries**
  - Test pagination chunking: page 1 returns 24 items, page 2 returns items 25–48 with zero ID overlap.
  - Test sorting: `latest` sorts by `id DESC`, `price-asc` sorts by `price ASC, id DESC` (tiebreaker), `price-desc` sorts by `price DESC, id DESC`.
  - Test relational category slug resolution: queries `Product.categoryId = Category.id`.
  - Test scoped subcategory filter: valid subcategory under parent category filters correctly; cross-category or unscoped subcategory returns `totalItems: 0` and `items: []`.
  - Test immediate parent category display: selecting parent category returns all its products without requiring a subcategory.
  - Test search scope: matches `Product.name`, `Category.name`, `Product.subcategory`, and excludes `Product.description`.
  - Test DTO projection: asserts `PublicProductCardDTO` has `hasVariants: boolean` (reflecting active variants only) and omits `description` and `variants[]`. No N+1 queries.
  - Test lifecycle filter: asserts `isActive = false` or `deletedAt != null` products are never returned.
- [ ] **Step 2.2: Run test to confirm RED**
  ```bash
  npx tsx --test tests/public-catalog-query.test.ts
  ```
- [ ] **Step 2.3: Implement `getPublicCatalogQuery` in `lib/catalog/publicCatalogQuery.ts`**
  - Category resolution: Validate category slug against active cached categories (`getCachedCategoryRows(false)`). If invalid/unmatched, return empty envelope `{ success: true, items: [], page, pageSize, totalItems: 0, totalPages: 0, hasMore: false, nextPage: null }`.
  - Subcategory resolution: If `subcategory` is present, ensure `category` is present and verify subcategory exists under `category.id` with `isActive = true`. If not, return empty envelope.
  - WHERE clause: enforce `isActive: true, deletedAt: null`. Add `categoryId: category.id` (and `subcategory: subcategorySlug` if refined).
  - Search predicate: if `q` present, construct parameterized `OR: [{ name: { contains: q, mode: "insensitive" } }, { subcategory: { contains: q, mode: "insensitive" } }, { categoryRel: { name: { contains: q, mode: "insensitive" } } }]`.
  - Sorting: construct deterministic Prisma `orderBy` array with secondary `{ id: "desc" }`.
  - Execute concurrent `Promise.all([findManyTask, countTask])`.
  - Select only card fields + `_count: { select: { variants: { where: { isActive: true } } } }`.
  - Map rows to `PublicProductCardDTO` with `hasVariants = row._count.variants > 0`.
  - Format monetary numbers using `Number(row.price)` for presentation.
- [ ] **Step 2.4: Implement `getPublicProductDetailQuery(id)` in `lib/catalog/publicCatalogQuery.ts`**
  - Enforce `where: { id, isActive: true, deletedAt: null }`.
  - Include `variants: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }`.
  - Return `PublicProductDetailDTO` or `null` if not found.
- [ ] **Step 2.5: Update `lib/getProducts.ts` to export `getPaginatedProducts`**
- [ ] **Step 2.6: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/public-catalog-query.test.ts
  ```
- [ ] **Step 2.7: Run existing regression tests**
  ```bash
  npx tsx --test tests/catalog-safety.test.ts
  ```
- [ ] **Step 2.8: Commit Task 2**
  ```bash
  git diff --check
  git add lib/catalog/publicCatalogQuery.ts lib/catalogRead.ts lib/getProducts.ts tests/public-catalog-query.test.ts
  git commit -m "feat(phase5): implement bounded public catalog queries and DTO projections"
  ```

---

### Task 3: Public API Contracts & Detail Separation (Wave C)

**Files:**
- Modify: `app/api/products/route.ts`
- Test: `tests/public-products-api.test.ts`

**Interfaces:**
- Consumes: HTTP GET requests to `/api/products` (public views).
- Produces: HTTP JSON responses according to locked contracts (A & B).

**Steps:**
- [ ] **Step 3.1: Write failing API route tests for public endpoints**
  - Test `GET /api/products?view=public&page=1&pageSize=24` returns paginated envelope with `PublicProductCardDTO[]`.
  - Test `GET /api/products` (no view parameter) defaults to public paginated Page 1 (never returns unbounded array).
  - Test `GET /api/products?id=123` returns `{ success: true, product: PublicProductDetailDTO }` with active variants only and zero admin audit fields.
  - Test `GET /api/products?id=999` (inactive or deleted product) returns HTTP 404.
  - Test `GET /api/products?page=10001` returns HTTP 400 with `{ success: false, code: "INVALID_PAGE" }`.
- [ ] **Step 3.2: Run test to confirm RED**
  ```bash
  npx tsx --test tests/public-products-api.test.ts
  ```
- [ ] **Step 3.3: Implement public routing logic in `app/api/products/route.ts`**
  - Refactor `GET` handler in `app/api/products/route.ts` to cleanly separate public list, public detail, admin list, and admin detail.
  - Handle `id` query parameter for public detail using `getPublicProductDetailQuery(id)`.
  - Handle public list using `getPublicCatalogQuery(input)`.
  - Attach cache control headers `publicCacheHeaders()`.
  - Preserve all existing mutation handlers (`POST`, `PUT`, `PATCH`, `DELETE`) and their Phase 1–4 security/inventory guards untouched.
- [ ] **Step 3.4: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/public-products-api.test.ts
  ```
- [ ] **Step 3.5: Run related regression tests**
  ```bash
  npx tsx --test tests/catalog-safety.test.ts
  ```
- [ ] **Step 3.6: Commit Task 3**
  ```bash
  git diff --check
  git add app/api/products/route.ts tests/public-products-api.test.ts
  git commit -m "feat(phase5): separate public catalog API contracts and detail endpoints"
  ```

---

### Task 4: Admin Catalog Read Model & Exact Discount Filter (Wave D)

**Files:**
- Create: `lib/catalog/adminCatalogQuery.ts`
- Modify: `app/api/products/route.ts`
- Test: `tests/admin-products-api.test.ts`

**Interfaces:**
- Consumes: HTTP GET requests to `/api/products?view=admin...` with admin authentication.
- Produces: `AdminProductListDTO` paginated envelope, `AdminProductDetailDTO`.

**Steps:**
- [ ] **Step 4.1: Write failing API route tests for admin endpoints**
  - Test unauthenticated `GET /api/products?view=admin&page=1` returns HTTP 401.
  - Test authenticated `GET /api/products?view=admin&page=1&pageSize=20` returns `AdminProductListDTO` envelope with `variantCount` (counting active variants) and no full `variants[]`.
  - Test admin discount filter `filter=discount`: matches strictly `compareAtPrice IS NOT NULL AND compareAtPrice > price`.
  - Test admin filters: `filter=hot`, `filter=upcoming`, `filter=badge`.
  - Test admin detail `GET /api/products?view=admin&id=123`: requires `requireAdmin`, returns `AdminProductDetailDTO` with all variants (active and inactive) for editing.
- [ ] **Step 4.2: Run test to confirm RED**
  ```bash
  npx tsx --test tests/admin-products-api.test.ts
  ```
- [ ] **Step 4.3: Implement `getAdminCatalogQuery` in `lib/catalog/adminCatalogQuery.ts`**
  - Server-side filter handling:
    - `filter === "hot"` → `where.isHotDeal = true`
    - `filter === "upcoming"` → `where.isUpcoming = true`
    - `filter === "badge"` → `where.badgeText = { not: null }`
    - `filter === "discount"` → Exact predicate: `where.AND = [{ compareAtPrice: { not: null } }, { compareAtPrice: { gt: prisma.product.fields.price } }]` (or parameter-safe SQL comparison).
    - `q` search: match `name`, `category`, `subcategory`, or exact numeric `id`.
  - Projection: select list fields omitting `description` and counting active variants via `_count: { select: { variants: { where: { isActive: true } } } }`.
  - Concurrent `Promise.all([findMany, count])`.
- [ ] **Step 4.4: Implement `getAdminProductDetailQuery(id)` in `lib/catalog/adminCatalogQuery.ts`**
  - Return full `AdminProductDetailDTO` with all variants and audit fields.
- [ ] **Step 4.5: Connect admin queries in `app/api/products/route.ts`**
  - Enforce `requireAdmin(req)` on `view === "admin"`.
- [ ] **Step 4.6: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/admin-products-api.test.ts
  ```
- [ ] **Step 4.7: Run catalog safety suite to confirm zero mutation regression**
  ```bash
  npx tsx --test tests/catalog-safety.test.ts
  ```
- [ ] **Step 4.8: Commit Task 4**
  ```bash
  git diff --check
  git add lib/catalog/adminCatalogQuery.ts app/api/products/route.ts tests/admin-products-api.test.ts
  git commit -m "feat(phase5): implement admin catalog read model and exact discount predicate"
  ```

---

### Task 5: Database Index Evidence Gate & Query-Plan Verification (Wave E)

**Files:**
- Modify: `prisma/schema.prisma` (if and only if justified by evidence)
- Create: `prisma/migrations/...` (if and only if justified)
- Test: `tests/integration/catalog-index-evidence.test.ts`

**Interfaces:**
- Consumes: Real PostgreSQL query execution plans via `EXPLAIN (ANALYZE, BUFFERS)`.
- Produces: Query-proven composite indexes in Prisma schema and migration SQL.

**Steps:**
- [ ] **Step 5.1: Write query-plan benchmark test**
  - Execute candidate queries on test database:
    1. Global latest: `SELECT ... WHERE isActive = true AND deletedAt IS NULL ORDER BY id DESC LIMIT 24 OFFSET 0`
    2. Category latest: `SELECT ... WHERE categoryId = $1 AND isActive = true AND deletedAt IS NULL ORDER BY id DESC LIMIT 24 OFFSET 0`
    3. Global price sort: `SELECT ... WHERE isActive = true AND deletedAt IS NULL ORDER BY price ASC, id DESC LIMIT 24 OFFSET 0`
    4. Category price sort: `SELECT ... WHERE categoryId = $1 AND isActive = true AND deletedAt IS NULL ORDER BY price ASC, id DESC LIMIT 24 OFFSET 0`
  - Record baseline execution plan, node types (Index Scan vs Seq Scan / Sort Buffer), and buffer hit metrics.
- [ ] **Step 5.2: Evaluate Candidate Composite Indexes**
  - Candidate 1: `@@index([isActive, deletedAt, id(sort: Desc)])`
  - Candidate 2: `@@index([categoryId, isActive, deletedAt, id(sort: Desc)])`
  - Candidate 3: `@@index([isActive, deletedAt, price(sort: Asc), id(sort: Desc)])`
  - Candidate 4: `@@index([categoryId, isActive, deletedAt, price(sort: Asc), id(sort: Desc)])`
- [ ] **Step 5.3: Add only proven indexes to `prisma/schema.prisma` and generate migration**
  - If query plans prove sort buffer elimination and measurable cost reduction, add the index definitions to `model Product` in `prisma/schema.prisma`.
  - If no candidate index provides measurable improvement beyond existing `@@index([isActive, deletedAt])` and `@@index([categoryId])`, add zero new indexes (document reason).
  - Verify migration SQL: ensure purely non-destructive `CREATE INDEX` statements.
  - Run `npx prisma generate`.
- [ ] **Step 5.4: Run full test suite against test database**
  ```bash
  npm test
  ```
- [ ] **Step 5.5: Commit Task 5**
  ```bash
  git diff --check
  git add prisma/ tests/
  git commit -m "perf(phase5): add query-proven catalog composite indexes"
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
- [ ] **Step 6.1: Write unit/integration tests for Load More state and restoration**
  - Test initial render delivers Page 1 (24 items).
  - Test client fetch requests `page = 2` with `pageSize = 24`.
  - Test duplicate product IDs are rejected during array merge.
  - Test filter/sort change resets state to `page = 1`.
  - Test restoration logic: for `page <= 10`, fetches pages `1..N` via controlled `pageSize = 24` requests; for `page > 10`, normalizes URL/state to `page = 10` via `replaceState` and restores through page 10.
- [ ] **Step 6.2: Run test to confirm RED**
  ```bash
  npx tsx --test tests/shop-load-more.test.ts
  ```
- [ ] **Step 6.3: Implement `ProgressiveProductGrid.tsx`**
  - Initialize state with `initialProducts` (from Page 1 server render).
  - Track `page`, `hasMore`, `loading`, `totalItems`, `pageSize = 24`.
  - `loadMore()`: fetches `GET /api/products?view=public&page=${page + 1}&pageSize=24&...`. Appends deduplicated items (`!existingIds.has(item.id)`).
  - Updates browser URL to `?page=${nextPage}` using `window.history.pushState` or Next.js router.
  - On mount/restoration: if URL has `page = N` where `N > 1`:
    - If `N <= 10`: progressively fetch pages `2..N` in bounded `pageSize = 24` requests and append.
    - If `N > 10`: replace URL state with `page = 10` and restore through page 10.
  - Render ProductCard grid with existing visual styling and "Load More" button.
- [ ] **Step 6.4: Update `app/shop/page.tsx`**
  - Read `searchParams` on server.
  - Call `getPublicCatalogQuery({ page: 1, pageSize: 24, category, subcategory, q, sort })`.
  - Pass initial `PaginatedResult` directly to `ProgressiveProductGrid`.
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

### Task 7: Admin Products UI Server-Side Pagination & Lightweight Projections (Wave G)

**Files:**
- Modify: `app/admin/products/page.tsx`
- Modify: `app/admin/products/[id]/edit/page.tsx`
- Test: `tests/admin-products-ui.test.ts`

**Interfaces:**
- Consumes: `GET /api/products?view=admin&page=...` (list) and `GET /api/products?view=admin&id=...` (edit detail).
- Produces: Paginated admin product table with server-side filters and on-demand detail editing.

**Steps:**
- [ ] **Step 7.1: Write tests for admin product table pagination and edit fetching**
  - Test admin table fetches `page=1&pageSize=20`.
  - Test clicking Next/Prev or page numbers requests corresponding server page.
  - Test filter tabs (`all`, `hot`, `upcoming`, `discount`, `badge`) trigger server-side query.
  - Test clicking "Edit" issues `GET /api/products?view=admin&id=123` to load full editable variants.
- [ ] **Step 7.2: Run test to confirm RED**
  ```bash
  npx tsx --test tests/admin-products-ui.test.ts
  ```
- [ ] **Step 7.3: Update `app/admin/products/page.tsx`**
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
  git add app/admin/products/page.tsx app/admin/products/[id]/edit/page.tsx tests/admin-products-ui.test.ts
  git commit -m "feat(phase5): paginate admin products UI with server-side filters"
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
- [ ] **Step 8.1: Write failing test for bounded homepage reads**
  - Test New Arrivals query fetches at most 1 product (`take: 1`).
  - Test Hot Deals query fetches at most 1 product (`findFirst`).
  - Test subcategory thumbnail query fetches representative images via a single batched query with zero full-table scans and zero N+1 queries.
  - Test lifecycle exclusions: inactive/deleted products are excluded.
- [ ] **Step 8.2: Run test to confirm RED**
  ```bash
  npx tsx --test tests/homepage-bounded-reads.test.ts
  ```
- [ ] **Step 8.3: Implement `lib/catalog/homepageQueries.ts`**
  - `getHomepagePromos()`:
    - New arrivals: `prisma.product.findMany({ where: { isActive: true, deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, name: true, image: true, createdAt: true } })`.
    - Hot deal: `prisma.product.findFirst({ where: { isActive: true, deletedAt: null, isHotDeal: true }, orderBy: [{ id: "desc" }], select: { id: true, name: true, image: true, createdAt: true } })`.
  - `getRepresentativeSubcategoryImages()`:
    - Execute a single batched query to get representative images for active subcategories (e.g. `prisma.product.findMany({ where: { isActive: true, deletedAt: null, subcategory: { not: null }, categoryId: { not: null } }, distinct: ['categoryId', 'subcategory'], select: { categoryId: true, category: true, subcategory: true, image: true } })`).
    - Map into a fast lookup dictionary: `Record<string, string>` keyed by `${categorySlug}:${subcategorySlug}`.
- [ ] **Step 8.4: Update `app/page.tsx`, `HomePromoGrid.tsx`, and `CategorySection.tsx`**
  - `app/page.tsx`: replace unpaginated `prisma.product.findMany` with `getHomepagePromos()` and `getRepresentativeSubcategoryImages()`.
  - `HomePromoGrid.tsx`: accept `newestProduct` and `hotDealProduct` directly as props.
  - `CategorySection.tsx`: accept `subcategoryImageMap` directly as props; resolve subcategory thumbnail via map lookup with fallback to `Category.image`.
- [ ] **Step 8.5: Run test to confirm GREEN**
  ```bash
  npx tsx --test tests/homepage-bounded-reads.test.ts
  ```
- [ ] **Step 8.6: Commit Task 8**
  ```bash
  git diff --check
  git add lib/catalog/homepageQueries.ts app/page.tsx components/home/ tests/homepage-bounded-reads.test.ts
  git commit -m "perf(phase5): bound homepage catalog reads and batch subcategory thumbnail resolution"
  ```

---

### Task 9: Backward-Compatibility Consumer Migration & Decimal Authority (Wave I)

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
- [ ] **Step 9.1: Write migration regression tests**
  - Test `app/sitemap.ts` retrieves product IDs for sitemap via bounded/lightweight ID-only query.
  - Test `app/admin/page.tsx` retrieves counts (total products, low stock, hot deals) without loading complete product tables into memory.
  - Test Decimal monetary authority: PostgreSQL Decimal remains authoritative; DTO JavaScript `Number` is presentation-only; checkout (`POST /api/orders`) re-reads authoritative Decimal prices and stock from PostgreSQL.
- [ ] **Step 9.2: Run test to confirm RED**
  ```bash
  npx tsx --test tests/catalog-consumer-migration.test.ts
  ```
- [ ] **Step 9.3: Migrate all internal consumers**
  - `app/sitemap.ts`: Update to query `prisma.product.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, updatedAt: true } })`.
  - `app/admin/page.tsx`: Update to fetch admin counts from `/api/products?view=admin&page=1&pageSize=1` (`totalItems`) and targeted count queries rather than downloading all full products.
  - `components/shop/ShopProductGridClient.tsx`: Update to consume paginated API contract `{ items, totalItems, hasMore }`.
  - Verify zero consumers remain that expect unbounded `/api/products` raw arrays.
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
  git add app/sitemap.ts app/admin/page.tsx components/shop/ lib/getProducts.ts tests/catalog-consumer-migration.test.ts
  git commit -m "refactor(phase5): migrate internal catalog consumers and enforce Decimal authority"
  ```

---

### Task 10: Full Regression Suite & Responsive Real Browser QA (Wave J)

**Files:**
- Test: `tests/phase5-complete-regression.test.ts`

**Interfaces:**
- Consumes: Complete public, admin, and homepage catalog flows.
- Produces: Comprehensive test pass across all 10 test dimensions and real browser responsiveness validation.

**Steps:**
- [ ] **Step 10.1: Run complete automated test suite**
  ```bash
  npm test
  ```
  Assert 100% test pass with 0 failures across all existing Phase 1–4 tests and new Phase 5 suites:
  - `tests/catalog-query-params.test.ts`
  - `tests/public-catalog-query.test.ts`
  - `tests/public-products-api.test.ts`
  - `tests/admin-products-api.test.ts`
  - `tests/shop-load-more.test.ts`
  - `tests/admin-products-ui.test.ts`
  - `tests/homepage-bounded-reads.test.ts`
  - `tests/catalog-consumer-migration.test.ts`
  - `tests/catalog-safety.test.ts`
- [ ] **Step 10.2: Perform responsive browser QA using Chrome DevTools MCP**
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
    - Click "Edit" on a product. Verify full editable variants and description load cleanly.
    - Perform a test product edit and verify live stock preservation.
  - **Homepage QA Flow**:
    - Navigate to `/`. Verify New Arrivals promo, Hot Deals promo, and Category/Subcategory thumbnails render correctly with zero console errors or full-catalog table scans.
- [ ] **Step 10.3: Verify zero build or lint warnings**
  ```bash
  npm run build
  ```
- [ ] **Step 10.4: Commit Task 10**
  ```bash
  git diff --check
  git commit -m "test(phase5): complete catalog scalability regression suite and browser QA"
  ```

---

## Plan Self-Review Checklist

- **Spec Coverage (D1–D9)**:
  - D1 (Load More +24, max 48, bounded pagination): Tasks 1, 2, 3, 6.
  - D2 (Sort: latest, price-asc, price-desc with ID tiebreaker): Tasks 1, 2, 6.
  - D3 (Search scope: name, category, subcategory, no description): Tasks 1, 2, 6.
  - D4 (Admin pagination 20/50, no variant overfetch on list): Tasks 1, 4, 7.
  - D5 (Category shows all products immediately, subcategory optional): Tasks 2, 6.
  - D6 (Envelope: items, page, pageSize, totalItems, totalPages, hasMore, nextPage): Tasks 1, 2, 3, 4.
  - D7 (DTO separation: PublicCard, PublicDetail, AdminList, AdminDetail): Tasks 1, 2, 3, 4.
  - D8 (hasVariants boolean only, active-only, no N+1): Tasks 1, 2, 4.
  - D9 (Category slug to ID authority, scoped subcategory): Tasks 2, 6.
- **Invariants Protected**: Admin auth (`requireAdmin`), soft delete, reservation guards (`PRODUCT_RESERVED_ACTIVE`), variant stock authority / product aggregate mirror, Decimal monetary precision, and checkout independence re-reads are strictly maintained across all tasks.
- **No Placeholders**: 0 occurrences of `TODO`, `TBD`, "add tests", "handle errors", or "similar to above".
- **Evidence-Gated Indexes**: Task 5 requires real PostgreSQL query-plan verification via `EXPLAIN (ANALYZE, BUFFERS)` before adding any indexes.
- **Explicit Phase Boundaries**: Zero scope creep into Phase 6 (Image CDN), Phase 7 (Redis caching), Phase 8 (Premium UI redesign), or Phase 9 (Checkout redesign).
