# Phase 5 — Catalog Scalability Design Specification
**Pure Haven BD**
**Date:** 2026-08-28
**Status:** LOCKED SPECIFICATION — Hardened Design Contract
**Git Baseline:** `7259f807c4d8b458d8fd93344471c48f437c0f51` (`phase4-complete`)

---

## 1. Background & Objective

Phase 1 established admin security boundaries. Phase 2 delivered the core commerce engine (inventory reservations, order lifecycle, payment records, returns). Phase 3 established customer authentication and session management. Phase 4 consolidated all persistent business state onto PostgreSQL, introduced relational Category/Subcategory models, Decimal monetary precision, database check constraints, and product lifecycle fields (`isActive`, `deletedAt`).

However, the discovery audit of the catalog subsystem revealed architectural scalability bottlenecks:

1. **Unbounded Database Reads**: Both public catalog (`/shop`, `app/page.tsx`) and admin catalog (`/admin/products`) perform unpaginated `prisma.product.findMany()` queries, loading all active database rows into Node.js server memory on every request.
2. **In-Memory Filtering & Sorting**: Category filtering, subcategory filtering, substring search, and price sorting are executed in JavaScript memory on the server or client rather than within PostgreSQL.
3. **Client-Side Slicing**: The customer-facing `/shop` page delivers all matching products in the initial server render payload, and the client component (`LoadMoreProducts.tsx`) merely slices the in-memory array by 12.
4. **Payload Overfetch**: Catalog list queries pull large fields (`description`) and admin lists pull complete variant trees (`ProductVariant[]`), leading to bloated payload sizes and unnecessary memory pressure.
5. **Homepage Thumbnail Dependencies**: The homepage queries all active products to resolve fallback category and subcategory images for `CategorySection`.

Phase 5 establishes a **scalable, server-authoritative catalog architecture** for the currently anticipated commercial catalog scale while preserving all locked security, inventory, financial, and relational invariants from Phases 1–4.

---

## 2. Owner-Locked Decisions (D1 – D9)

The following architectural decisions are locked by product ownership and govern the entire Phase 5 design:

### D1 — Public Catalog Loading & UX
- **Customer UX**: Progressive "Load More" button interaction (NOT endless/uncontrolled infinite scroll).
- **Initial Chunk**: 24 products rendered on first load.
- **Increment Chunk**: +24 products appended per "Load More" click.
- **Underlying Server Contract**: Strictly bounded page-based pagination (`page`, `pageSize`).
- **Server/API Hard Limit**: Hard maximum `pageSize = 48` enforced server-side.
- **State & Restoration Model**:
  - `page = N` represents that results through logical pages `1..N` have been progressively revealed.
  - Category, search, subcategory, and sort state remain deterministic and shareable via URL parameters.
  - Direct navigation, browser refresh, or Back/Forward to `page = N` (where `N <= MAX_RESTORABLE_PUBLIC_PAGE = 10`) progressively reconstructs the revealed items `1..N` via bounded page-sized requests (`pageSize = 24`), merging and deduplicating items without issuing unbounded single-query payloads.
  - If a URL specifies `page > 10`, the client/server state normalizes to `page = 10` (via history `replaceState`) and restores through page 10. Customers may then continue clicking "Load More" (`10 -> 11 -> 12...`). Deep progressively revealed state is intentionally not fully bookmark-restorable after a hard reload as a deliberate UX/resource trade-off.
- **Performance Model**: The design explicitly acknowledges that SQL `OFFSET` pagination requires database engines to scan preceding rows before slicing results; `OFFSET` performance cost grows with page depth and must be verified against query plans. Page-based parameters provide deterministic, shareable URL semantics and work well with the chosen filtering and sorting model for the currently anticipated commercial catalog scale.

### D2 — Public Sort Options
The public catalog supports exactly three sorting options:
1. `latest` (Default): Ordered by `id DESC` (deterministic tiebreaker).
2. `price-asc` (Price: Low to High): Ordered by `price ASC, id DESC`.
3. `price-desc` (Price: High to Low): Ordered by `price DESC, id DESC`.

*No popularity, best-selling, or alphabetical name sorts will be introduced in Phase 5.*

### D3 — Public Search Scope
- **Fields Searched**: Server-side filtering across `Product.name`, relational `Category.name`, and `Product.subcategory`.
- **Exclusions**: `Product.description` is **strictly excluded** from search indexing and query matching in Phase 5.
- **Infrastructure Constraints**: No external search engines (Elasticsearch, Algolia, Meilisearch), no semantic/AI search, and no variant SKU search in Phase 5.
- **Indexing Reality**: Standard B-tree indexes do not optimize arbitrary leading-wildcard `%term%` `ILIKE` pattern scans; search execution is handled via parameterized server-side SQL predicates, and search cost depends on matching-set volume.

