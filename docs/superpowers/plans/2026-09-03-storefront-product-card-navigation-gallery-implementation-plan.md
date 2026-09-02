# Storefront Product Card, Gallery, and Navigation UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved premium storefront ProductCard, relational 1–4 image gallery authority, presentation-safe category/subcategory metadata, and scalable responsive category navigation without changing commerce authority.

**Architecture:** ProductImage becomes the relational gallery authority while Product.image remains an atomically synchronized compatibility mirror. Public catalog reads remain bounded through one Product query/count plus at most one ProductImage batch and at most one token-scoped Subcategory batch; the UI consumes presentation-safe names and structurally lazy gallery assets.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Prisma 7.9.1, PostgreSQL, existing Tailwind/CSS utilities, existing SafeImage/media conventions, Node.js native test runner (`tsx --test`), Chrome DevTools Protocol.

**Spec:** docs/superpowers/specs/2026-09-03-storefront-product-card-navigation-gallery-design.md

---

## Global Constraints & Locked Boundaries

1. **Currency Symbol (৳):** BDT currency symbol is strictly `৳` (`\u09F3`). Dollar (`$`) is never used for customer-facing price display.
2. **Product Display Authority (D1, D2):** `Product.name` is the single authoritative customer display title. `Product.displayName` is NOT introduced.
3. **Category Display Authority (D3):** `categoryRel.name` selected directly in the bounded product query is the primary category display value (fallback: `Product.category` snapshot, fallback: `null`).
4. **Subcategory Display Authority (D4, D5):** `Subcategory.name` via token-scoped bounded batch resolution is the display value. `Product.subcategoryId` is NOT introduced.
5. **Relational Gallery Authority (D6, D7, D8):** `ProductImage` is the authoritative gallery. `Product.image` is a synchronized compatibility primary-image mirror (position 1).
6. **Gallery Integrity & Bounds (D9, D10, D11):** 1..4 images per product. Unique constraint: `@@unique([productId, sortOrder])`. Redundant secondary indexes are omitted. Duplicate normalized URLs are rejected.
7. **Single Write Boundary (D12):** Existing authenticated `PUT /api/products` is the single product-edit and gallery write boundary. No second endpoint is introduced.
8. **Auth & Validation Boundary (D13):** `requireAdmin()` and syntactic request validation occur BEFORE transaction. Product existence and non-deleted eligibility are rechecked INSIDE transaction.
9. **3-Way Mutation Branching & Metadata Non-Mutation (D36):**
   - Case 1 (`kind: "gallery"`): `images` present -> full atomic replace of gallery (sortOrder 1..N), sets `primaryImageOverride = images[0]`, includes `image: primaryImageOverride` in Product update.
   - Case 2 (`kind: "legacy-image"`): No `images`, legacy `image` present -> updates position 1, preserves secondary positions 2..N without deletion, sets `primaryImageOverride = image`, includes `image: primaryImageOverride` in Product update.
   - Case 3 (`kind: "metadata-only"`): Neither present -> `primaryImageOverride` is undefined. `Product.image` MUST NOT be included in the Prisma update payload at all (`...(primaryImageOverride !== undefined ? { image: primaryImageOverride } : {})`). Zero `ProductImage` mutation; zero `Product.image` mutation.
10. **Gallery Conflict Semantics (D35):** If both `images` and legacy `image` are provided and differ from `images[0]`, reject with HTTP 400 before transaction.
11. **Persistence-Safe Image Normalization (H1):** Authoritative storage normalization uses `normalizeProductImageReference(value)`, which trims, validates accepted paths (`/uploads/products/...`, `/images/...`, or approved `https://...`), and rejects invalid inputs. It MUST NEVER substitute display fallback images (e.g. category placeholders).
12. **Catalog DB Read Pattern (D15, D16, D17):** Bounded Product query (explicitly selecting `categoryId` and `categoryRel.name`) + count + at most ONE batch `ProductImage` query + at most ONE token-scoped batch `Subcategory` query. Effective `pageSize <= 48` (normal chunk = 24). If `productIds` is empty or candidate pairs are empty, skip the corresponding batch query. Zero queries inside product loops.
13. **Structural Loading Guarantee (D18, D19):** On initial paint, ONLY the current/primary slide's image element is mounted in the DOM. Secondary images are loaded on user interaction/request via two-stage state machine (`displayedIndex`, `pendingIndex`). Preloading keeps current displayed image visible until the requested slide loads. At most next likely slide prefetched.
14. **Primary vs Secondary Gallery Failure Rules (D20, H2):** Primary (position 1) image failure retains card frame and displays standard `SafeImage` category fallback while leaving valid secondary slides navigable. Secondary image failure marks that secondary slide unavailable for the session, keeps the current displayed image, and skips the failed slide in navigation. If all real gallery URLs fail, standard `SafeImage` fallback renders in the fixed frame.
15. **Deterministic Badge Priority (D25, D26):** Single badge: Out of Stock (1) > Promotional (2) > Low Stock (3) > None (4). Disabled CTA button is labelled `Add to Cart`.
16. **No Customer-Facing Stock Text (D24):** No numeric `Stock: N` on customer product card.
17. **Responsive Desktop Navigation (D28, D29, D30, D31):** Desktop horizontal nav begins at `lg` (>= 1024px). Primary budget = 4 active categories (`DESKTOP_NAV_PRIMARY_BUDGET = 4`) sorted deterministically by `sortOrder ASC, id ASC`. Top-level Category label is a direct Next.js `Link` navigating to `/shop?category={slug}`. Grouped `More ▼` panel without nested hover trees.
18. **Mobile / Tablet Navigation (D37):** Below `lg` (< 1024px), categories with active subcategories use TWO distinct controls: `Category.name` navigation link + separate disclosure button (`aria-expanded`, `aria-controls`). Categories with zero subcategories render navigation link only without disclosure.
19. **Admin Gallery Reordering (D38):** Accessible Up/Down buttons (boundary disabled). Drag-and-drop is not required.
20. **Product Detail Gallery Consistency & Variant Image Preservation:** Product detail consumes the same `ProductImage` authority (`sortOrder ASC, id ASC`). Existing selected-variant image behavior remains a presentation override: when `selectedVariant?.image?.trim()` is present, that variant image displays; when no variant image applies, base gallery image is shown. Selecting/changing variants never mutates `ProductImage` authority.
21. **True TDD RED Policy (No Fake Stubs):** Module-not-found, import failure, undefined property on unregenerated client, missing helper file, missing env var, syntax/type errors unrelated to behavior, and DB setup failure NEVER count as valid RED. A valid RED must reach a behavioral assertion. Setup/import failures must be resolved before recording RED. When extracting pure helpers from existing behavior, perform a behavior-preserving extraction first, verify existing tests pass GREEN, and only then write the new behavioral test to obtain the genuine RED. Never create intentionally broken production stubs solely to manufacture REDs.
22. **Migration Acceptance Policy:** The ProductImage migration and universal backfill must be verified with `npx prisma migrate deploy` against a dedicated disposable test database starting at the pre-ProductImage migration state. `prisma db push` is strictly prohibited for migration acceptance.
23. **Database Safety Protocol & Target Validation:**
    - Dedicated Phase-5 PostgreSQL test container: `pure-haven-phase5-test-postgres`.
    - Before migration testing, verify test container exists and runs. Create a uniquely named disposable database inside test container: `pure_haven_storefront_gallery_<timestamp>`.
    - Transform `DATABASE_URL_TEST` in memory to point to this disposable DB name. Never echo/print the credential-bearing URL.
    - Safety validation must validate the ACTUAL disposable target before `pg` connection, `prisma migrate deploy`, or dynamic import.
    - Node `child_process` execution uses `process.platform === "win32" ? "npx.cmd" : "npx"` and explicitly injects `DATABASE_URL: disposableTestUrl`.
    - Never print credentials, passwords, or full connection URLs.
    - Disposable DB and temp baseline/archive cleanup runs under `try/finally` semantics unconditionally on RED, error, failure, or GREEN. If cleanup fails, it is reported explicitly without masking the primary outcome.

---

## Planned File Responsibility Map