### D4 — Admin Product Catalog Scalability
- `/admin/products` adopts server-side pagination, search, and filtering.
- **Default Page Size**: 20 products per page.
- **Maximum Page Size**: 50 products per page.
- **Variant Overfetch Elimination**: Admin list queries (`AdminProductListDTO`) will **not** load full variant arrays for every product. Full variant trees are loaded on-demand only when editing or viewing individual product details.

### D5 — Category & Subcategory Navigation UX
- Selecting a parent category immediately displays all products belonging to that category.
- Subcategory selection acts as an **optional refinement filter**.
- The legacy behavior requiring the customer to choose a subcategory before seeing products is completely removed:
  - `/shop?category=skincare` → Displays all Skincare products.
  - `/shop?category=skincare&subcategory=serum` → Displays Skincare products refined to Serum.

### D6 — Pagination & Result Metadata Envelope
All paginated catalog endpoints return a standardized metadata envelope:
- `items`: Array of DTO items for the current page.
- `page`: Current 1-indexed page number.
- `pageSize`: Number of items requested per page.
- `totalItems`: Total matching product count.
- `totalPages`: Total available pages (`Math.ceil(totalItems / pageSize)`).
- `hasMore`: Boolean flag (`page < totalPages`).
- `nextPage`: Next page number (`page + 1`) or `null` if on the final page.
- *Execution Model*: The count query is executed via `prisma.product.count({ where })` concurrently alongside `findMany` using `Promise.all` (two concurrent database queries, not a single round-trip). Count performance depends on matching-set volume and query plans.

### D7 — Read Model & DTO Separation
Clear separation between specialized DTO contracts:
1. `PublicProductCardDTO`: Lightweight card projection (no `description`, no `variants[]`).
2. `PublicProductDetailDTO`: Complete detail projection for product detail pages (includes `description`, active variants only, full images).
3. `AdminProductListDTO`: Lightweight operational list projection with variant summary.
4. `AdminProductDetailDTO`: Complete operational entity with all variants and audit fields for admin editor.

### D8 — Variant Metadata on Public Cards
- `PublicProductCardDTO` includes exactly one variant metadata flag: `hasVariants: boolean`.
- `PublicProductCardDTO` strictly omits: `variantCount`, variant labels, individual variant prices, variant stocks, variant images, and `variants[]`.
- `hasVariants` is computed based on active variants only (`ProductVariant.isActive = true`) via a relation count/existence projection without loading nested variant arrays or introducing per-card N+1 queries.
- *Purpose*: Enables future Phase 8 quick-add vs option-selector UX without payload bloat.

### D9 — Category Relational Authority & Scoped Subcategory Filtering
- **Public URL**: Slug-based (`?category=skincare`).
- **Server Authority**: Server resolves category slug → active `Category.id` → filters SQL via relational `Product.categoryId = Category.id`.
- **Legacy Field**: `Product.category` string is retained solely as a denormalized display snapshot and backward-compatibility field, NOT the authoritative query key.
- **Relational Subcategory Scoping**: If `subcategory` is supplied in public filters, `category` MUST also be supplied. The server relationally validates that the subcategory exists and belongs to the active parent category (`Subcategory.categoryId = Category.id AND Subcategory.slug = slug AND Subcategory.isActive = true`). If `subcategory` is supplied without a category or if no active matching subcategory exists, the query returns a deterministic empty result (`totalItems: 0`, `items: []`). After relational validation, the server applies the `Product.subcategory` text predicate required by the current schema.
- **No Schema Migration**: Phase 5 intentionally does not introduce a `Product.subcategoryId` column or migration.

---

## 3. Public Query Architecture

```mermaid
flowchart TD
    A["Incoming Request (URL Query Params)"] --> B["Normalize & Validate Inputs (lib/catalogRead.ts)"]
    B --> C{"Category Slug Present?"}
    C -->|No| D{"Subcategory Present?"}
    D -->|Yes| E["Unscoped Subcategory -> Return Empty Result (total: 0)"]
    D -->|No| F["No Category Constraint"]
    C -->|Yes| G["Validate & Resolve Active Category.id via getCachedCategoryRows()"]
    G --> H{"Valid Active Category Found?"}
    H -->|No| E
    H -->|Yes| I{"Subcategory Present?"}
    I -->|Yes| J["Relationally Validate Subcategory under Category.id"]
    J --> K{"Valid Active Subcategory Found?"}
    K -->|No| E
    K -->|Yes| L["Set where.categoryId = Category.id & where.subcategory = subcatSlug"]
    I -->|No| M["Set where.categoryId = Category.id"]
    F --> N["Build Base Prisma WHERE Clause"]
    L --> N
    M --> N
    N --> O["Inject Invariants: isActive=true, deletedAt=null"]
    O --> P["Inject Search Predicates if q present (name, subcat, catName)"]
    P --> Q["Apply Deterministic ORDER BY (latest | price-asc | price-desc)"]
    Q --> R["Validate Safe Skip: skip = (page - 1) * pageSize, take = pageSize"]
    R --> S["Execute Promise.all([findMany, count]) in PostgreSQL"]
    S --> T["Project to PublicProductCardDTO (strip description/variants)"]
    T --> U["Construct PaginatedResult Envelope"]
```

### Execution Flow Details

1. **Input Normalization & Defensive Bounds Check**:
   - Extract `page`, `pageSize`, `category`, `subcategory`, `q`, `sort` from `searchParams`.
   - Validate and clamp values. Check `Number.isSafeInteger((page - 1) * pageSize)`.
   - If `page > MAX_PUBLIC_PAGE` (10,000), reject with HTTP 400 `INVALID_PAGE`.
2. **Category & Subcategory Relational Resolution**:
   - Active categories and subcategories are resolved from `getCachedCategoryRows(false)` (which strictly queries `where: { isActive: true }`).
   - If `subcategory` is passed without `category`, return empty results immediately (`totalItems: 0`, `items: []`).
   - If `category` slug is provided, validate slug syntax against `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. If not found among active categories, return empty results immediately.
   - If `subcategory` is provided with `category`, verify it exists under that parent category with `isActive: true`. If not found, return empty results immediately.
   - On successful validation, set `where.categoryId = category.id` (and `where.subcategory = subcategorySlug` if refined).
3. **Where Clause Construction**:
   - Enforce mandatory lifecycle boundaries: `where.isActive = true` and `where.deletedAt = null`.
   - If search query `q` is present:
     ```ts
     where.OR = [
       { name: { contains: sanitizedQuery, mode: "insensitive" } },
       { subcategory: { contains: sanitizedQuery, mode: "insensitive" } },
       { categoryRel: { name: { contains: sanitizedQuery, mode: "insensitive" } } },
     ];
     ```
4. **Deterministic Sorting**:
   - `latest`: `orderBy: [{ id: "desc" }]`
   - `price-asc`: `orderBy: [{ price: "asc" }, { id: "desc" }]`
   - `price-desc`: `orderBy: [{ price: "desc" }, { id: "desc" }]`
5. **Database Execution**:
   - Query 1: `prisma.product.findMany({ where, orderBy, skip, take, select: cardProjection })`
   - Query 2: `prisma.product.count({ where })`
   - Dispatched concurrently via `Promise.all([findManyTask, countTask])`.

---

## 4. Query Parameter & Input Normalization Contract

| Parameter | Type | Validation & Normalization Rules | Default | Maximum Bound |
|---|---|---|---|---|
| `page` | Integer | Parse as base-10 int. If `NaN` or `< 1` → clamp to `1`. If `> 10000` (`MAX_PUBLIC_PAGE`) → return HTTP 400 `INVALID_PAGE`. | `1` | `10000` (Defensive guardrail) |
| `pageSize` | Integer | Parse as base-10 int. If `NaN` or `< 1` → default `24`. If `> 48` → clamp to `48`. | `24` | `48` |
| `category` | String | Trim, lowercase, max 100 chars. Must match slug syntax `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. Unmatched or invalid format returns empty results (`totalItems: 0`). | `null` | 100 chars |
| `subcategory` | String | Trim, lowercase, max 100 chars. Must match slug syntax `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. Must be accompanied by valid parent category. Unscoped or unmatched returns empty results (`totalItems: 0`). | `null` | 100 chars |
| `q` | String | Trim whitespace, max 80 chars. Parameterized through query layer. Empty after trim → `null` (no search predicate). | `null` | 80 chars |
| `sort` | String | Must match one of `latest`, `price-asc`, `price-desc`. Unknown values normalize to `latest`. | `latest` | Fixed Enum |

### Defensive Server Bounds vs Performance Reality
- **Defensive Maximum**: `MAX_PUBLIC_PAGE = 10_000` and `MAX_ADMIN_PAGE = 10_000` exist solely as structural guardrails to prevent integer overflow and pathological abuse.
- **No Performance SLA Implied**: The server does NOT claim or guarantee that page 10,000 is performant. SQL `OFFSET` performance cost increases with depth because the database engine must scan preceding index/table rows before returning the slice.
- **Out-of-Range Pages**: When `1 <= page <= 10_000` but `page > totalPages` (e.g. `page = 15` when `totalPages = 3`):
  - Server returns HTTP 200 with `{ success: true, items: [], page: 15, pageSize: 24, totalItems: 60, totalPages: 3, hasMore: false, nextPage: null }`.
  - The server does not silently redirect or rewrite to page 1 or the last page.

---

## 5. Customer Load More State & Restoration Contract

### Exact Page State Model
- In the public catalog, `page = N` represents: **"The customer has progressively revealed results through logical page N."**
- Example: `page = 3` with `pageSize = 24` means the customer is viewing products 1 through 72.

### Normal Load More Progression
1. Initial page load renders Page 1 (items 1–24).
2. Customer clicks "Load More".
3. Client issues `GET /api/products?view=public&page=2&pageSize=24&...`.
4. Client receives Page 2 envelope, deduplicates items by `id`, appends them to the visible grid, updates internal state to `page = 2`, and updates the browser URL to `?page=2` via `window.history.pushState` / Next.js router.

### URL Restoration Semantics (Refresh / Direct Navigation / Back / Forward)
When a customer navigates directly to or refreshes a URL with `page = N` (e.g. `?category=skincare&page=3`):
1. **No Unbounded Overfetch**: The server or client will **NEVER** issue one giant `pageSize = N * 24` query that bypasses the `pageSize = 48` limit.
2. **Restoration Policy (`MAX_RESTORABLE_PUBLIC_PAGE = 10`)**:
   - **For `page <= 10`**: The client progressively reconstructs the revealed range by fetching bounded pages `1..N` in controlled `pageSize = 24` requests, merging and deduplicating items into the grid.
   - **For `page > 10`**: The client/server state **normalizes the customer-visible URL and state to `page = 10`** (using history `replaceState` so a broken deep state is not left in the URL) and restores through page 10. After page 10 is restored, the customer may continue clicking "Load More" (`10 -> 11 -> 12...`) and the URL updates accordingly.
3. **Deliberate Resource Trade-Off**: Very deep progressively revealed state (> 10 pages / > 240 items) is intentionally not fully bookmark-restorable upon a cold browser refresh to prevent network/client memory exhaustion. Live in-session Back/Forward navigation may utilize client memory cache where available, but backend correctness does not depend on it.
4. **Filter Reset Rule**: Modifying `category`, `subcategory`, `q`, or `sort` immediately resets pagination to `page = 1` and clears previously accumulated items.

---

## 6. DTO Architecture & Field Specifications

### 6.1 PublicProductCardDTO (Minimal Listing Projection)
Used on `/shop` grid, search results, and category listing.

```ts
export type PublicProductCardDTO = {
  id: number;
  name: string;
  price: number;              // Formatted from Decimal for presentation only
  compareAtPrice: number | null;
  image: string;
  category: string;           // Display category name snapshot
  stock: number;              // Aggregate mirror stock
  isHotDeal: boolean;
  isUpcoming: boolean;
  badgeText: string | null;
  badgeTone: string;
  hasVariants: boolean;       // D8: Computed from active variants without loading variants[]
};
```
*Strictly Excluded*: `description`, `variants[]`, `createdAt`, `updatedAt`, `deletedAt`, `isActive`.

### 6.2 PublicProductDetailDTO (Complete PDP Projection)
Used on `/product/[id]` detail page. Requires `isActive = true` and `deletedAt = null`.

```ts
export type PublicProductVariantDTO = {
  id: number;
  label: string;
  price: number;              // Formatted from Decimal for presentation only
  stock: number;
  image: string | null;
};