| File Path | Action | Single Responsibility | Task Ownership | Downstream Dependencies |
|---|---|---|---|---|
| `prisma/schema.prisma` | **MODIFY** | Add `ProductImage` model with `@@unique([productId, sortOrder])` and relation to `Product.images`. | Task 1 | Tasks 2, 3, 4, 9, 10 |
| `prisma/migrations/20260903000000_add_product_image_gallery/migration.sql` | **CREATE** | SQL migration to create `ProductImage` table with FK, unique constraint, and universal backfill for all non-empty `Product.image`. | Task 1 | Tasks 2, 10 |
| `lib/catalog/galleryPersistence.ts` | **CREATE** | Pure persistence helper `normalizeProductImageReference(value)`: trims, verifies allowed path prefixes, rejects invalid/empty input, never substitutes display fallback assets. | Task 2 | Tasks 2, 5 |
| `lib/catalog/galleryWrite.ts` | **CREATE** | Narrow transactional gallery helper: defines `GalleryWriteIntent` union (`gallery` | `legacy-image` | `metadata-only`), `parseGalleryWriteIntent(body)`, and `applyGalleryMutation(tx, { productId, intent })`. Does not own unrelated product fields. Returns `{ primaryImageOverride?: string }`. | Task 2 | Task 2 |
| `app/api/products/route.ts` | **MODIFY** | `PUT /api/products`: pre-transaction syntactic validation, in-transaction Product revalidation, invoke `applyGalleryMutation`, preserve existing product update mapping with `image` conditionally added only when `primaryImageOverride !== undefined`. | Task 2 | Tasks 3, 5 |
| `lib/catalog/types.ts` | **MODIFY** | Update `PublicProductCardDTO` (`images: string[]`, `categoryName: string | null`, `subcategoryName: string | null`) and `AdminProductDetailDTO` (`images: string[]`). | Task 3, Task 4 | Tasks 4, 5, 6, 7, 9 |
| `lib/catalog/adminCatalogQuery.ts` | **MODIFY** | Update `getAdminProductDetailQuery` to select `images` ordered by `sortOrder ASC, id ASC` (falling back to `[product.image]`). | Task 3 | Task 5 |
| `lib/catalog/subcategoryResolution.ts` | **CREATE** | Token-scoped bounded subcategory batch lookup: collects unique `(categoryId, token)` pairs (capped at `pageSize <= 48`), executes candidate query, builds in-memory map. Skips query if candidates empty. | Task 4 | Task 4 |
| `lib/catalog/publicCatalogQuery.ts` | **MODIFY** | Select `categoryId`, `categoryRel.name`; run concurrent count; batch query `ProductImage` (skip if no products); batch query token-scoped subcategories (skip if no candidates); assemble `PublicProductCardDTO`. | Task 4 | Tasks 6, 9 |
| `lib/catalog/adminGalleryState.ts` | **CREATE** | Pure state transition helpers for admin edit UI gallery: `moveGalleryItemUp`, `moveGalleryItemDown`, `canAddGalleryItem`, `canRemoveGalleryItem`, `serializeGalleryPayload`. | Task 5 | Task 5 |
| `app/admin/products/[id]/edit/page.tsx` | **MODIFY** | Admin edit UI: display effective 1..4 gallery manager, Add image, Remove image, accessible Move Up / Move Down buttons, save full `images[]` payload. | Task 5 | None |
| `components/ui/productCardPresentation.ts` | **CREATE** | Pure presentation helpers for ProductCard: `resolveEyebrow`, `resolveCardBadge`, `resolveCardCTA`, and `formatCardPrice`. | Task 6 | Tasks 6, 7 |
| `components/ui/ProductCard.tsx` | **MODIFY** | Wire new props (`images`, `categoryName`, `subcategoryName`), render unboxed eyebrow, remove numeric `Stock: N`, enforce single OOS badge, disabled `Add to Cart` CTA label, and literal `৳` price formatting. | Task 6, Task 7 | Tasks 6, 7 |
| `components/shop/ProgressiveProductGrid.tsx` | **MODIFY** | Forward new DTO fields (`images`, `categoryName`, `subcategoryName`) to `ProductCard` preserving local mapping. | Task 6 | None |
| `components/shop/ShopProductGridClient.tsx` | **MODIFY** | Forward new DTO fields to `ProductCard` preserving local mapping. | Task 6 | None |
| `components/home/ProductSection.tsx` | **MODIFY** | Forward new DTO fields to `ProductCard` preserving local mapping. | Task 6 | None |
| `components/ui/carouselNavigation.ts` | **CREATE** | Pure state machine helpers for carousel: two-stage state model (`displayedIndex`, `pendingIndex`), preloading request, load completion, secondary failure skip, primary failure fallback. | Task 7 | Task 7 |
| `components/ui/ProductCardCarousel.tsx` | **CREATE** | Multi-image carousel within `ProductCard`: structural loading (mount only current slide), Next/Prev buttons, slide indicators, touch/swipe, error skip, keyboard navigation. | Task 7 | Task 7 |
| `components/layout/navbarNavigation.ts` | **CREATE** | Pure category navigation helpers: `sortAndSplitNavCategories(categories, budget = 4)` with deterministic `sortOrder ASC, id ASC` sort using concrete `PublicCategory` types. | Task 8 | Task 8 |
| `components/layout/Navbar.tsx` | **MODIFY** | Implement desktop `lg` breakpoint, `DESKTOP_NAV_PRIMARY_BUDGET = 4`, direct Category Next.js `Link` navigation, grouped `More ▼` panel, and mobile two-control accordion. | Task 8 | None |
| `lib/getProducts.ts` | **MODIFY** | Update `Product` type with `images?: string[]`, map `images` in `mapProduct`. | Task 9 | Task 9 |
| `components/product/ProductDetailsClient.tsx` | **MODIFY** | Support multi-image gallery thumbnail selection from `product.images` alongside variants, preserving existing variant image presentation override. | Task 9 | None |
| `tests/product-image-schema.test.ts` | **CREATE** | PostgreSQL schema contract test: checks table absence on baseline, applies migration via `prisma migrate deploy` with explicit disposable DATABASE_URL, verifies table, constraint, no redundant index, universal backfill parity. | Task 1 | None |
| `tests/product-gallery-write.test.ts` | **CREATE** | Integration tests for `PUT /api/products`: 3 write intent cases (including metadata-only `Product.image` non-mutation), conflict rejection, pre-tx auth, in-tx revalidation. | Task 2 | None |
| `tests/admin-product-gallery-read.test.ts` | **CREATE** | Integration tests for admin product detail query returning ordered `images[]`. | Task 3 | None |
| `tests/public-catalog-gallery-query.test.ts` | **CREATE** | Integration tests for public catalog query: token-scoped subcategories (max 48), batched `ProductImage` query, categoryRel.name mapping, query count bounding. | Task 4 | None |
| `tests/admin-gallery-edit-ui.test.ts` | **CREATE** | Pure state transition tests for admin gallery reorder/add/remove logic and boundary states. | Task 5 | None |
| `tests/product-card-retail-hierarchy.test.ts` | **CREATE** | Unit tests for pure presentation helpers and card props: eyebrow, single OOS badge, disabled `Add to Cart` label, no `Stock: N`, BDT symbol `৳`, commerce payload preservation. | Task 6 | None |
| `tests/product-card-carousel.test.ts` | **CREATE** | Unit tests for carousel state machine: structural mounting, pending/displayed index transitions, secondary slide skip on failure, primary failure fallback. | Task 7 | None |
| `tests/responsive-navigation-hierarchy.test.ts` | **CREATE** | Unit tests for navbar category sorting and splitting, Next.js `Link` paths, and mobile two-control accordion data. | Task 8 | None |
| `tests/product-detail-shared-gallery.test.ts` | **CREATE** | Tests verifying product detail shares `ProductImage` gallery authority with card while preserving variant image presentation overrides. | Task 9 | None |
| `tests/migration-rehearsal-postgres.test.ts` | **CREATE** | Comprehensive PostgreSQL migration rehearsal on disposable DB from pre-ProductImage baseline: deploy via `prisma migrate deploy` with explicit disposable DATABASE_URL, universal backfill parity, constraint rejection, idempotency. | Task 10 | None |
| `tests/storefront-responsive-browser-qa.test.ts` | **CREATE** | CDP browser automation acceptance test verifying 375×667, 768×1024, 1280×800 viewports, structural deferred network loading, and secret-safe evidence bundle. | Task 11 | None |

---

## Task Dependency & Interface Map

```
Task 1 (ProductImage Schema & Migration)
  │
  ├──────────────────────────────┬──────────────────────────────┐
  ▼                              ▼                              ▼
Task 2 (Write Authority & PUT)  Task 3 (Admin Detail Read)    Task 4 (Public Bounded Catalog Query)
  │                              │                              │
  └──────────────┬───────────────┘                              │
                 ▼                                              ▼
          Task 5 (Admin Gallery UI)                     Task 6 (ProductCard Cutover & Retail Hierarchy)
                                                                │
                                                                ▼
                                                        Task 7 (Image Carousel & Structural Lazy)
                                                                │
                                                                ▼
Task 8 (Responsive Navigation Hierarchy) ◄──────────────────────┤
                                                                ▼
Task 9 (Product Detail Shared Gallery) ◄────────────────────────┤
                                                                ▼
Task 10 (PostgreSQL Migration Rehearsal & Backfill Verification)
                                                                ▼
Task 11 (Full Regression & Real-Browser Responsive QA: 375, 768, 1280)
```

---

## Detailed Task Specifications

### TASK 1 — PRODUCTIMAGE SCHEMA + MIGRATION CONTRACT

- **Goal:** Add `ProductImage` model to Prisma schema with `@@unique([productId, sortOrder])`, create SQL migration with universal backfill for all existing `Product` rows with non-empty `Product.image`, and write behavioral schema contract tests verifying relational integrity and backfill parity against a disposable PostgreSQL database initialized at the Phase-5 baseline.
- **Files:**
  - Modify: `prisma/schema.prisma`
  - Create: `prisma/migrations/20260903000000_add_product_image_gallery/migration.sql`
  - Create: `tests/product-image-schema.test.ts`
- **Database Provisioning, Safety & Cleanup Protocol:**
  - Verify test container runs: `docker ps --filter "name=pure-haven-phase5-test-postgres" --format "{{.Names}}"`. Fail closed if absent.
  - Create disposable DB inside container:
    ```powershell
    $dbName = "pure_haven_storefront_gallery_" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    docker exec -e "DB_NAME=$dbName" pure-haven-phase5-test-postgres sh -lc 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE "$DB_NAME""'
    ```
  - Derive `$disposableTestUrl` in memory from `DATABASE_URL_TEST` by changing database name to `$dbName`. Never print the full URL.
  - Validate that `$disposableTestUrl` is distinct from production and matches `$dbName` before any connection or migration.
  - All operations run inside `try/finally` semantics:
    ```powershell
    $prevDbUrl   = $env:DATABASE_URL
    $tempBaseline = Join-Path $env:TEMP "pure-haven-phase5-prisma-baseline"
    $tempArchive  = Join-Path $env:TEMP "pure-haven-phase5-prisma-baseline.tar"

    try {
      # baseline export, migrate deploy, test, schema edit, migrate deploy, verify GREEN
    } finally {
      $cleanupErrors = @()
      if (Test-Path $tempBaseline) {
        try { Remove-Item -Recurse -Force $tempBaseline } catch { $cleanupErrors += "Failed to remove tempBaseline: $_" }
      }
      if (Test-Path $tempArchive) {
        try { Remove-Item -Force $tempArchive } catch { $cleanupErrors += "Failed to remove tempArchive: $_" }
      }
      try {
        docker exec -e "DB_NAME=$dbName" pure-haven-phase5-test-postgres sh -lc 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE "$DB_NAME" WITH (FORCE)"'
      } catch {
        $cleanupErrors += "Failed to drop disposable database: $_"
      }
      $env:DATABASE_URL = $prevDbUrl
      if ($cleanupErrors.Count -gt 0) {
        Write-Error ('Cleanup errors encountered:' + [Environment]::NewLine + ($cleanupErrors -join [Environment]::NewLine))
      }
    }
    ```
- **Binary-Safe Baseline Export Mechanism:**
  - Export the Phase-5 locked baseline Prisma directory from commit `da6f210729f75ae39469efa665cb22229f9a5b8e` using binary-safe intermediate archive:
    ```powershell
    if (Test-Path $tempBaseline) { Remove-Item -Recurse -Force $tempBaseline }
    if (Test-Path $tempArchive)  { Remove-Item -Force $tempArchive }
    New-Item -ItemType Directory -Force $tempBaseline | Out-Null
    git archive --format=tar -o "$tempArchive" da6f210729f75ae39469efa665cb22229f9a5b8e prisma
    if ($LASTEXITCODE -ne 0) { throw "Failed to export Phase-5 Prisma baseline archive" }
    tar -xf "$tempArchive" -C "$tempBaseline"
    if ($LASTEXITCODE -ne 0) { throw "Failed to extract Phase-5 Prisma baseline archive" }
    ```
  - Deploy baseline migration tree using `npx.cmd` (Windows) or `npx` with explicit `$env:DATABASE_URL = $disposableTestUrl`:
    ```powershell
    $env:DATABASE_URL = $disposableTestUrl
    $npxCmd = if ($IsWindows -or $env:OS -match "Windows") { "npx.cmd" } else { "npx" }
    & $npxCmd prisma migrate deploy --schema "$tempBaseline\prisma\schema.prisma"
    if ($LASTEXITCODE -ne 0) { throw "Failed to deploy baseline migrations to disposable DB" }
    ```
  - Seed legacy `Product` rows using raw `pg` connecting to `$disposableTestUrl` after baseline deployment:
    - Active product with `image = "/uploads/products/active.jpg"`
    - Inactive product (`isActive = false`) with `image = "/uploads/products/inactive.jpg"`
    - Soft-deleted product (`deletedAt = NOW()`) with `image = "/uploads/products/deleted.jpg"`
    - Empty-image product with `image = ""`