export type PublicProductDetailDTO = PublicProductCardDTO & {
  categoryId: number | null;
  subcategory: string | null;
  description: string | null;
  variants: PublicProductVariantDTO[]; // Active variants only (ProductVariant.isActive = true)
};
```

### 6.3 AdminProductListDTO (Lightweight Admin Dashboard Projection)
Used on `/admin/products` list table.

```ts
export type AdminProductListDTO = {
  id: number;
  name: string;
  price: number;              // Formatted from Decimal for presentation only
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
  createdAt: string;          // ISO Date string
  variantCount: number;       // Count of active variants (no full variant arrays loaded)
  hasVariants: boolean;
};
```
*Strictly Excluded*: `description`, full `variants[]` records.

### 6.4 AdminProductDetailDTO (Full Admin Editor Projection)
Used when opening product editor modal or `/admin/products/[id]/edit`.

```ts
export type AdminProductVariantDTO = {
  id: number;
  productId: number;
  label: string;
  price: number;              // Formatted from Decimal for presentation only
  stock: number;
  image: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type AdminProductDetailDTO = AdminProductListDTO & {
  description: string | null;
  deletedAt: string | null;
  updatedAt: string;
  variants: AdminProductVariantDTO[]; // All variants (active and inactive) for admin management
};
```

### 6.5 Monetary Precision & Authority Boundary
- **Database Authority**: PostgreSQL `DECIMAL(12, 2)` / Prisma `Decimal` is the **sole source of financial truth**.
- **DTO Transport**: JavaScript `Number` in DTOs is strictly for JSON transport and UI display. Binary floating-point representation has **zero monetary authority**.
- **Checkout & Inventory Boundary**: Catalog DTO values must **NEVER** be reused as checkout, payment, or inventory authority. During checkout (`POST /api/orders`), the server executes fresh transactional queries to re-read and validate authoritative Decimal prices and stock.

---

## 7. Admin Query Architecture

### Admin List Endpoint Specification
- **Route**: `GET /api/products?view=admin&page=1&pageSize=20&q=...&filter=...`
- **Authentication**: Strictly protected by `requireAdmin(req)`. Unauthenticated calls return HTTP 401.
- **Default Pagination**: `pageSize = 20`, maximum `pageSize = 50`, `MAX_ADMIN_PAGE = 10_000`.
- **Server-Side Filters**:
  - `filter=hot` → `where.isHotDeal = true`
  - `filter=upcoming` → `where.isUpcoming = true`
  - `filter=discount` → **Locked Exact Predicate**: `compareAtPrice IS NOT NULL AND compareAtPrice > price`. Implementation uses a parameter-safe query strategy (such as a safe Prisma comparison or parameterized SQL filter) that guarantees this exact business predicate without weakening it.
  - `filter=badge` → `where.badgeText = { not: null }`
  - `q=...` → Parameterized match across `name`, `category`, `subcategory`, or integer `id`.
- **Query Optimization**: Admin list uses `select` omitting `description` and counts active variants via `_count: { select: { variants: { where: { isActive: true } } } }` without joining or loading variant records.
- **Detail on Demand**: When the admin clicks "Edit", the client issues `GET /api/products?view=admin&id=123` to retrieve the complete `AdminProductDetailDTO`.

---

## 8. Database Index Strategy

All prospective composite indexes are classified as **CANDIDATES** to be evaluated on an isolated test database using PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` during implementation. Only query-proven indexes that measurably reduce execution cost or eliminate sort buffers will be created in migrations.

### 8.1 Existing Baseline Indexes (Preserved)
- `Product`: `PRIMARY KEY (id)`
- `Product`: `@@index([isActive, deletedAt])`
- `Product`: `@@index([categoryId])`
- `ProductVariant`: `PRIMARY KEY (id)`
- `ProductVariant`: `@@index([productId, isActive])`
- `Category`: `PRIMARY KEY (id)`, `@@unique([slug])`
- `Subcategory`: `PRIMARY KEY (id)`, `@@unique([categoryId, slug])`

### 8.2 Candidate Composite Index Families

The implementation will evaluate the following candidate index families:

1. **Active/Non-Deleted Default Ordering**:
   - Candidate: `@@index([isActive, deletedAt, id(sort: Desc)])`
   - *Target Query*: Global `/shop` and search sorted by `latest`.
2. **Relational Category + Default Ordering**:
   - Candidate: `@@index([categoryId, isActive, deletedAt, id(sort: Desc)])`
   - *Target Query*: `/shop?category=skincare` sorted by `latest`.
3. **Global Active/Non-Deleted Price Ordering**:
   - Candidate: `@@index([isActive, deletedAt, price(sort: Asc), id(sort: Desc)])`
   - Candidate: `@@index([isActive, deletedAt, price(sort: Desc), id(sort: Desc)])`
   - *Target Query*: Global `/shop?sort=price-asc` or `price-desc`. Global price sort requires a distinct index structure from category-filtered price sort.
4. **Relational Category + Price Ordering**:
   - Candidate: `@@index([categoryId, isActive, deletedAt, price(sort: Asc), id(sort: Desc)])`
   - Candidate: `@@index([categoryId, isActive, deletedAt, price(sort: Desc), id(sort: Desc)])`
   - *Target Query*: `/shop?category=skincare&sort=price-asc`.

### 8.3 Index Validation Rules
- No index is guaranteed to be added until verified against actual PostgreSQL query plans.
- Proliferation of redundant indexes must be avoided.
- Trigram indexing (`pg_trgm`) remains optional and deferred; standard parameterized SQL predicates are used for search in Phase 5.

---

## 9. Locked Phase 1–4 Invariants (Non-Negotiable)

The implementation of Phase 5 must strictly guarantee that zero existing security, lifecycle, or financial guarantees are altered:

1. **Admin Authorization Boundary**:
   - All catalog mutations (`POST /api/products`, `PUT /api/products`, `PATCH /api/products`, `DELETE /api/products`, and `/api/categories` mutations) and admin read views (`?view=admin`) require valid admin authentication via `requireAdmin(req)`.
2. **Product Lifecycle Safety**:
   - Inactive products (`isActive = false`) and soft-deleted products (`deletedAt != null`) are **never** returned in public catalog lists, searches, category views, or Load More responses.
   - Products with historical `OrderItem` references are protected against hard deletion; deleting such a product triggers a safe soft-delete transaction.
3. **Inventory Reservation Delete Guards**:
   - A product or variant cannot be deleted if active `RESERVED` or `FULFILLED` inventory reservations exist. Attempts return HTTP 409 `PRODUCT_RESERVED_ACTIVE` or `VARIANT_RESERVED_ACTIVE`.
4. **Authoritative Inventory Model**:
   - `ProductVariant.stock` is authoritative for variant inventory.
   - `Product.stock` is the aggregate mirror for variant products and is maintained via transactional atomic increments/decrements.
   - `Product.stock` is authoritative for non-variant products.
   - Stock cannot be modified through product metadata updates (`PUT /api/products` preserves live database stock).
5. **Decimal Financial Authority**:
   - Monetary values in PostgreSQL are stored as exact `DECIMAL(12, 2)`.
   - Prices submitted from clients are normalized and validated via `lib/money.ts` (`requireNonNegativeMoney`).
6. **Checkout Independence**:
   - Catalog DTOs are unprivileged read projections. During checkout (`POST /api/orders`), the server executes fresh transactional lookups directly against PostgreSQL to validate live stock and authoritative prices.

---

## 10. Homepage Bounded Read Architecture

The discovery audit revealed that `app/page.tsx` loaded all active products to support `HomePromoGrid` (New Arrivals, Hot Deals) and `CategorySection` (category and subcategory banner thumbnails).

### Bounded Query Design for Homepage

1. **New Arrivals**:
   - Target query: `prisma.product.findMany({ where: { isActive: true, deletedAt: null }, orderBy: [{ createdAt: "desc" }], take: 1, select: { id: true, name: true, image: true } })`.
2. **Hot Deals**:
   - Target query: `prisma.product.findFirst({ where: { isActive: true, deletedAt: null, isHotDeal: true }, orderBy: [{ id: "desc" }], select: { id: true, name: true, image: true } })`.
3. **Category Banner Thumbnails**:
   - Uses `Category.image` directly from the cached category tree (`getCachedCategoryRows(false)`).
4. **Subcategory Banner Thumbnails**:
   - **Invariant**: Subcategory representative images must be obtained by ONE bounded/batched database-side strategy that:
     - Returns at most one representative product image per relevant active subcategory
     - Does not load the complete active Product table into Node.js
     - Does not perform N+1 product queries
     - Preserves lifecycle filters (`isActive = true, deletedAt = null`)
   - *Acceptable Implementation Examples*: Parameter-safe PostgreSQL `DISTINCT ON (category, subcategory)` query, window-function `ROW_NUMBER()` query, or a verified Prisma query whose generated plan executes server-side grouping.
5. **Invariant**: The homepage must **never** load the full product table to render thumbnails or promotional tiles.

---

## 11. Explicit API Route Contracts

There is **exactly one** unambiguous contract for each API path:

### A. Public Paginated Product List
- **Endpoint**: `GET /api/products?view=public&page=1&pageSize=24&category=...&subcategory=...&q=...&sort=...`
- **Fallback**: If `view` parameter is omitted, it defaults to `view=public` with standard pagination (`page=1`, `pageSize=24`). It **never** returns an unbounded catalog array.
- **Response**:
  ```json
  {
    "success": true,
    "items": [ /* PublicProductCardDTO[] */ ],
    "page": 1,
    "pageSize": 24,
    "totalItems": 120,
    "totalPages": 5,
    "hasMore": true,
    "nextPage": 2
  }
  ```

### B. Public Product Detail
- **Endpoint**: `GET /api/products?id=<id>` (without `view=admin`)
- **Authentication**: Unauthenticated.
- **Enforcement**: Must enforce `isActive = true`, `deletedAt = null`, and return active variants only (`ProductVariant.isActive = true`). If product is inactive or deleted, returns HTTP 404. Never exposes admin-only fields.
- **Response**:
  ```json
  {
    "success": true,
    "product": { /* PublicProductDetailDTO */ }
  }
  ```

### C. Admin Paginated Product List
- **Endpoint**: `GET /api/products?view=admin&page=1&pageSize=20&filter=...&q=...`
- **Authentication**: Required (`requireAdmin`). Unauthenticated returns HTTP 401.
- **Response**:
  ```json
  {
    "success": true,
    "items": [ /* AdminProductListDTO[] */ ],
    "page": 1,
    "pageSize": 20,
    "totalItems": 85,
    "totalPages": 5,
    "hasMore": true,
    "nextPage": 2
  }
  ```

### D. Admin Product Detail
- **Endpoint**: `GET /api/products?view=admin&id=<id>`
- **Authentication**: Required (`requireAdmin`). Unauthenticated returns HTTP 401.
- **Response**:
  ```json
  {
    "success": true,
    "product": { /* AdminProductDetailDTO */ }
  }
  ```

---

## 12. Test Strategy & TDD Roadmap

A comprehensive test suite will be written using Node.js native test runner (`tsx --test`) and real PostgreSQL integration tests before any production code changes:

### Required Phase 5 Test Coverage

1. **Pagination Engine**:
   - `test/pagination-defaults`: Requesting without `page` returns page 1 with 24 items.
   - `test/pagination-next-page`: Requesting `page=2` returns items 25–48 with zero overlap with page 1.
   - `test/pagination-bounds`: Requesting `pageSize=500` clamps to `pageSize=48`.
   - `test/pagination-invalid-params`: Requesting `page=-3` or `page=abc` normalizes safely to `page=1`.
   - `test/pagination-max-page-rejection`: Requesting `page=10001` returns HTTP 400 `INVALID_PAGE`.
   - `test/pagination-out-of-range`: Requesting `page=999` (where totalPages = 3) returns empty `items: []`, `hasMore: false`, and accurate `totalItems`.
2. **Load More Progressive State & Restoration**:
   - `test/load-more-initial`: Verifies initial 24 products loaded on page 1.
   - `test/load-more-restoration-bounded`: Verifies that direct navigation to `page=3` reconstructs pages 1..3 via bounded page-sized queries without exceeding `pageSize = 48`.
   - `test/load-more-deduplication`: Verifies that duplicate product IDs are never appended.
   - `test/load-more-filter-reset`: Verifies that changing category, subcategory, search, or sort resets page to 1.
   - `test/load-more-deep-restoration-cap`: Verifies that requesting direct navigation to `page=15` normalizes customer state/URL to `page=10` and restores through page 10.
3. **Deterministic Ordering**:
   - `test/sort-latest`: Verifies `id DESC` order.
   - `test/sort-price-asc`: Verifies `price ASC` with `id DESC` tiebreaker for identical prices.
   - `test/sort-price-desc`: Verifies `price DESC` with `id DESC` tiebreaker.
4. **Relational Category & Scoped Subcategory Filtering**:
   - `test/filter-category-relational`: Verifies filtering by category slug resolves `Category.id` and queries `Product.categoryId`.
   - `test/filter-subcategory-scoped-valid`: Verifies filtering by valid subcategory under parent category returns matching subset.
   - `test/filter-subcategory-cross-category-mismatch`: Verifies subcategory belonging to another category returns empty result (`totalItems: 0`).
   - `test/filter-subcategory-without-category`: Verifies subcategory supplied without category returns empty result (`totalItems: 0`).
   - `test/filter-category-products-immediate`: Verifies selecting parent category displays all child products immediately without requiring subcategory.
5. **Server-Side Search Scope**:
   - `test/search-scope`: Verifies matching `Product.name`, `Category.name`, and `Product.subcategory`.
   - `test/search-description-excluded`: Verifies terms found only in `Product.description` are NOT returned in search.
6. **DTO Projections & Overfetch Prevention**:
   - `test/card-dto-shape`: Asserts `PublicProductCardDTO` contains `hasVariants` and strictly lacks `description` and `variants[]`.
   - `test/has-variants-active-only`: Asserts `hasVariants = false` when only inactive variants exist and `true` when at least one active variant exists.
   - `test/card-dto-no-n-plus-one`: Asserts card list query computes `hasVariants` without per-card N+1 queries.
   - `test/admin-list-dto-shape`: Asserts `AdminProductListDTO` contains `variantCount` (counting active variants) and does not load full variant arrays.
7. **Public vs Admin Detail Separation**:
   - `test/public-detail-lifecycle`: Asserts public detail rejects inactive/deleted product with HTTP 404.
   - `test/public-detail-active-variants`: Asserts public detail returns active variants only.
   - `test/public-detail-no-admin-leak`: Asserts public detail route never exposes admin audit fields.
   - `test/admin-detail-auth`: Asserts admin detail requires `requireAdmin`.
   - `test/admin-detail-all-variants`: Asserts admin detail returns all variants for editing.
8. **Admin Discount Filter**:
   - `test/admin-discount-filter`: Asserts `filter=discount` matches strictly `compareAtPrice IS NOT NULL AND compareAtPrice > price`.
9. **Homepage Bounded Reads**:
   - `test/homepage-no-full-catalog-load`: Verifies homepage queries do not execute unbounded `findMany`.
   - `test/homepage-batched-thumbnails`: Verifies representative subcategory images are retrieved via a single batched query with zero N+1 queries.
10. **Decimal Monetary Authority & Checkout Independence**:
    - `test/decimal-authority`: Verifies PostgreSQL `NUMERIC` / Prisma `Decimal` remains the sole monetary authority.
    - `test/dto-number-presentation-only`: Verifies serialized DTO JavaScript Number is strictly presentation-only.
    - `test/checkout-re-reads-authoritative-price`: Verifies checkout ignores catalog DTO prices and re-reads authoritative Decimal product/variant prices from database.

---

## 13. Scale & Qualitative Risk Assessment

| Catalog Scale | Architectural Risk Under Current Baseline | Architectural Risk Under Phase 5 Design | Qualitative Technical Rationale |
|---|---|---|---|
| **100 Products** | 🟢 **LOW RISK** | 🟢 **OPTIMAL** | The baseline system functions adequately with 100 products. Phase 5 streamlines query projection and removes redundant memory allocations. |
| **1,000 Products** | 🟡 **MODERATE RISK** | 🟢 **OPTIMAL** | Under the baseline, transferring all 1,000 product rows on every page load causes noticeable JSON serialization latency and browser payload bloat. Phase 5 restricts server reads to bounded 24-product slices regardless of total catalog size. |
| **10,000 Products** | 🔴 **HIGH RISK** | 🟢 **SCALABLE** | Under the baseline, unpaginated table scans across 10,000 products cause severe memory pressure, database connection load, and client rendering lag. Phase 5 utilizes candidate composite indexes and server-side limit/offset queries to fetch only requested slices. |

### Technical Analysis of Remaining Scaling Characteristics
1. **Count Query Overhead**: Total item counts via `prisma.product.count({ where })` require index scans whose performance depends on matching-set volume and index efficiency.
2. **Deep `OFFSET` Overhead**: SQL `OFFSET` cost increases with page depth as database engines scan preceding rows. The `MAX_PUBLIC_PAGE = 10_000` defensive limit prevents unbounded scan depth, while the `MAX_RESTORABLE_PUBLIC_PAGE = 10` UX boundary ensures typical customer interactions remain in the shallow, high-performance offset range.
3. **Substring Search (`ILIKE`)**: Search matching `%term%` cannot use standard B-tree index lookups and will evaluate matching rows in PostgreSQL; query complexity scales with the active product row count.

---

## 14. Explicit Phase Boundaries

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        PHASE 5 — CATALOG SCALABILITY                      │
│  • Server-side bounded pagination (take / skip / count)                   │
│  • Bounded progressive Load More data contracts (initial 24, +24)          │
│  • Server-authoritative filtering (category slug -> ID, scoped subcat, q) │
│  • Deterministic sorting (latest, price-asc, price-desc with ID tiebreaker)│
│  • Card DTO & Admin DTO separation (strip description / variants[])       │
│  • Query-proven candidate composite database indexes                      │
│  • Admin product list pagination & lightweight projections                │
│  • Bounded homepage catalog queries & batched thumbnail reads             │
└───────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼ DEFERRED
┌───────────────────────────────────────────────────────────────────────────┐
│ PHASE 6: Image & Media Infrastructure (Cloudinary/S3, WebP pipelines)     │
├───────────────────────────────────────────────────────────────────────────┤
│ PHASE 7: Performance Engineering (Distributed Redis cache, ISR tagging)   │
├───────────────────────────────────────────────────────────────────────────┤
│ PHASE 8: Premium Shopping UX (Faceted filter drawers, quick-view modals)   │
├───────────────────────────────────────────────────────────────────────────┤
│ PHASE 9: Checkout & Post-Purchase UX Overhaul                             │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 15. Spec Self-Review Checklist

- [x] Contradiction between `page = N` meaning and restoration resolved: `MAX_RESTORABLE_PUBLIC_PAGE = 10` with history replace normalization.
- [x] Server-side safety limit (`MAX_PUBLIC_PAGE = 10_000`, `MAX_ADMIN_PAGE = 10_000`) separated from performance claims; `OFFSET` depth cost accurately documented; safe integer bounds checked.
- [x] Unsupported `< 50,000 products` and "superior SEO" phrasing removed; replaced with accurate commercial scale and shareable URL semantics language.
- [x] Subcategory filter relationally scoped under active parent category; unscoped or cross-category subcategories return empty result.
- [x] Active category and subcategory lifecycle authority verified against existing schema (`Category.isActive = true`, `Subcategory.isActive = true`).
- [x] Homepage representative image strategy hardened (batched bounded read invariant, no generic Prisma distinct assumptions, no N+1, no complete catalog load).
- [x] Qualitative scale and risk assessment accurately reflects query-plan and count characteristics without fabricated numbers.
- [x] Index strategy explicitly frames indexes as candidates requiring PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` validation.
- [x] Comprehensive 10-part TDD verification plan covers all pagination, restoration, subcategory scoping, DTO, and Decimal authority contracts.
- [x] Decimal monetary authority vs presentation-only JavaScript Number explicitly distinguished.
- [x] Exact alignment with owner-locked decisions D1 through D9 maintained.
- [x] Strict isolation of Phase 5 from Phases 6–9.
- [x] Zero application/runtime code, Prisma schema, migrations, tests, or databases modified.

---

**Specification Locked By**: Antigravity Agent & Pure Haven BD Engineering  
**Next Step**: Await user final approval of hardened design specification before proceeding to Phase 5 implementation planning.