- **True TDD RED Strategy:**
  - On the deployed baseline test DB, run `tests/product-image-schema.test.ts`.
  - The test queries PostgreSQL `information_schema.tables` for `table_name = 'ProductImage'`.
  - Assert that `ProductImage` table exists.
  - **RED:** Fails with `AssertionError: ProductImage table must exist` (a true schema-behavior assertion failure; do NOT query backfill assertions before confirming table exists to prevent SQL relation-not-found errors).
- **Interfaces / Data Contracts:**
  ```prisma
  model ProductImage {
    id        Int      @id @default(autoincrement())
    productId Int
    product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
    url       String
    sortOrder Int      @default(0)
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    @@unique([productId, sortOrder])
  }
  ```
- [ ] **Step 1: Deploy baseline to disposable DB and write failing schema contract test (`tests/product-image-schema.test.ts`)**
  Create test suite using raw `pg` client connecting to `disposableTestUrl`:
  - Verify safety before connection.
  - Introspect `information_schema.tables` where `table_schema = 'public'` and `table_name = 'ProductImage'`.
  - Assert `assert.strictEqual(rows.length, 1, "ProductImage table must exist")`.
  - Following table existence check:
    - Introspect `information_schema.table_constraints` for unique constraint on `(productId, sortOrder)`.
    - Introspect `pg_indexes` to assert no redundant secondary index on `(productId, sortOrder)`.
    - Universal backfill verification: assert that every seeded product (active, inactive, soft-deleted) with non-empty `image` has exactly one `ProductImage` row with `sortOrder = 1` and `url = TRIM(image)`, and empty `image` has 0 rows.
- [ ] **Step 2: Run test against baseline DB to verify meaningful RED**
  ```powershell
  $env:DATABASE_URL = $disposableTestUrl
  npx tsx --test tests/product-image-schema.test.ts
  ```
  Expected failure: `AssertionError [ERR_ASSERTION]: ProductImage table must exist` (true schema-behavior RED).
- [ ] **Step 3: Implement schema change and migration SQL**
  - In `prisma/schema.prisma`: add `ProductImage` model with `@@unique([productId, sortOrder])` and add `images ProductImage[]` relation on `Product`. Do NOT add redundant `@@index`.
  - Create migration SQL in `prisma/migrations/20260903000000_add_product_image_gallery/migration.sql`:
    ```sql
    -- CreateTable
    CREATE TABLE "ProductImage" (
        "id" SERIAL NOT NULL,
        "productId" INTEGER NOT NULL,
        "url" TEXT NOT NULL,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
    );

    -- CreateIndex
    CREATE UNIQUE INDEX "ProductImage_productId_sortOrder_key" ON "ProductImage"("productId", "sortOrder");

    -- AddForeignKey
    ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- Universal Backfill for ALL products with non-empty image (active, inactive, or soft-deleted)
    INSERT INTO "ProductImage" ("productId", "url", "sortOrder", "createdAt", "updatedAt")
    SELECT p."id", TRIM(p."image"), 1, NOW(), NOW()
    FROM "Product" p
    WHERE p."image" IS NOT NULL
      AND TRIM(p."image") != ''
      AND NOT EXISTS (
        SELECT 1 FROM "ProductImage" pi WHERE pi."productId" = p."id"
      );
    ```
  - Deploy migration to disposable DB using current repository schema with explicit `$env:DATABASE_URL = $disposableTestUrl`:
    ```powershell
    $env:DATABASE_URL = $disposableTestUrl
    $npxCmd = if ($IsWindows -or $env:OS -match "Windows") { "npx.cmd" } else { "npx" }
    & $npxCmd prisma migrate deploy --schema ".\prisma\schema.prisma"
    if ($LASTEXITCODE -ne 0) { throw "Failed to deploy new migration to disposable DB" }
    & $npxCmd prisma generate
    if ($LASTEXITCODE -ne 0) { throw "Failed to generate Prisma Client" }
    ```
- [ ] **Step 4: Run targeted test to verify GREEN**
  ```powershell
  $env:DATABASE_URL = $disposableTestUrl
  npx tsx --test tests/product-image-schema.test.ts
  ```
  Verify: Table exists, unique constraint exists, no redundant index, universal backfill matches across all products. Cleanup executes in `finally`.
- [ ] **Step 5: Run regression suite**
  ```powershell
  npx prisma validate
  npm test
  ```
- [ ] **Step 6: Self-review diff**
  ```powershell
  git diff prisma/schema.prisma
  ```
  Confirm no redundant `@@index`, exact casing, cascade on delete.
- [ ] **Step 7: Commit**
  ```powershell
  git add prisma/schema.prisma prisma/migrations tests/product-image-schema.test.ts
  git commit -m "feat: add product image gallery schema and universal backfill"
  ```

---

### TASK 2 — GALLERY DOMAIN VALIDATION + WRITE AUTHORITY

- **Goal:** Implement pure persistence normalization in `lib/catalog/galleryPersistence.ts`, narrow gallery intent parsing and mutation execution in `lib/catalog/galleryWrite.ts`, and wire into existing `PUT /api/products` in `app/api/products/route.ts`. Pre-transaction validation handles syntactic checks; target Product existence and soft-delete state are re-evaluated inside transaction. Existing route mapping for product fields is fully preserved, with `Product.image` included in the update payload only when `primaryImageOverride !== undefined`. On metadata-only PUT (Case 3), `Product.image` is NOT included in the update payload.
- **Files:**
  - Create: `lib/catalog/galleryPersistence.ts`
  - Create: `lib/catalog/galleryWrite.ts`
  - Modify: `app/api/products/route.ts`
  - Create: `tests/product-gallery-write.test.ts`
- **Database Safety Guard:**
  - Dynamic Prisma import after checking `DATABASE_URL_TEST` and `validateTestDatabaseSafety()`.
- **True TDD RED Strategy:**
  - Test against existing `PUT /api/products` route without importing nonexistent helper modules.
  - Send `PUT` with `images: [url1, url2]`.
  - **RED:** Existing route ignores `images` and does not persist gallery rows, so querying `ProductImage` returns 0 rows. Assertion `assert.strictEqual(imagesCount, 2)` fails on behavioral result.
- **Interfaces / Data Contracts:**
  ```typescript
  // lib/catalog/galleryPersistence.ts
  export function normalizeProductImageReference(value: unknown):
    | { ok: true; url: string }
    | { ok: false; error: string };

  // lib/catalog/galleryWrite.ts
  export type GalleryWriteIntent =
    | { kind: "gallery"; images: string[] }
    | { kind: "legacy-image"; image: string }
    | { kind: "metadata-only" };

  export function parseGalleryWriteIntent(body: Record<string, unknown>):
    | { ok: true; intent: GalleryWriteIntent }
    | { ok: false; statusCode: 400; message: string };

  export async function applyGalleryMutation(
    tx: Prisma.TransactionClient,
    params: { productId: number; intent: GalleryWriteIntent }
  ): Promise<{ primaryImageOverride?: string }>;
  ```
- [ ] **Step 1: Write failing behavioral test (`tests/product-gallery-write.test.ts`)**
  Test cases using authentic admin session:
  - Validation: empty images array rejected (400); > 4 images rejected (400); duplicate normalized URLs rejected (400).
  - Conflict: `images` provided and legacy `image` differs from `images[0]` -> rejected (400) before transaction.
  - Conflict: `images` provided and legacy `image` equals `images[0]` -> succeeds.
  - Case 1 (`kind: "gallery"`): `images: [url1, url2, url3]` -> full replace of gallery (sortOrder 1, 2, 3), `Product.image === url1`.
  - Case 2 (`kind: "legacy-image"`): `image: urlNew` -> updates sortOrder 1 to `urlNew`, preserves positions 2 and 3, `Product.image === urlNew`.
  - Case 2 Duplicate: `image: url2` (which matches existing position 2) -> rejected (400).
  - Case 3 (`kind: "metadata-only"`): metadata-only PUT -> `ProductImage` rows unchanged, `Product.image` unchanged, and Prisma product update data does not include `image`.
  - Soft-delete race: product soft-deleted before transaction -> rejected (400) inside transaction.
- [ ] **Step 2: Run test to verify meaningful RED**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/product-gallery-write.test.ts
  ```
  Expected failure: `assert.strictEqual(imagesCount, 2)` fails because `images` is not yet processed by route.
- [ ] **Step 3: Implement persistence normalization, narrow gallery write helper, and route integration**
  - Implement `lib/catalog/galleryPersistence.ts`:
    - Trims string. Rejects empty/non-string input.
    - Verifies allowed path prefixes (`/uploads/products/`, `/images/`, or approved `https://`).
    - Does NOT substitute display fallback assets (e.g. `DEFAULT_PRODUCT_IMAGE`).
    - Returns `{ ok: true, url: normalized }` or `{ ok: false, error }`.
  - Implement `lib/catalog/galleryWrite.ts`:
    - `parseGalleryWriteIntent(body)`:
      - If `body.images` present: validates 1..4 count, normalizes with `normalizeProductImageReference`, detects duplicates with `Set`. If `body.image` also present, checks `normalize(body.image) === normalized[0]`. Returns `kind: "gallery"`.
      - Else if `body.image` present: normalizes URL. Returns `kind: "legacy-image"`.
      - Else: returns `kind: "metadata-only"`.
    - `applyGalleryMutation(tx, { productId, intent })`:
      - If `kind === "gallery"`: `tx.productImage.deleteMany({ where: { productId } })`, `tx.productImage.createMany(...)`, returns `{ primaryImageOverride: intent.images[0] }`.
      - If `kind === "legacy-image"`: reads existing rows; if `intent.image` matches any position >= 2, throws 400; upserts position 1, preserves 2..N; returns `{ primaryImageOverride: intent.image }`.
      - If `kind === "metadata-only"`: returns `{}`.
  - In `app/api/products/route.ts`:
    - Parse `galleryIntent = parseGalleryWriteIntent(body)`. If not ok, return 400 immediately before transaction.
    - Inside transaction: re-read Product; verify exists and `deletedAt === null`.
    - Call `const { primaryImageOverride } = await applyGalleryMutation(tx, { productId: id, intent: galleryIntent.intent })`.
    - Build update payload preserving existing fields, conditionally attaching `image` only when `primaryImageOverride` is defined:
      ```typescript
      const productUpdateData = {
        ...existingValidatedProductUpdateFields,
        ...(primaryImageOverride !== undefined ? { image: primaryImageOverride } : {}),
      };
      await tx.product.update({ where: { id }, data: productUpdateData });
      ```
- [ ] **Step 4: Run targeted test to verify GREEN**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/product-gallery-write.test.ts
  ```
- [ ] **Step 5: Run regression suite**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/products-api-atomic-cutover.test.ts
  ```
- [ ] **Step 6: Self-review diff**
  Confirm auth before transaction, proper transaction rollback, metadata-only non-mutation of `Product.image`.
- [ ] **Step 7: Commit**
  ```powershell
  git add lib/catalog/galleryPersistence.ts lib/catalog/galleryWrite.ts app/api/products/route.ts tests/product-gallery-write.test.ts
  git commit -m "feat: enforce product gallery write authority and 3-way mutation branching"
  ```

---

### TASK 3 — ADMIN PRODUCT READ CONTRACT FOR GALLERY

- **Goal:** Update `AdminProductDetailDTO` and `getAdminProductDetailQuery` to return ordered `images: string[]` for product edit/detail, while ensuring `AdminProductListDTO` does not materialize full galleries.
- **Files:**
  - Modify: `lib/catalog/types.ts`
  - Modify: `lib/catalog/adminCatalogQuery.ts`
  - Create: `tests/admin-product-gallery-read.test.ts`
- **Database Safety Guard:**
  - Dynamic Prisma import after checking `DATABASE_URL_TEST` and `validateTestDatabaseSafety()`.
- **True TDD RED Strategy:**
  - Seed product with 3 `ProductImage` rows in test DB.
  - Call `getAdminProductDetailQuery(productId)`.
  - **RED:** `assert.deepEqual(detail.images, [url1, url2, url3])` fails because `detail.images` is undefined on current query.
- **Interfaces / Data Contracts:**
  ```typescript
  // In lib/catalog/types.ts:
  export type AdminProductDetailDTO = AdminProductListDTO & {
    images: string[]; // Ordered gallery URLs; fallback: [image]
    description: string | null;
    deletedAt: string | null;
    updatedAt: string;
    variants: AdminProductVariantDTO[];
  };
  ```
- [ ] **Step 1: Write failing behavioral test (`tests/admin-product-gallery-read.test.ts`)**
  Test cases:
  - Product with 3 `ProductImage` rows returns `images` array of 3 URLs strictly ordered by `sortOrder ASC, id ASC`.
  - Product with 0 `ProductImage` rows returns `images: [product.image]` fallback.
  - `getAdminCatalogQuery` (list view) items do NOT include `images` array (keeps list lightweight).
- [ ] **Step 2: Run test to verify meaningful RED**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/admin-product-gallery-read.test.ts
  ```
  Expected failure: `assert.strictEqual(detail.images.length, 3)` fails because property is undefined on DTO.
- [ ] **Step 3: Implement DTO update and admin query projection**
  - Add `images: string[]` to `AdminProductDetailDTO` in `lib/catalog/types.ts`.
  - In `getAdminProductDetailQuery` in `lib/catalog/adminCatalogQuery.ts`:
    - Include `images: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }` in Prisma query.
    - Map `images: product.images.length > 0 ? product.images.map(img => img.url) : [product.image]`.
- [ ] **Step 4: Run targeted test to verify GREEN**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/admin-product-gallery-read.test.ts
  ```
- [ ] **Step 5: Run regression suite**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/admin-catalog-query.test.ts
  ```
- [ ] **Step 6: Self-review diff**
  Confirm admin list DTO remains lightweight without `images` property.
- [ ] **Step 7: Commit**
  ```powershell
  git add lib/catalog/types.ts lib/catalog/adminCatalogQuery.ts tests/admin-product-gallery-read.test.ts
  git commit -m "feat: expose ordered gallery in admin product detail query"
  ```

---

### TASK 4 — PUBLIC CATALOG PRESENTATION + BATCHED MEDIA

- **Goal:** Update `PublicProductCardDTO` with `images: string[]`, `categoryName: string | null`, `subcategoryName: string | null`. Implement token-scoped subcategory batch resolution and batched `ProductImage` retrieval in `getPublicCatalogQuery`. Enforce bounded queries: if `productIds` is empty, skip `ProductImage` batch; if subcategory candidate pairs are empty, skip subcategory batch. Zero queries in loops.
- **Files:**
  - Modify: `lib/catalog/types.ts`
  - Create: `lib/catalog/subcategoryResolution.ts`
  - Modify: `lib/catalog/publicCatalogQuery.ts`
  - Create: `tests/public-catalog-gallery-query.test.ts`
- **Database Safety Guard:**
  - Dynamic Prisma import after checking `DATABASE_URL_TEST` and `validateTestDatabaseSafety()`.
- **True TDD RED Strategy:**
  - Call `getPublicCatalogQuery` on seeded catalog in test DB.
  - **RED:** `assert.ok(Array.isArray(items[0].images))` and `assert.strictEqual(items[0].categoryName, "...")` fail on missing properties.
- **Interfaces / Data Contracts:**
  ```typescript
  // lib/catalog/types.ts
  export type PublicProductCardDTO = {
    id: number;
    name: string;
    price: number;
    compareAtPrice: number | null;
    image: string;
    images: string[];
    category: string;
    categoryName: string | null;
    subcategoryName: string | null;
    stock: number;
    isHotDeal: boolean;
    isUpcoming: boolean;
    badgeText: string | null;
    badgeTone: string;
    hasVariants: boolean;
  };

  // lib/catalog/subcategoryResolution.ts
  export async function resolveSubcategoryBatch(
    items: Array<{ categoryId: number | null; subcategory: string | null }>
  ): Promise<Map<number, Map<string, string>>>;
  ```
- [ ] **Step 1: Write failing behavioral test (`tests/public-catalog-gallery-query.test.ts`)**
  Test cases:
  - `categoryId` explicitly selected in bounded query.
  - `categoryName` matches `categoryRel.name`; falls back to `category` snapshot; falls back to `null`.
  - `subcategoryName` resolves when `Product.subcategory` matches slug (case-insensitive).
  - `subcategoryName` resolves when `Product.subcategory` matches name (case-insensitive).
  - `subcategoryName` returns `null` when token is unmatched.
  - Token-scoped Subcategory batch query candidate conditions <= effective page count (at most 48).
  - Empty productIds skips `ProductImage` batch query.
  - Empty subcategory candidate pairs skips `Subcategory` batch query.
  - `images` array matches ordered `ProductImage` rows (up to 4); falls back to `[product.image]`.
  - Query shape verification: exactly ONE Product query + count + at most ONE ProductImage query + at most ONE Subcategory query (no queries in loops).
- [ ] **Step 2: Run test to verify meaningful RED**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/public-catalog-gallery-query.test.ts
  ```
  Expected failure: `assert.ok(items[0].images)` fails on property absence.
- [ ] **Step 3: Implement token-scoped resolution and public catalog query**
  - Update `PublicProductCardDTO` in `lib/catalog/types.ts`.
  - Create `lib/catalog/subcategoryResolution.ts`:
    - Filters unique pairs `(categoryId, token.toLowerCase())` where `categoryId` is non-null and token is non-empty.
    - If pairs are empty, returns empty `Map` immediately without querying DB.
    - Constructs `OR` conditions for candidate matching.
    - Executes single query `prisma.subcategory.findMany({ where: { OR: candidateConditions } })`.
    - Returns lookup map: `Map<categoryId, Map<tokenLower, subcategoryName>>`.
  - Update `getPublicCatalogQuery` in `lib/catalog/publicCatalogQuery.ts`:
    - Select `categoryId: true`, `categoryRel: { select: { name: true } }`, `subcategory: true`.
    - Concurrently fetch `ProductImage` rows ONLY if `products.length > 0`.
    - Group `ProductImage` URLs by `productId` and cap at 4.
    - Execute `resolveSubcategoryBatch(products)`.
    - Map each item to `PublicProductCardDTO`.
  - Update `getPublicProductDetailQuery` to also include `images: string[]`, `categoryName`, and `subcategoryName`.
- [ ] **Step 4: Run targeted test to verify GREEN**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/public-catalog-gallery-query.test.ts
  ```
- [ ] **Step 5: Run public catalog regression suite**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/public-catalog-query.test.ts
  ```
- [ ] **Step 6: Self-review diff**
  Confirm no N+1 queries, verify `categoryId` is explicitly selected, confirm `categoryRel.name` precedence, confirm empty batches skipped.
- [ ] **Step 7: Commit**
  ```powershell
  git add lib/catalog/types.ts lib/catalog/subcategoryResolution.ts lib/catalog/publicCatalogQuery.ts tests/public-catalog-gallery-query.test.ts
  git commit -m "feat: add token-bounded subcategory resolution and batched media to public catalog query"
  ```

---

### TASK 5 — ADMIN GALLERY EDIT UI

- **Goal:** Implement pure gallery state transition helpers in `lib/catalog/adminGalleryState.ts` and update `app/admin/products/[id]/edit/page.tsx` to display an accessible 1..4 gallery manager with Add, Remove, and accessible Move Up / Move Down buttons (with boundary disabling). Remove the legacy standalone image field and submit the full ordered `images[]` payload.
- **Files:**
  - Create: `lib/catalog/adminGalleryState.ts`
  - Modify: `app/admin/products/[id]/edit/page.tsx`
  - Create: `tests/admin-gallery-edit-ui.test.ts`
- **True TDD RED Strategy:**
  - Perform a behavior-preserving enabling extraction of existing gallery behavior:
    - `lib/catalog/adminGalleryState.ts` is created with existing state logic (single image representation).
    - Existing tests pass GREEN.
  - Now write the new behavioral tests in `tests/admin-gallery-edit-ui.test.ts` asserting the NEW multi-image reordering operations:
    - `moveGalleryItemUp(items, 1)`
    - `moveGalleryItemDown(items, 0)`
    - `canAddGalleryItem(items)`
    - `canRemoveGalleryItem(items)`
  - **RED:** Fails on the behavioral assertions because multi-image reordering is not yet implemented.
- **Interfaces / Data Contracts:**
  ```typescript
  // lib/catalog/adminGalleryState.ts
  export type AdminGalleryItem = {
    id: string; // client key
    url: string;
  };

  export function moveGalleryItemUp(items: AdminGalleryItem[], index: number): AdminGalleryItem[];
  export function moveGalleryItemDown(items: AdminGalleryItem[], index: number): AdminGalleryItem[];
  export function canAddGalleryItem(items: AdminGalleryItem[]): boolean;
  export function canRemoveGalleryItem(items: AdminGalleryItem[]): boolean;
  export function serializeGalleryPayload(items: AdminGalleryItem[]): { images: string[]; image: string };
  ```
- [ ] **Step 1: Extract helper and write failing behavioral tests (`tests/admin-gallery-edit-ui.test.ts`)**
  Write test cases for pure gallery state functions:
  - `moveGalleryItemUp`: swaps item at index $i$ with $i-1$; no-op if $i = 0$.
  - `moveGalleryItemDown`: swaps item at index $i$ with $i+1$; no-op if $i = \text{length} - 1$.
  - `canAddGalleryItem`: true for count 1..3; false for count >= 4.
  - `canRemoveGalleryItem`: true for count >= 2; false for count <= 1.
  - `serializeGalleryPayload`: returns `{ images: [...urls], image: urls[0] }`.
- [ ] **Step 2: Run test to verify meaningful RED**
  ```powershell
  npx tsx --test tests/admin-gallery-edit-ui.test.ts
  ```
  Expected failure: `AssertionError: expected items to be swapped` (pure behavioral assertion RED).
- [ ] **Step 3: Implement pure gallery state logic and update EditProductPage**
  - Implement full logic in `lib/catalog/adminGalleryState.ts`.
  - In `app/admin/products/[id]/edit/page.tsx`:
    - Initialize `gallery: AdminGalleryItem[]` from `data.product.images || [data.product.image]`.
    - Use `moveGalleryItemUp` and `moveGalleryItemDown` for button clicks. Disable Up button when `index === 0`, disable Down button when `index === gallery.length - 1`.
    - First item rendered with distinct "Primary" badge.
    - Disable Remove button when `!canRemoveGalleryItem(gallery)`.
    - Disable Add button when `!canAddGalleryItem(gallery)`.
    - In `handleSubmit`: serialize payload with `serializeGalleryPayload(gallery)` and include in PUT request body.
- [ ] **Step 4: Run targeted test to verify GREEN**
  ```powershell
  npx tsx --test tests/admin-gallery-edit-ui.test.ts
  ```
- [ ] **Step 5: Run typecheck**
  ```powershell
  npx tsc --noEmit
  ```
- [ ] **Step 6: Self-review diff**
  Verify accessible button labels (`aria-label="Move image up"`, `aria-label="Move image down"`), no drag-and-drop library added.
- [ ] **Step 7: Commit**
  ```powershell
  git add lib/catalog/adminGalleryState.ts app/admin/products/[id]/edit/page.tsx tests/admin-gallery-edit-ui.test.ts
  git commit -m "feat: add accessible product gallery management to admin edit UI"
  ```

---

### TASK 6 — PRODUCTCARD DATA CONTRACT CUTOVER & RETAIL HIERARCHY

- **Goal:** Update `ProductCardProps` and callers (`ProgressiveProductGrid`, `ShopProductGridClient`, `ProductSection`) to forward `images: string[]`, `categoryName: string | null`, and `subcategoryName: string | null` preserving each caller's existing local mapping architecture without introducing an artificial global mapping abstraction. Extract pure presentation helpers to `components/ui/productCardPresentation.ts` (`resolveEyebrow`, `resolveCardBadge`, `resolveCardCTA`, `formatCardPrice`). Redesign `ProductCard` typography: remove customer-facing numeric `Stock: N` text, replace rounded category pill with unboxed uppercase muted eyebrow (`subcategoryName ?? categoryName ?? null`), enforce single Out of Stock badge, and lock disabled CTA button label to `Add to Cart` (never `Out of Stock`). Preserve exact cart/wishlist payload isolation and enforce literal BDT symbol `৳` formatting.
- **Files:**
  - Create: `components/ui/productCardPresentation.ts`
  - Modify: `components/ui/ProductCard.tsx`
  - Modify: `components/shop/ProgressiveProductGrid.tsx`
  - Modify: `components/shop/ShopProductGridClient.tsx`
  - Modify: `components/home/ProductSection.tsx`
  - Create: `tests/product-card-retail-hierarchy.test.ts`
- **True TDD RED Strategy:**
  - Perform a behavior-preserving extraction of existing presentation helpers to `components/ui/productCardPresentation.ts` reflecting CURRENT behavior (e.g. CTA returns "Out of Stock" when out of stock; eyebrow uses category snapshot).
  - Verify existing tests pass GREEN.
  - Now write the new retail hierarchy tests in `tests/product-card-retail-hierarchy.test.ts` asserting:
    - `resolveCardCTA({ isOutOfStock: true })` returns `{ label: "Add to Cart", disabled: true }`.
    - `resolveEyebrow(categoryName, subcategoryName)` prioritizes `subcategoryName`.
    - `formatCardPrice(1250)` returns `"৳1250"`.
    - Cart/wishlist isolation: cart payload retains `{ id, name, price, image, stock }`.
  - **RED:** Fails on behavioral assertions because helpers currently implement legacy rules.
- **Interfaces / Styling Rules:**
  ```typescript
  // components/ui/productCardPresentation.ts
  export function resolveEyebrow(categoryName?: string | null, subcategoryName?: string | null): string | null;

  export type CardBadgeResult = { label: string; className: string } | null;
  export function resolveCardBadge(params: {
    stock?: number;
    isOutOfStock: boolean;
    isLowStock: boolean;
    isHotDeal?: boolean;
    isUpcoming?: boolean;
    badgeText?: string | null;
    badgeTone?: string | null;
  }): CardBadgeResult;

  export function resolveCardCTA(params: {
    isOutOfStock: boolean;
    reachedStockLimit: boolean;
    justAddedToCart: boolean;
  }): { label: string; disabled: boolean };

  export function formatCardPrice(price: number): string;

  // components/ui/ProductCard.tsx
  export type ProductCardProps = {
    id: number;
    name: string;
    price: number;
    compareAtPrice?: number | null;
    image: string;
    images?: string[];
    category: string;
    categoryName?: string | null;
    subcategoryName?: string | null;
    stock?: number;
    isHotDeal?: boolean;
    isUpcoming?: boolean;
    badgeText?: string | null;
    badgeTone?: string | null;
  };
  ```
- [ ] **Step 1: Extract helpers and write failing behavioral tests (`tests/product-card-retail-hierarchy.test.ts`)**
  Test cases for pure presentation helpers and contract:
  - CTA label: when `isOutOfStock: true`, label is `"Add to Cart"` (disabled: true).
  - CTA label: when `reachedStockLimit: true` and `!isOutOfStock`, label is `"Limit Reached"`.
  - CTA label: when `justAddedToCart: true`, label is `"Added"`.
  - CTA label default: label is `"Add to Cart"`.
  - Badge priority: Out of Stock (1) > Promotional (2) > Low Stock (3) > None (4).
  - Out of Stock wins over promotional badge when `stock <= 0`.
  - Promotional badge wins over low stock when `stock > 0`.
  - Low stock renders only when `0 < stock <= 5` and no promotional badge.
  - Eyebrow: returns `subcategoryName` when non-empty.
  - Eyebrow: falls back to `categoryName` when `subcategoryName` is null.
  - Eyebrow: returns `null` when both are null/empty.
  - Price format: `formatCardPrice(1250)` returns `"৳1250"`. Literal `৳` (`\u09F3`) strictly used; dollar (`$`) is never emitted.
  - Commerce isolation: Cart item payload retains exact fields (`id`, `name`, `price`, `image`, `stock`).
  - Wishlist isolation: Wishlist item payload retains exact fields.
- [ ] **Step 2: Run test to verify meaningful RED**
  ```powershell
  npx tsx --test tests/product-card-retail-hierarchy.test.ts
  ```
  Expected failure: `AssertionError: expected "Add to Cart", got "Out of Stock"`.
- [ ] **Step 3: Implement pure presentation logic, update ProductCard, and wire callers**
  - Implement full logic in `components/ui/productCardPresentation.ts`:
    - `formatCardPrice(price)` returns ``৳${price}``.
    - `resolveCardCTA` returns `label: "Add to Cart"` when `isOutOfStock`.
    - `resolveEyebrow` checks `subcategoryName` first, then `categoryName`.
  - In `components/ui/ProductCard.tsx`:
    - Add optional `images`, `categoryName`, `subcategoryName` to `ProductCardProps`.
    - Delete lines rendering `Stock: {stock}`.
    - Delete the `hasKnownStock` display block.
    - Replace the category pill span with unboxed typography:
      ```tsx
      {eyebrow ? (
        <p className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.14em] text-[#8b5a45] truncate">
          {eyebrow}
        </p>
      ) : null}
      ```
    - Use `resolveCardBadge` for overlay badge rendering.
    - Use `resolveCardCTA` for CTA button rendering.
    - Use `formatCardPrice` for displaying prices.
  - Forward available fields in callers:
    - In `components/shop/ProgressiveProductGrid.tsx`: forward `images={product.images}`, `categoryName={product.categoryName}`, `subcategoryName={product.subcategoryName}`.
    - In `components/shop/ShopProductGridClient.tsx`: forward available fields.
    - In `components/home/ProductSection.tsx`: forward available fields.
- [ ] **Step 4: Run targeted test to verify GREEN**
  ```powershell
  npx tsx --test tests/product-card-retail-hierarchy.test.ts
  ```
- [ ] **Step 5: Run typecheck and catalog regression suite**
  ```powershell
  npx tsc --noEmit
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/public-catalog-query.test.ts
  ```
- [ ] **Step 6: Self-review diff**
  Verify zero occurrences of customer-facing "Stock:" text, verify single OOS badge, verify cart/wishlist handlers untouched.
- [ ] **Step 7: Commit**
  ```powershell
  git add components/ui/productCardPresentation.ts components/ui/ProductCard.tsx components/shop/ProgressiveProductGrid.tsx components/shop/ShopProductGridClient.tsx components/home/ProductSection.tsx tests/product-card-retail-hierarchy.test.ts
  git commit -m "feat: refine product card retail hierarchy, unboxed eyebrow, and single OOS badge"
  ```

---

### TASK 7 — PRODUCTCARD MULTI-IMAGE CAROUSEL

- **Goal:** Implement complete carousel state machine in `components/ui/carouselNavigation.ts` using a two-stage state model (`displayedIndex`, `pendingIndex`) where the primary image begins visible/loading (not assumed loaded), and requesting slide N keeps the current slide mounted until the requested slide loads. Implement `components/ui/ProductCardCarousel.tsx` with structural loading (mount ONLY the current slide's image element in DOM on initial paint), slide indicators, Next/Prev navigation buttons, swipe gesture support, and distinct primary vs secondary failure handling.
- **Files:**
  - Create: `components/ui/carouselNavigation.ts`
  - Create: `components/ui/ProductCardCarousel.tsx`
  - Modify: `components/ui/ProductCard.tsx`
  - Create: `tests/product-card-carousel.test.ts`
- **True TDD RED Strategy:**
  - Perform a behavior-preserving extraction of single-image state into `components/ui/carouselNavigation.ts`.
  - Verify existing tests pass GREEN.
  - Now write the new behavioral tests in `tests/product-card-carousel.test.ts` asserting:
    - Initial state: `displayedIndex = 0, pendingIndex = null, loadedIndices = empty Set, failedIndices = empty Set`.
    - Requesting slide 1 sets `pendingIndex = 1` while `displayedIndex = 0`.
    - Preload completion sets `displayedIndex = 1` and adds 1 to `loadedIndices`.
    - Secondary failure returns `action = "secondary-skipped"` and preserves current slide.
    - Primary failure returns `action = "primary-fallback"` and leaves secondaries navigable.
    - All images failed returns `action = "all-real-images-failed"`.
  - **RED:** Fails because multi-slide state machine is not yet implemented.
- **Interfaces / Component Contract:**
  ```typescript
  // components/ui/carouselNavigation.ts
  export type CarouselState = {
    displayedIndex: number;
    pendingIndex: number | null;
    loadedIndices: Set<number>;
    failedIndices: Set<number>;
    totalImages: number;
  };

  export type CarouselFailureAction =
    | "secondary-skipped"
    | "primary-fallback"
    | "all-real-images-failed";

  export function createInitialCarouselState(totalImages: number): CarouselState;
  export function markSlideLoaded(state: CarouselState, index: number): CarouselState;
  export function requestSlide(state: CarouselState, targetIndex: number): CarouselState;
  export function completeSlidePreload(state: CarouselState, loadedIndex: number): CarouselState;
  export function failSlide(state: CarouselState, failedIndex: number): {
    state: CarouselState;
    action: CarouselFailureAction;
  };
  export function getAvailableSlideIndices(state: CarouselState): number[];
  ```
- [ ] **Step 1: Extract helper and write failing behavioral tests (`tests/product-card-carousel.test.ts`)**
  Test cases for pure carousel state machine:
  - Initial state: `displayedIndex = 0`, `pendingIndex = null`, `loadedIndices` is empty, `failedIndices` is empty.
  - Primary image load: `markSlideLoaded(state, 0)` adds 0 to `loadedIndices`.
  - Requesting slide 1 (not loaded): sets `pendingIndex = 1`, `displayedIndex` remains 0 (current image kept visible).
  - Requesting slide 0 (already loaded): sets `displayedIndex = 0`, `pendingIndex = null` immediately.
  - Completing preload for index 1: sets `displayedIndex = 1`, `pendingIndex = null`, adds 1 to `loadedIndices`.
  - Secondary slide failure (index 1 fails): adds 1 to `failedIndices`, clears `pendingIndex`, keeps `displayedIndex = 0`, action is `"secondary-skipped"`. `getAvailableSlideIndices` omits 1.
  - Primary slide failure (index 0 fails): adds 0 to `failedIndices`, action is `"primary-fallback"` (SafeImage category fallback), secondaries 1..N remain available in gallery state.
  - All images failed (all real indices in `failedIndices`): action is `"all-real-images-failed"`.
- [ ] **Step 2: Run test to verify meaningful RED**
  ```powershell
  npx tsx --test tests/product-card-carousel.test.ts
  ```
  Expected failure: `AssertionError: expected pendingIndex to be 1`.
- [ ] **Step 3: Implement carousel state machine and ProductCardCarousel component**
  - Implement full logic in `components/ui/carouselNavigation.ts`.
  - Create `components/ui/ProductCardCarousel.tsx`:
    - Manages state via `carouselNavigation.ts` helpers.
    - Primary image `<SafeImage onLoad={() => setCarouselState(s => markSlideLoaded(s, 0))}>`.
    - Resets on `productId` change: resets state to `createInitialCarouselState(effectiveImages.length)`.
    - Active displayed image: `activeImage = effectiveImages[state.displayedIndex] || effectiveImages[0]`.
    - Structural loading: mounts ONLY the active slide's `<SafeImage>` element in the DOM. Does NOT mount secondary slides hidden.
    - When `pendingIndex !== null`, starts invisible preloader (`new Image().src = ...`) for pending candidate; on load calls `completeSlidePreload`; on error calls `failSlide`.
    - If available slides > 1:
      - Render Prev/Next `<button>` with `e.stopPropagation()` and `e.preventDefault()`.
      - Render indicator dots with `aria-current={state.displayedIndex === index ? "true" : undefined}`.
      - Touch swipe handlers: track touch start/end X delta.
  - In `components/ui/ProductCard.tsx`: render `<ProductCardCarousel ... />` in place of static image.
- [ ] **Step 4: Run targeted test to verify GREEN**
  ```powershell
  npx tsx --test tests/product-card-carousel.test.ts
  ```
- [ ] **Step 5: Run regression tests**
  ```powershell
  npx tsx --test tests/product-card-retail-hierarchy.test.ts
  ```
- [ ] **Step 6: Self-review diff**
  Verify secondary image elements are never mounted during initial paint; verify accessibility labels.
- [ ] **Step 7: Commit**
  ```powershell
  git add components/ui/carouselNavigation.ts components/ui/ProductCardCarousel.tsx components/ui/ProductCard.tsx tests/product-card-carousel.test.ts
  git commit -m "feat: add product card image carousel with structural loading guarantee"
  ```

---

### TASK 8 — RESPONSIVE NAVIGATION HIERARCHY

- **Goal:** Extract `components/layout/navbarNavigation.ts` using concrete `PublicCategory` types with deterministic sorting by `sortOrder ASC, id ASC` and primary budget split (`DESKTOP_NAV_PRIMARY_BUDGET = 4`). Refactor `Navbar.tsx` to activate desktop horizontal nav at `lg` (>= 1024px) using Next.js `Link` for direct Category navigation, and a single grouped `More ▼` panel. Below `lg`, implement two distinct controls per category (Category `Link` + separate accordion disclosure button). Zero-subcategory categories render as direct links only.
- **Files:**
  - Create: `components/layout/navbarNavigation.ts`
  - Modify: `components/layout/Navbar.tsx`
  - Create: `tests/responsive-navigation-hierarchy.test.ts`
- **True TDD RED Strategy:**
  - Extract existing category filtering into `components/layout/navbarNavigation.ts` preserving current behavior.
  - Verify existing tests pass GREEN.
  - Write new behavioral tests in `tests/responsive-navigation-hierarchy.test.ts` asserting:
    - Deterministic sorting by `sortOrder ASC, id ASC`.
    - Splitting first 4 into `primaryCategories` and remaining into `overflowCategories`.
  - **RED:** Fails because existing category extraction does not sort by `sortOrder` or split with budget 4.
- **Interfaces / Constants:**
  ```typescript
  // components/layout/navbarNavigation.ts
  import type { PublicCategory } from "@/lib/defaultCategories";

  export const DESKTOP_NAV_PRIMARY_BUDGET = 4;

  export function sortAndSplitNavCategories(
    categories: PublicCategory[],
    budget: number = DESKTOP_NAV_PRIMARY_BUDGET
  ): {
    primaryCategories: PublicCategory[];
    overflowCategories: PublicCategory[];
  };
  ```
- [ ] **Step 1: Extract helper and write failing behavioral tests (`tests/responsive-navigation-hierarchy.test.ts`)**
  Test cases for pure navigation helper:
  - Sorts active categories deterministically by `sortOrder ASC, id ASC` regardless of input order.
  - Inactive categories (`isActive: false`) are excluded.
  - When given 6 active categories: first 4 assigned to `primaryCategories`, remaining 2 to `overflowCategories`.
  - When given <= 4 active categories: `overflowCategories` is empty.
  - Returns concrete typed `PublicCategory[]` items preserving `id`, `name`, `slug`, `sortOrder`, `subcategories`.
- [ ] **Step 2: Run test to verify meaningful RED**
  ```powershell
  npx tsx --test tests/responsive-navigation-hierarchy.test.ts
  ```
  Expected failure: `AssertionError: categories must be sorted by sortOrder`.
- [ ] **Step 3: Implement pure navigation logic and update Navbar**
  - Implement `sortAndSplitNavCategories` in `components/layout/navbarNavigation.ts`.
  - In `components/layout/Navbar.tsx`:
    - Import `Link` from `next/link`.
    - Change desktop nav container from `hidden md:flex` to `hidden lg:flex`.
    - Use `sortAndSplitNavCategories(categories, 4)`.
    - In desktop nav:
      - Render `primaryCategories` using `<Link href={`/shop?category=${category.slug}`}>` with `max-w-[140px] truncate`.
      - If `overflowCategories.length > 0`: render single grouped `More ▼` dropdown panel listing each overflow category with direct Link and active subcategories underneath/alongside.
    - In mobile drawer:
      - For categories with subcategories: render `<Link href={`/shop?category=${category.slug}`}>` for direct navigation AND a separate `<button type="button" aria-expanded={active} aria-controls={`subcat-${category.slug}`}>` chevron button for accordion toggle.
      - For categories with zero subcategories: render `<Link>` only, with NO disclosure button or chevron.
- [ ] **Step 4: Run targeted test to verify GREEN**
  ```powershell
  npx tsx --test tests/responsive-navigation-hierarchy.test.ts
  ```
- [ ] **Step 5: Run typecheck**
  ```powershell
  npx tsc --noEmit
  ```
- [ ] **Step 6: Self-review diff**
  Verify zero runtime DOM-measurement scripts, verified `lg` breakpoint, verified Next.js `Link` usage, confirmed two-control mobile accordion.
- [ ] **Step 7: Commit**
  ```powershell
  git add components/layout/navbarNavigation.ts components/layout/Navbar.tsx tests/responsive-navigation-hierarchy.test.ts
  git commit -m "feat: refine responsive category navigation with lg breakpoint and two-control mobile accordion"
  ```

---

### TASK 9 — PRODUCT DETAIL SHARED GALLERY AUTHORITY

- **Goal:** Wire product detail data fetching (`lib/getProducts.ts` and `app/product/[id]/page.tsx`) and display (`ProductDetailsClient.tsx`) to consume the shared `ProductImage` authority without redesigning the page layout. Explicitly preserve existing selected-variant image behavior as a presentation override.
- **Files:**
  - Modify: `lib/getProducts.ts`
  - Modify: `lib/catalogRead.ts`
  - Modify: `components/product/ProductDetailsClient.tsx`
  - Create: `tests/product-detail-shared-gallery.test.ts`
- **Database Safety Guard:**
  - Dynamic Prisma import after checking `DATABASE_URL_TEST` and `validateTestDatabaseSafety()`.
- **True TDD RED Strategy:**
  - Seed product with 3 `ProductImage` rows in test DB.
  - Call `getProductById(id)`.
  - **RED:** `assert.deepEqual(product.images, [url1, url2, url3])` fails because `product.images` is undefined.
- **Interfaces / Compatibility Rules:**
  ```typescript
  // In lib/getProducts.ts:
  export type Product = {
    // ... existing fields ...
    images?: string[];
  };
  ```
  - `ProductImage` gallery is the base product gallery authority.
  - Selected-variant image behavior remains a presentation override: if `selectedVariant?.image?.trim()` is present, that image displays; when no variant image is specified, the base gallery image is shown.
  - Selecting a variant never mutates `ProductImage` authority.
- [ ] **Step 1: Write failing behavioral test (`tests/product-detail-shared-gallery.test.ts`)**
  Test cases:
  - Product with 3 `ProductImage` rows returns `images: [url1, url2, url3]` ordered by `sortOrder ASC, id ASC`.
  - Product with 0 `ProductImage` rows returns `images: [product.image]`.
  - Presentation override test: when variant with image is selected, active image displays variant image; when variant without image is selected, active image falls back to base gallery image.
- [ ] **Step 2: Run test to verify meaningful RED**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/product-detail-shared-gallery.test.ts
  ```
  Expected failure: `assert.deepEqual(product.images, ...)` fails on property absence.
- [ ] **Step 3: Implement shared gallery in getProducts and ProductDetailsClient**
  - In `lib/catalogRead.ts` / `lib/getProducts.ts`:
    - Include `images: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }` in `getCachedProductRow`.
    - In `mapProduct`: map `images: Array.isArray(product.images) && product.images.length > 0 ? product.images.map(img => img.url) : [product.image]`.
  - In `components/product/ProductDetailsClient.tsx`:
    - Update `Product` type with `images?: string[]`.
    - If `product.images && product.images.length > 1`, render gallery thumbnail strip alongside or integrated with variant selector so customers can browse all gallery images when no variant image is active.
- [ ] **Step 4: Run targeted test to verify GREEN**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/product-detail-shared-gallery.test.ts
  ```
- [ ] **Step 5: Run regression tests**
  ```powershell
  npx tsc --noEmit
  ```
- [ ] **Step 6: Self-review diff**
  Verify detail page layout is preserved and variant image override logic remains intact.
- [ ] **Step 7: Commit**
  ```powershell
  git add lib/getProducts.ts lib/catalogRead.ts components/product/ProductDetailsClient.tsx tests/product-detail-shared-gallery.test.ts
  git commit -m "feat: share product gallery authority on product detail page"
  ```

---

### TASK 10 — MIGRATION REHEARSAL / POSTGRES INTEGRITY

- **Goal:** Execute a comprehensive database migration rehearsal on a fresh disposable PostgreSQL test database initialized at the pre-ProductImage baseline. Verify universal backfill parity for active, inactive, and soft-deleted products, check unique constraint enforcement, and verify zero data corruption.
- **Classification:** Verification / acceptance task after Tasks 1–9 implementation exists. Expected result is GREEN. Do NOT force an artificial RED.
- **Files:**
  - Create: `tests/migration-rehearsal-postgres.test.ts`
- **Database Safety & Unconditional Cleanup Protocol:**
  - Test runner is invoked requiring `DATABASE_URL_TEST` only:
    ```powershell
    if (-not $env:DATABASE_URL_TEST) {
        throw "DATABASE_URL_TEST is required"
    }
    npx tsx --test tests/migration-rehearsal-postgres.test.ts
    ```
  - Inside the test:
    1. Read `process.env.DATABASE_URL_TEST`.
    2. Create a unique disposable DB in the running test container (`pure_haven_storefront_gallery_<timestamp>`).
    3. In-memory derivation of `disposableTestUrl` by replacing the database name.
    4. Validate safety of the ACTUAL disposable target before connection or migration.
    5. Pass `disposableTestUrl` explicitly to raw `pg` client and via `DATABASE_URL: disposableTestUrl` child-process env for both baseline and current migrations.
    6. All resource allocation, baseline deployment, seeding, migration deployment, and verification run inside a `try/finally` block.
    7. In `finally`:
       - Remove temporary baseline export folder (`tempBaseline`).
       - Remove temporary archive file (`tempArchive`).
       - Force drop the disposable DB: `docker exec pure-haven-phase5-test-postgres psql -c "DROP DATABASE "$dbName" WITH (FORCE)"`.
       - Report cleanup failures explicitly without silently masking original assertion or migration errors.
- **Disposable DB Rehearsal Sequence:**
  1. Safety-check `DATABASE_URL_TEST` before import; fail closed if missing or unsafe.
  2. Create disposable DB:
     ```powershell
     $dbName = "pure_haven_storefront_gallery_" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
     docker exec -e "DB_NAME=$dbName" pure-haven-phase5-test-postgres sh -lc 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE "$DB_NAME""'
     ```
  3. Derive `disposableTestUrl` in memory by replacing database name with `$dbName`. Validate safety before execution.
  4. Export Phase-5 baseline Prisma directory via binary-safe intermediate tar archive:
     ```powershell
     $tempBaseline = Join-Path $env:TEMP "pure-haven-phase5-prisma-baseline"
     $tempArchive  = Join-Path $env:TEMP "pure-haven-phase5-prisma-baseline.tar"
     if (Test-Path $tempBaseline) { Remove-Item -Recurse -Force $tempBaseline }
     if (Test-Path $tempArchive)  { Remove-Item -Force $tempArchive }
     New-Item -ItemType Directory -Force $tempBaseline | Out-Null
     git archive --format=tar -o "$tempArchive" da6f210729f75ae39469efa665cb22229f9a5b8e prisma
     if ($LASTEXITCODE -ne 0) { throw "Failed to export Phase-5 Prisma baseline archive" }
     tar -xf "$tempArchive" -C "$tempBaseline"
     if ($LASTEXITCODE -ne 0) { throw "Failed to extract Phase-5 Prisma baseline archive" }
     ```
  5. Deploy baseline migration tree to disposable DB passing URL explicitly through child-process env with `npx.cmd` / `npx`:
     ```typescript
     const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
     execFileSync(
       npxCmd,
       ["prisma", "migrate", "deploy", "--schema", path.join(tempBaseline, "prisma", "schema.prisma")],
       {
         env: { ...process.env, DATABASE_URL: disposableTestUrl },
         stdio: "pipe",
       }
     );
     ```
  6. Seed legacy products using raw `pg` client connecting to `disposableTestUrl`: active, inactive, soft-deleted, empty-image.
  7. Query PostgreSQL system catalogs to verify `ProductImage` table does NOT exist yet.
  8. Apply new migration via current repo schema passing disposable URL explicitly:
     ```typescript
     execFileSync(
       npxCmd,
       ["prisma", "migrate", "deploy", "--schema", path.join(process.cwd(), "prisma", "schema.prisma")],
       {
         env: { ...process.env, DATABASE_URL: disposableTestUrl },
         stdio: "pipe",
       }
     );
     ```
  9. Verify:
     - `ProductImage` table exists.
     - Foreign key cascade on `Product(id)` exists.
     - `unique(productId, sortOrder)` constraint exists.
     - No redundant secondary index on `(productId, sortOrder)`.
     - Universal backfill parity: all seeded products with non-empty `image` have exactly one row with `sortOrder = 1` and `url = TRIM(image)`.
     - Empty `image` produces 0 `ProductImage` rows.
     - `Product.image` mirror remains unchanged.
  10. Verify unique `(productId, sortOrder)` constraint rejects duplicate insertion with SQL error code `23505`.
  11. Rerun the backfill SQL statement separately to prove idempotency (0 duplicate rows created).
  12. Clean/destroy disposable database and remove `$tempBaseline` and `$tempArchive` in `finally` block:
     ```powershell
     Remove-Item -Recurse -Force $tempBaseline
     Remove-Item -Force $tempArchive
     docker exec -e "DB_NAME=$dbName" pure-haven-phase5-test-postgres sh -lc 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE "$DB_NAME" WITH (FORCE)"'
     ```
- [ ] **Step 1: Write integration rehearsal test (`tests/migration-rehearsal-postgres.test.ts`)**
  Implement the exact rehearsal sequence using raw `pg` client and `child_process.execFileSync` for `npx.cmd` / `npx prisma migrate deploy`.
- [ ] **Step 2: Run rehearsal test to verify GREEN**
  ```powershell
  if (-not $env:DATABASE_URL_TEST) {
      throw "DATABASE_URL_TEST is required"
  }
  npx tsx --test tests/migration-rehearsal-postgres.test.ts
  ```
  Verify: 8/8 assertions pass.
- [ ] **Step 3: Run all database integration suites**
  ```powershell
  $env:DATABASE_URL = $env:DATABASE_URL_TEST
  npx tsx --test tests/product-image-schema.test.ts
  npx tsx --test tests/product-gallery-write.test.ts
  npx tsx --test tests/public-catalog-gallery-query.test.ts
  ```
- [ ] **Step 4: Self-review diff**
  Confirm test cleans up all seeded rows and drops disposable DB in `finally`.
- [ ] **Step 5: Commit**
  ```powershell
  git add tests/migration-rehearsal-postgres.test.ts
  git commit -m "test: verify product gallery migration integrity and universal backfill on PostgreSQL"
  ```

---

### TASK 11 — FULL REGRESSION + REAL BROWSER QA

- **Goal:** Run complete project automated test suite, typecheck, Prisma validation, diff-scoped ESLint, and Next.js build. Then perform headless browser automated QA asserting responsive viewports (375×667, 768×1024, 1280×800) via Chrome DevTools Protocol device emulation across all required public and admin surfaces. Verify structural deferred network loading, zero horizontal overflow, and UI acceptance criteria. Create and audit a secret-free evidence bundle.
- **Classification:** Verification / acceptance task after Tasks 1–10 are complete. Expected result is GREEN. Do NOT force an artificial RED.
- **Files:**
  - Create: `tests/storefront-responsive-browser-qa.test.ts`
- [ ] **Step 1: Automated Pre-Flight Suite & Quality Gates**
  Derive changed tracked files relative to baseline `da6f210729f75ae39469efa665cb22229f9a5b8e`, filter lintable source/test files, and run ESLint:
  ```powershell
  npm test
  npx tsc --noEmit
  npx prisma validate

  # Diff-scoped ESLint derived from actual changed files
  $changedFiles = (git diff --name-only da6f210729f75ae39469efa665cb22229f9a5b8e HEAD) -split '\r?\n' | Where-Object { $_ -match '\.(ts|tsx|js|jsx)$' -and (Test-Path $_) }
  npx eslint $changedFiles

  npm run build
  ```
  Require:
  - All automated tests pass.
  - Zero TypeScript compiler errors.
  - Valid Prisma schema.
  - Diff-scoped ESLint: `FEATURE_ESLINT_ERRORS=0`, `FEATURE_ESLINT_WARNINGS=0`.
  - Next.js build exits 0.
- [ ] **Step 2: Implement Real Browser QA Test Script (`tests/storefront-responsive-browser-qa.test.ts`)**
  Using Chrome DevTools Protocol (CDP) device emulation:
  - **Required Public Surfaces:**
    - `/shop` product grid
    - Category-filtered shop state (`/shop?category={slug}`)
    - Subcategory-filtered shop state (`/shop?category={slug}&subcategory={subslug}`)
    - Product detail gallery (`/product/{id}`)
    - Desktop navbar (`hidden lg:flex`)
    - Grouped `More ▼` panel
    - Mobile/tablet drawer (< 1024px)
  - **Required Admin Surface:**
    - `/admin/products/{id}/edit` gallery editor
  - **Product Card Retail Hierarchy Verification:**
    - Literal `৳` visible on all prices; customer price text contains no `$`.
    - Zero occurrences of `Stock: N` on customer product cards.
    - Single `Out of Stock` badge on image overlay when `stock <= 0`.
    - Disabled CTA button reads `Add to Cart` for OOS products.
    - Deterministic badge priority: Out of Stock > Promotional > Low Stock > None.
    - Single-image card has no carousel controls.
    - Multi-image card has indicators + prev/next navigation buttons.
    - Image frame dimensions remain stable (`aspect-square overflow-hidden`).
    - Hover zoom does not alter card or grid geometry.
    - Failed secondary slide does not break card frame.
  - **Structural Network Loading Verification (Multi-Image Fixture):**
    - Intercept network requests during initial page load: assert primary image URL requested; secondary gallery URLs (`images[1..3]`) MUST NOT be requested.
    - Interact with carousel (click "Next image"): assert `images[1]` is requested; `images[2..3]` remain unfetched.
    - Current primary remains displayed until load completion (no white flicker or layout shift).
  - **Responsive Navigation Verification:**
    - **Desktop (1280 × 800):**
      - Runtime assertions: `window.innerWidth === 1280`, `window.innerHeight === 800`, `document.documentElement.clientWidth <= 1280`, `document.documentElement.scrollWidth <= window.innerWidth`.
      - Horizontal nav visible; first 4 sorted active categories rendered; `More ▼` overflow panel renders if active categories > 4.
      - Top-level category `Link` routes directly to `/shop?category={slug}`.
      - Grouped More panel lists overflow categories with direct links and active subcategory links.
      - Zero-subcategory category has no unnecessary indicator.
    - **Mobile (375 × 667) & Tablet (768 × 1024):**
      - Runtime assertions:
        - Mobile: `window.innerWidth === 375`, `window.innerHeight === 667`, `clientWidth <= 375`, `scrollWidth <= innerWidth`.
        - Tablet: `window.innerWidth === 768`, `window.innerHeight === 1024`, `clientWidth <= 768`, `scrollWidth <= innerWidth`.
      - Category Link routes directly; separate disclosure button toggles accordion without navigating.
      - `aria-expanded` toggles; `aria-controls` target exists.
      - Zero-subcategory category has Link only, no disclosure button.
      - Drawer closes on navigation. `SafeMobileBottomNav` preserved.
  - **Product Detail Verification:**
    - `ProductImage` base gallery visible; ordering correct.
    - Selecting gallery thumbnail updates preview.
    - Existing selected-variant image override works: when variant with image is selected, variant image displays; selecting variant does not mutate gallery authority.
  - **Admin Product Edit Gallery Verification:**
    - Effective gallery loads 1..4 images.
    - Add blocked at 4; Remove blocked at 1.
    - Move Up disabled on first item; Move Down disabled on last item.
    - First image marked "Primary".
    - Save and reload persists ordering; `Product.image` compatibility mirror equals saved position 1.
    - Metadata-only edit does not rewrite gallery.
- [ ] **Step 3: Run Browser QA Script and Capture Multi-Viewport Screenshots**
  ```powershell
  npx tsx tests/storefront-responsive-browser-qa.test.ts
  ```
  Verify: All assertions pass. Multi-viewport screenshots saved for 375×667, 768×1024, and 1280×800 across all surfaces.
- [ ] **Step 4: Package and Audit Secret-Safe Evidence Bundle**
  Package screenshots and audit log into:
  ```powershell
  $env:USERPROFILE\Downloads\pure-haven-storefront-ux-evidence.zip
  ```
  Audit protocol:
  - Extract/inspect final ZIP. Scan all `.txt`, `.json`, `.log`, `.md` files.
  - Search for forbidden patterns: raw password, password hash, recovery hash, cookie, session token, Authorization header, Bearer token, DATABASE_URL, ADMIN_SESSION_SECRET, API key, .env, credential-bearing PostgreSQL URL.
  - Require: `ACTUAL_SECRET_FINDINGS=0`.
- [ ] **Step 5: Git State Ordering and Clean Commit**
  - Verify only intended Task 11 test code diff is present:
    ```powershell
    git diff --check
    git status --short
    ```
  - Commit Task 11 tracked test code:
    ```powershell
    git add tests/storefront-responsive-browser-qa.test.ts
    git commit -m "test: complete storefront gallery and responsive navigation browser acceptance suite"
    ```
  - Verify working tree is clean: `git status --short` returns empty.

---

## Decision & Hardening Coverage Matrix

### Approved Design Decisions (D1–D38)

| Spec Decision | Summary | Implementation Task(s) | Verification Test(s) |
|---|---|---|---|
| **D1** | `Product.name` display title authority | Task 6 | `tests/product-card-retail-hierarchy.test.ts` |
| **D2** | No `Product.displayName` | Task 1, Task 2, Task 4 | Schema review, `tests/product-image-schema.test.ts` |
| **D3** | `categoryRel.name` display authority | Task 4, Task 6 | `tests/public-catalog-gallery-query.test.ts` |
| **D4** | `Subcategory.name` token-bounded resolution | Task 4, Task 6 | `tests/public-catalog-gallery-query.test.ts` |
| **D5** | No `Product.subcategoryId` | Task 1, Task 4 | Schema review, `tests/public-catalog-gallery-query.test.ts` |
| **D6** | `ProductImage` gallery authority | Task 1, Task 2, Task 3 | `tests/product-image-schema.test.ts`, `tests/product-gallery-write.test.ts` |
| **D7** | `Product.image` compatibility mirror | Task 1, Task 2 | `tests/product-gallery-write.test.ts` |
| **D8** | Transactional mirror synchronization | Task 2 | `tests/product-gallery-write.test.ts` |
| **D9** | Max 4, min 1 gallery images | Task 2, Task 5 | `tests/product-gallery-write.test.ts`, `tests/admin-gallery-edit-ui.test.ts` |
| **D10** | Primary image = sortOrder 1 | Task 1, Task 2 | `tests/product-gallery-write.test.ts` |
| **D11** | `@@unique([productId, sortOrder])`, no redundant index | Task 1, Task 10 | `tests/product-image-schema.test.ts`, `tests/migration-rehearsal-postgres.test.ts` |
| **D12** | Single write boundary: `PUT /api/products` | Task 2 | `tests/product-gallery-write.test.ts` |
| **D13** | Pre-tx validation + in-tx Product revalidation | Task 2 | `tests/product-gallery-write.test.ts` |
| **D14** | No `altText`; all images use `Product.name` | Task 1, Task 6, Task 7 | `tests/product-card-carousel.test.ts` |
| **D15** | Bounded batch `ProductImage` and `Subcategory` queries | Task 4 | `tests/public-catalog-gallery-query.test.ts` |
| **D16** | Explicit `categoryId` projection in product query | Task 4 | `tests/public-catalog-gallery-query.test.ts` |
| **D17** | Token-scoped subcategory `OR` bounded by pageSize (max 48) | Task 4 | `tests/public-catalog-gallery-query.test.ts` |
| **D18** | Structural loading: only current slide mounted initially | Task 7, Task 11 | `tests/product-card-carousel.test.ts`, `tests/storefront-responsive-browser-qa.test.ts` |
| **D19** | At most next likely slide prefetched | Task 7 | `tests/product-card-carousel.test.ts` |
| **D20** | Broken secondary marked unavailable & skipped | Task 7 | `tests/product-card-carousel.test.ts` |
| **D21** | Single-image cards show no controls | Task 7 | `tests/product-card-carousel.test.ts` |
| **D22** | Multi-image cards show indicator & arrow buttons | Task 7 | `tests/product-card-carousel.test.ts` |
| **D23** | Carousel accessibility: region + standard buttons (no tablist) | Task 7 | `tests/product-card-carousel.test.ts` |
| **D24** | Frame-scoped hover zoom; no layout shift | Task 6, Task 7, Task 11 | `tests/storefront-responsive-browser-qa.test.ts` |
| **D25** | No numeric stock (`Stock: N`) on customer card | Task 6, Task 11 | `tests/product-card-retail-hierarchy.test.ts`, `tests/storefront-responsive-browser-qa.test.ts` |
| **D26** | Deterministic badge priority: OOS > Promo > Low Stock > None | Task 6 | `tests/product-card-retail-hierarchy.test.ts` |
| **D27** | Single OOS badge; disabled CTA reads `Add to Cart` | Task 6 | `tests/product-card-retail-hierarchy.test.ts` |
| **D28** | Cart/wishlist/stock business logic unchanged | Task 6 | `tests/product-card-retail-hierarchy.test.ts` |
| **D29** | Desktop nav at `lg` (>= 1024px); below `lg` uses drawer | Task 8, Task 11 | `tests/responsive-navigation-hierarchy.test.ts`, `tests/storefront-responsive-browser-qa.test.ts` |
| **D30** | Desktop primary budget = 4 active categories | Task 8 | `tests/responsive-navigation-hierarchy.test.ts` |
| **D31** | Top-level category label routes to `/shop?category={slug}` via Next.js Link | Task 8, Task 11 | `tests/responsive-navigation-hierarchy.test.ts`, `tests/storefront-responsive-browser-qa.test.ts` |
| **D32** | More menu uses ONE grouped panel without nested trees | Task 8 | `tests/responsive-navigation-hierarchy.test.ts` |
| **D33** | Zero-subcategory categories render as direct links | Task 8 | `tests/responsive-navigation-hierarchy.test.ts` |
| **D34** | Universal backfill regardless of active/deleted state | Task 1, Task 10 | `tests/product-image-schema.test.ts`, `tests/migration-rehearsal-postgres.test.ts` |
| **D35** | Conflict rejection: `images` vs legacy `image` mismatch | Task 2 | `tests/product-gallery-write.test.ts` |
| **D36** | 3-way write branching (Case 1, 2, 3) | Task 2 | `tests/product-gallery-write.test.ts` |
| **D37** | Mobile drawer uses two distinct controls (Link + chevron) | Task 8, Task 11 | `tests/responsive-navigation-hierarchy.test.ts`, `tests/storefront-responsive-browser-qa.test.ts` |
| **D38** | Admin gallery reordering requires Up/Down buttons | Task 5 | `tests/admin-gallery-edit-ui.test.ts` |

### Implementation Hardening Rules (H1–H2)

| Rule | Summary | Implementation Task(s) | Verification Test(s) |
|---|---|---|---|
| **H1** | Persistence-safe image normalization (never substitute display fallback) | Task 2 | `tests/product-gallery-write.test.ts` |
| **H2** | Primary vs secondary gallery failure handling | Task 7 | `tests/product-card-carousel.test.ts` |

---

## Test Database Safety Protocol

Before running any test requiring PostgreSQL:

1. Confirm `process.env.DATABASE_URL_TEST` is set. Fail closed if absent.
2. In test file execution (or dynamic import wrapper), set `process.env.DATABASE_URL = process.env.DATABASE_URL_TEST` (or verified `disposableTestUrl`) BEFORE dynamically importing Prisma or database modules.
3. Dynamically import and validate `validateTestDatabaseSafety().safe === true` and distinct from production. If not, fail closed.
4. Clean up seeded rows and disposable databases under `try/finally` semantics in `after()` or `finally` blocks.
5. NEVER print raw credentials, passwords, or full credential-bearing URLs in test output or logs.
