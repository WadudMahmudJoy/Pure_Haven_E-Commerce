# Pure Haven BD — Storefront Product Card, Product Gallery, and Category Navigation UX Design

**Status:** Owner-Approved Design (Final Micro-Corrections Applied)
**Baseline:** `phase5-complete` / `da6f210729f75ae39469efa665cb22229f9a5b8e`
**Design Approach:** `STOREFRONT_UX_DESIGN_APPROACH_A` + `RELATIONAL_PRODUCT_IMAGE_GALLERY_A1` + `SINGLE_OUT_OF_STOCK_BADGE` + `NO_NUMERIC_STOCK_ON_STOREFRONT_CARD` + `DESKTOP_MORE_OVERFLOW_NAV`
**Created:** 2026-09-03
**Revised:** 2026-09-03 (Final Micro-Corrections)

---

## 1. Purpose

This document is the authoritative design specification for a focused post-Phase-5 storefront cleanup. It converts the public shopping experience from a technical catalog appearance into a polished retail storefront without touching any commerce, auth, pricing, or inventory contracts.

**Four logical areas:**

1. Presentation-safe public product-card category/subcategory metadata
2. Relational multi-image product gallery authority (`ProductImage`)
3. `ProductCard` UX hierarchy and stock-state presentation
4. Responsive `Category` / `Subcategory` navigation hierarchy

---

## 2. Non-Goals

The following are explicitly **outside** this feature scope:

- Full Phase-8 premium website redesign
- Checkout or order page redesign
- Product detail page layout redesign (only gallery integration for shared image authority)
- Recommendation or personalization engine
- `Product.displayName` field
- `Product.subcategoryId` migration
- Search-scope expansion (description search remains excluded)
- Pricing logic change
- Stock authority change
- Cart behavior redesign
- Wishlist behavior redesign
- Arbitrary CMS layout editing
- Hardcoded commercial category names in source code
- Production database content cleanup as architecture
- Dedicated second gallery write endpoint (existing authenticated `PUT /api/products` is the single write boundary)
- Speculative `ProductImage.altText` field (all gallery images use `Product.name` as safe alt text)
- Redundant secondary indexes on `ProductImage` (the `@@unique([productId, sortOrder])` index is sufficient)
- Drag-and-drop gallery reordering library (accessible Up/Down buttons provide the required reordering UX)

---

## 3. Discovery Confirmations

All findings from the pre-approved discovery run remain accurate at baseline `da6f210729f75ae39469efa665cb22229f9a5b8e`:

| Finding | Confirmed |
| :--- | :---: |
| `Product.name` is authoritative customer display title | YES |
| `Product.categoryId` / `Category` relation is authoritative category relationship | YES |
| `Product.category` is legacy/display compatibility snapshot (string) | YES |
| `Product.subcategory` is legacy compatibility text; may contain slug OR display name | YES |
| `Product.subcategoryId` does not exist | YES |
| `Category` to `Subcategory` relation already exists in schema | YES |
| No `Product.displayName` field is necessary | YES |
| Current public `ProductCard` renders `Product.category` snapshot string | YES |
| Current card has no presentation-safe relational subcategoryName | YES |
| Current card renders `Stock: {N}` visually (lines 210-214 of ProductCard.tsx) | YES |
| `stock` numeric value is still required for UI/cart safeguards | YES |
| `Navbar.tsx` already has desktop CSS hover dropdown infrastructure | YES |
| `Navbar.tsx` already has mobile accordion infrastructure | YES |
| `Product.image` is currently the single product image authority | YES |
| No `ProductImage` model exists in schema | YES |
| No speculative `altText` exists in schema or DTOs | YES |
| `SafeImage` + `normalizeImageSrc` are the existing image rendering conventions | YES |
| Admin write path (`PUT /api/products`) directly updates `Product.image` | YES |

---

## 4. Product Display Authority

### 4.1 Customer-Facing Title

`Product.name` is the authoritative customer-facing product title.

- Set and managed by admin through the product edit UI.
- Rendered directly as the product title on card, detail page, order items, and search results.
- No UI concatenation of IDs, timestamps, test markers, or slugs is permitted on any customer-facing surface.
- `Product.displayName` must NOT be introduced.

### 4.2 QA/Fixture Content vs. Architecture

Strings such as `QA Catalog Product 241 p5qa-...` visible during Task 9 QA were fixture/test data injected into `Product.name` by the test harness and cleaned up during Task 9B/9C. The display architecture is correct; no architectural response required.

### 4.3 Routing

Product routing continues to use `Product.id` (e.g., `/product/12345`). No slug-based product routing is introduced.

---

## 5. Presentation-Safe Category / Subcategory DTO

### 5.1 The Subcategory Display Problem

`Product.subcategory` (a `String?` snapshot) is NOT safe for customer-facing display because it may contain either `Subcategory.slug` (e.g., `"lip-gloss"`) or `Subcategory.name` (e.g., `"Lip Gloss"`). Slug values must never be shown to customers. Heuristic slug-to-name transformation (`replace("-", " ")`) is explicitly prohibited as display authority.

### 5.2 Presentation Fields

The public product card DTO gains two presentation-safe fields:

```typescript
categoryName: string | null;
subcategoryName: string | null;
```

**Customer eyebrow display rule:**

```
subcategoryName
  -> fallback: categoryName
  -> fallback: (no eyebrow rendered)
```

**Display value sources:**

| Field | Authority |
| :--- | :--- |
| `categoryName` | Selected directly as `categoryRel.name` in the bounded product query, falling back to `Product.category` snapshot string, or `null` |
| `subcategoryName` | `Subcategory.name` via token-scoped bounded batch resolution (Section 6) |

**Important:** Do NOT call `getCachedCategoryRows()` merely to obtain customer card `categoryName`. `categoryRel.name` is selected directly in the bounded product query.

Routing continues to use `Category.slug` and `Subcategory.slug`.

### 5.3 Backward Compatibility

`category` (existing snapshot string) remains in `PublicProductCardDTO` during migration. It continues to serve `SafeImage` / `normalizeImageSrc` fallback category hint and any consumer not yet migrated. Deprecation completes when all consumers are confirmed to use `categoryName`.

---

## 6. Token-Bounded Relational Subcategory Resolution & Catalog DB Pattern

Phase-5 catalog scalability invariants must be preserved. Subcategory name resolution must not introduce N+1 queries or unbounded category-wide subcategory fetching.

### 6.1 Required Catalog DB Pattern

The catalog query architecture strictly executes:

```
1. Bounded Product query (skip, take, orderBy) with categoryId and categoryRel.name selected
2. Product count query
3. ONE ProductImage batch query for current page product IDs
4. ONE token-scoped Subcategory batch query for unique (categoryId, subcategoryToken) pairs
```

- **No `ProductImage` query inside a product loop.**
- **No `Subcategory` query inside a product loop.**
- Do NOT load every active Subcategory under the represented categories. The Subcategory query must be strictly scoped to candidate tokens present on the current product page.

### 6.2 Bounded Product Query Projection

The bounded product query MUST explicitly project `categoryId` so that the downstream subcategory batch resolution and DTO assembly receive the relational category ID:

```typescript
prisma.product.findMany({
  where,
  skip: params.skip,
  take: params.pageSize,
  orderBy,
  select: {
    id: true,
    name: true,
    price: true,
    compareAtPrice: true,
    image: true,
    category: true,
    categoryId: true,      // EXPLICITLY SELECTED: required for subcategory resolution
    subcategory: true,     // EXPLICITLY SELECTED: compatibility token
    stock: true,
    isHotDeal: true,
    isUpcoming: true,
    badgeText: true,
    badgeTone: true,
    categoryRel: {
      select: { name: true }, // EXPLICITLY SELECTED: direct categoryName
    },
  },
});
```

### 6.3 Token-Scoped Subcategory Resolution Algorithm & Page-Size Bounds

Phase-5 locked pagination contracts:
- Normal storefront progressive grid chunk = 24 items (`DEFAULT_PAGE_SIZE = 24`).
- Public catalog server/API hard maximum page size = 48 (`MAX_PAGE_SIZE = 48`).
- Therefore:
  ```
  uniquePairs.length <= effective bounded product-query pageSize <= 48
  ```
- The token-scoped Subcategory `OR` branch count is bounded by the current Product query size, with an absolute public maximum of 48.

```
Step 1: Execute bounded Product page query (with categoryId and categoryRel.name selected).

Step 2: In parallel:
        A. Collect Product IDs and run ONE ProductImage batch query:
           prisma.productImage.findMany({
             where: { productId: { in: productIds } },
             orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
           })
           Group in memory by productId and cap each product to the first 4 URLs.

        B. Collect unique (categoryId, normalized Subcategory token) pairs:
           From current page products, filter rows where product.categoryId is non-null
           and product.subcategory is non-empty.
           Collect unique pairs: Set of "{categoryId}::{token.toLowerCase()}"
           Invariant: uniquePairs.length <= current page product count (capped at max 48).

        C. Run ONE token-scoped Subcategory lookup:
           Construct candidate OR conditions scoped strictly to the collected pairs:
           prisma.subcategory.findMany({
             where: {
               OR: uniquePairs.map(({ categoryId, token }) => ({
                 categoryId,
                 isActive: true,
                 OR: [
                   { slug: { equals: token, mode: "insensitive" } },
                   { name: { equals: token, mode: "insensitive" } },
                 ],
               })),
             },
             select: { categoryId: true, name: true, slug: true },
           })

        D. Build in-memory lookup map:
           Map<categoryId, Map<slugOrName_lowercased, Subcategory.name>>

Step 3: Assemble PublicProductCardDTO items:
        - categoryName = product.categoryRel?.name ?? product.category ?? null
        - subcategoryName = product.categoryId && product.subcategory
            ? (lookupMap.get(product.categoryId)?.get(product.subcategory.trim().toLowerCase()) ?? null)
            : null
        - images = groupedImages.get(product.id) ?? [product.image]
```

**Invariant:** Subcategory rows fetched are candidate matches for the CURRENT bounded product tokens, NOT every Subcategory under the represented categories.

### 6.4 Resolution Fallback Chain

```
subcategoryName:
  1. Subcategory.name matched by candidate token (slug match or name match)
  2. null (unresolved legacy row — no display, no error)

categoryName:
  1. categoryRel.name (relational join from bounded product query)
  2. Product.category snapshot string (legacy compatibility)
  3. null if both unavailable
```

Never expose internal IDs, raw slugs, or unmatched tokens as fallback display text.

---

## 7. Public Product Card DTO

### 7.1 Conceptual DTO Shape

```typescript
type PublicProductCardDTO = {
  // Identity
  id: number;
  name: string;              // Product.name — authoritative display title

  // Image authority (Sections 8-9)
  image: string;             // Product.image — compatibility primary mirror
  images: string[];          // Ordered ProductImage URLs (max 4); fallback: [image]

  // Category/subcategory — presentation
  category: string;          // Legacy snapshot — compatibility; deprecated pending migration
  categoryName: string | null;    // Relational Category.name — customer display
  subcategoryName: string | null; // Resolved Subcategory.name — customer display

  // Pricing
  price: number;
  compareAtPrice: number | null;

  // Commerce behavior (internal — not directly rendered to customer)
  stock: number;
  hasVariants: boolean;

  // Promotional
  badgeText: string | null;
  badgeTone: string;
};
```

**Note on alt text:** `images` is strictly `string[]` (ordered image URLs). Speculative `altText` is excluded from the DTO. Per Section 27, all product gallery images use `Product.name` as safe alt text.

### 7.2 stock Disposition

`stock` remains in the DTO for: `isOutOfStock = stock <= 0`, `reachedStockLimit = currentQty >= stock`, cart quantity enforcement, and checkout safeguards. `stock` must NOT be rendered numerically on any customer-facing card or list surface.

### 7.3 Forbidden Rendering

The following must never appear on a customer-facing product card:

- `Stock: 0` / `Stock: 2` / `Stock: N` (any numeric form)
- Slugs as category/subcategory text
- Product ID as visible text
- Test markers or QA strings

---

## 8. Relational ProductImage Gallery Authority

### 8.1 Media Architecture

```
ProductImage relational records = authoritative product gallery
Product.image = backward-compatibility primary-image mirror ONLY
```

There is exactly one editable source of truth: `ProductImage`. `Product.image` is a synchronized read mirror, not an independently editable field.

### 8.2 ProductImage Schema Integrity (Conceptual)

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

// Product model gains:
model Product {
  // ... existing fields ...
  images ProductImage[]
}
```

### 8.3 Index Discipline

- The model uses `@@unique([productId, sortOrder])`.
- **The redundant explicit `@@index([productId, sortOrder])` is removed.** The unique constraint in PostgreSQL automatically creates a b-tree index covering `(productId, sortOrder)`, which fully supports the required query pattern (`where productId in (...) order by productId asc, sortOrder asc`).
- No speculative secondary indexes are added without PostgreSQL `EXPLAIN` evidence.

### 8.4 Removal of Speculative altText

`ProductImage.altText` is explicitly removed from this feature design:
- No existing admin ownership path
- Owner did not request separate per-image alt metadata
- DTO does not preserve it
- YAGNI (You Aren't Gonna Need It)

**Accessibility rule:** All product gallery images use `Product.name` as safe alt text. Future per-image alt metadata can be introduced as a separate feature if required.

### 8.5 Relationship and Integrity Constraints

- Relationship: `Product 1 -> N ProductImage`
- Integrity: `@@unique([productId, sortOrder])` guarantees strictly ordered positions per product
- Ordering: `sortOrder 1..N`, with `id ASC` only as defensive read tie-breaking behavior for legacy or corrupted data
- Gallery length: strictly 1..4 images per product (enforced at API/write boundary)
- Duplicate URL rejection: server validation rejects duplicate normalized image URLs within the same product gallery

---

## 9. Primary Image Mirror Synchronization & Write Boundary

### 9.1 Single Write Boundary Lock

Existing authenticated `PUT /api/products` remains the single product-edit and gallery write boundary. Do NOT create a second gallery write endpoint.

The admin request may gain an optional authoritative gallery payload (`images: string[]`).

### 9.2 Transaction Validation & Mutation Branching

To eliminate validation-to-write race conditions and maintain unambiguous write authority, the boundary between pre-transaction validation and in-transaction revalidation is strictly defined:

**Before Transaction (Syntactic & Business-Independent):**
1. `requireAdmin(req)` authorization check.
2. Parse JSON body.
3. Validate field shapes and types (e.g., price is non-negative money).
4. If `images` gallery payload is present:
   - Normalize gallery URLs (trimming, path normalization).
   - Validate gallery count (1..4 URLs).
   - Reject with 400 if duplicate normalized URLs exist within the gallery.
   - If legacy `image` is ALSO present:
     - Require `normalize(image) === normalizedGallery[0]`.
     - Reject with 400 if it differs (`"Conflicting image authority: legacy 'image' does not match gallery primary 'images[0]'"`).
5. If only legacy `image` is present (no `images` payload):
   - Normalize legacy `image` string.
   - Validate non-empty string.

**Inside Database Transaction (Database-Dependent State & Mutations):**

```
BEGIN DATABASE TRANSACTION

Step A: Re-read and revalidate target Product by id:
        - Must exist (reject/rollback with 404 if not found).
        - Must be eligible for edit / not soft-deleted (deletedAt === null)
          (reject/rollback with 400 if soft-deleted).

Step B: Branch by request authority:

  CASE 1 — images gallery payload present:
    - images[] is authoritative.
    - Atomically replace the full ProductImage gallery:
      Delete existing ProductImage rows for productId.
      Create new ProductImage rows with sequential sortOrder = 1..N.
    - Synchronize mirror: Product.image = normalizedGallery[0].
    - Update other included Product fields.

  CASE 2 — NO images payload, legacy image present:
    - Load existing ProductImage rows for that product inside the transaction.
    - If gallery exists:
      Update/replace ONLY position 1 (sortOrder = 1) with normalized legacy image.
      Preserve secondary positions (sortOrder >= 2) exactly.
      Reject transaction (400) if the new position 1 URL duplicates any secondary URL.
    - If gallery does not exist:
      Create position 1 ProductImage row only (sortOrder = 1).
    - Synchronize mirror: Product.image = normalized legacy image.
    - Update other included Product fields.

  CASE 3 — NEITHER images NOR legacy image present (metadata-only PUT):
    - Do NOT mutate ProductImage gallery.
    - Do NOT mutate Product.image mirror.
    - Update only other allowed Product metadata fields included in the request.

Step C: COMMIT
On any failure: ROLLBACK
```

**Required Invariants:**
- Full gallery atomic replacement occurs ONLY when the authoritative `images[]` payload is present.
- Legacy `image`-only compatibility NEVER deletes secondary gallery entries.
- A metadata-only PUT NEVER rewrites gallery rows or `Product.image`.

### 9.3 Specific Mutation Behaviors

| Action | Behavior |
| :--- | :--- |
| Gallery order changes | `Product.image` updated atomically to new position-1 image |
| Primary image removed | Next ordered `ProductImage` becomes position 1; `Product.image` updated |
| All images removed | Server rejects (400); product must retain >= 1 image |
| Duplicate URLs in gallery | Server rejects (400); transaction not started |
| `images` and `image` conflict | Server rejects (400); transaction not started |
| Target Product soft-deleted | Server rejects (400) inside transaction; transaction rolled back |
| Legacy image PUT with existing gallery | Updates position 1; positions 2..N preserved; rejects if duplicate |
| Metadata-only PUT | Gallery and `Product.image` untouched |

---

## 10. Universal Migration & Backfill Design

### 10.1 Universal Scope

Backfill every existing `Product` row with a non-empty `Product.image` that has no `ProductImage` row, **regardless of `isActive` and `deletedAt`**.

**Reason:** Activation and soft-delete state must not determine whether media authority was migrated. Inactive or soft-deleted products that are later restored must have their media authority intact.

### 10.2 Sequence

```
Phase A: Schema — Add ProductImage model with @@unique([productId, sortOrder]); run migration
Phase B: Universal Backfill — Insert position-1 ProductImage for all eligible Product rows
Phase C: Universal Verification — Confirm all eligible Product rows have matching primary ProductImage
Phase D: Enable Read Authority — Public query reads ProductImage with Product.image fallback
Phase E: Deprecate Legacy Writes — Migrated Admin UI writes gallery payload
```

### 10.3 Conceptual Data Migration SQL

```sql
INSERT INTO "ProductImage" ("productId", "url", "sortOrder", "createdAt", "updatedAt")
SELECT p."id", TRIM(p."image"), 1, NOW(), NOW()
FROM "Product" p
WHERE p."image" IS NOT NULL
  AND TRIM(p."image") != ''
  AND NOT EXISTS (
    SELECT 1 FROM "ProductImage" pi WHERE pi."productId" = p."id"
  );
```

### 10.4 Universal Verification Query

```sql
-- Must evaluate ALL Product rows regardless of isActive or deletedAt:
SELECT p.id, p.image AS product_image, pi.url AS gallery_primary
FROM "Product" p
LEFT JOIN "ProductImage" pi
  ON pi."productId" = p.id
  AND pi."sortOrder" = 1
WHERE p.image IS NOT NULL
  AND TRIM(p.image) != ''
  AND (pi.url IS NULL OR pi.url != TRIM(p.image));
-- Must return 0 rows before enabling gallery authority
```

### 10.5 Migration Properties

- **Deterministic:** Each product receives exactly one `ProductImage` row with `sortOrder = 1` matching `Product.image`.
- **Idempotent:** Backfill skips products that already have `ProductImage` records.
- **Non-destructive:** `Product.image` remains in schema throughout this project phase.
- **Reversible:** Disabling gallery authority falls back to reading `Product.image` directly; no data loss.
- **Order snapshot safety:** `OrderItem` stores price/name snapshots at order time; existing order display is unaffected.

---

## 11. Media Read Contract

### 11.1 Public Card Read Architecture

As detailed in Section 6, the public catalog query executes:
1. Bounded `Product` query with `categoryId` and `categoryRel.name` selected
2. Count query
3. ONE batched `ProductImage` query for the bounded product IDs
4. ONE token-scoped batched `Subcategory` query for unique `(categoryId, subcategoryToken)` pairs

In-memory grouping maps images to products (capped to 4 per product).

### 11.2 Fallback During Migration

```
If ProductImage rows exist for product:
  use ordered ProductImage.url[] (max 4)
Else (pre-backfill compatibility):
  use [Product.image] as single-item gallery
```

### 11.3 Public Detail Read

Product detail consumes the same ordered `ProductImage` authority:
- Single query for the product details includes `images` ordered by `sortOrder ASC, id ASC`
- No separate media model for detail vs. card

---

## 12. Storefront Image Performance & Structural Loading Guarantee

Metadata availability does NOT mean all image assets should download. A structural guarantee is required.

### 12.1 Initial Paint Structural Guarantee

- **On initial card render: ONLY the current/primary slide's image element is rendered and mounted.**
- Secondary image URLs exist in DTO and component state, but their image DOM elements are NOT mounted hidden during initial paint.
- **Never render all four image elements merely with `loading="lazy"`** under the assumption that lazy loading guarantees deferred network loading across all browsers. Unmounted elements provide an absolute structural guarantee: zero secondary image network requests during initial paint.

### 12.2 On-Demand Fetching & Intelligent Prefetch

- When user:
  - Presses next/previous button
  - Selects an indicator dot
  - Swipes on touch
  - OR optionally first hovers/focuses the card gallery on desktop
- The next required secondary image is fetched/mounted.
- **Optional prefetch:** At most the NEXT likely slide (e.g., position 2 when viewing position 1) after interaction/hover/focus.
- **No unconditional prefetch** of positions 2–4.

### 12.3 Frame Stability & No Layout Shift

- While the next image loads:
  - Keep the current image and frame completely stable.
  - Switch/fade to the new image only after it has loaded.
  - Frame geometry is fixed: `aspect-square` with `overflow-hidden`.
  - Zero layout shift.
- `prefers-reduced-motion`: Transitions use opacity or instant switch; auto-play is not implemented.

### 12.4 Primary Image Conventions

Continue using `SafeImage` (wraps Next.js `Image`) for the primary image with:
- `priority=true` for above-fold cards
- Responsive `sizes`
- `quality={75}` default

---

## 13. Product Card Image Frame

### 13.1 Frame Contract

Both single-image and multi-image cards use identical frame geometry:

```
overflow-hidden
aspect-square (1:1)
rounded corners: rounded-[14px] sm:rounded-[18px] lg:rounded-[22px]
background: bg-[#f8f3ef]
```

Multi-image gallery controls are positioned inside the frame as overlays — they do not expand or alter frame dimensions.

### 13.2 Hover Zoom

```
transform: scale(1.03) on hover (existing behavior)
Applies to: current visible image only
overflow: hidden — scale cannot escape frame
No grid-neighbor reflow | No layout shift
prefers-reduced-motion: transform removed
```

---

## 14. Product Card Carousel Interaction

### 14.1 Multi-Image Card (images.length > 1)

- **Indicators:** Subtle dot buttons at the bottom of the image frame showing current slide index.
  - Rendered as ordinary `<button>` elements with `aria-label="Show image N of M"` and `aria-current="true"` (or `aria-pressed="true"`) on the active slide.
- **Navigation:** Previous/Next arrow buttons at left/right edges:
  - Rendered as `<button>` elements with `aria-label="Previous image"` and `aria-label="Next image"`.
  - Desktop: visible on hover/focus. Touch devices: always visible.
- **Touch/swipe:** Supported on mobile/tablet via horizontal swipe on the image frame.
- **Keyboard navigation:** Controls are Tab-focusable; Enter/Space activates.

### 14.2 Interaction Isolation

Gallery controls use `e.stopPropagation()`. They are positioned in the image overlay layer, separate from the `<Link>` wrapping the main image area. Clicking gallery controls or indicator dots cycles images and NEVER triggers navigation to `/product/{id}`. Wishlist button isolation is preserved.

### 14.3 Single-Image Card

No dots, no arrows, no swipe affordance. Identical layout and frame geometry to multi-image card.

---

## 15. Carousel State

```typescript
const [galleryIndex, setGalleryIndex] = useState(0);
// Resets to 0 when product.id changes
```

Gallery index is local presentation state only. It does NOT affect: URL, routing, catalog state, sorting, filtering, Load More, cart state, or wishlist state. No global carousel state.

---

## 16. Stock Display

### 16.1 Lock

Customer-facing stock status appears in ONE place only: the top status badge.

| Product State | Badge (top-left overlay) | CTA Button |
| :--- | :--- | :--- |
| Out of stock (`stock <= 0`) | `Out of Stock` (red pill) | Disabled; label: `Add to Cart` |
| Low stock (`0 < stock <= 5`, no promo) | `Low Stock` (amber pill) | Enabled; label: `Add to Cart` |
| In stock (`stock > 5`, no promo) | No inventory badge | Enabled; label: `Add to Cart` |
| Promotional (`stock > 0` with promo) | Promo badge (by tone) | Enabled; label: `Add to Cart` |

### 16.2 CTA Wording When Disabled

The disabled CTA button must be labelled `Add to Cart`, NOT `Out of Stock`.
- `Out of Stock` is already communicated by the top badge. Repeating it on the button creates visual redundancy.
- Screen reader users receive both the badge text and the disabled button semantics.

### 16.3 Explicit Prohibition

The following must NOT appear on the customer-facing product card:
- `Stock: 0` / `Stock: 2` / `Stock: N` (any numeric form)
- `Out of Stock` in the CTA button text

### 16.4 Backend Stock Authority

Removing visual stock text does NOT alter: `Product.stock`, `ProductVariant.stock`, `InventoryReservation`, cart quantity limits, admin inventory display, checkout validation, or order processing.

---

## 17. Product Card Visual Hierarchy

### 17.1 Locked Render Order

```
┌──────────────────────────────────────────────┐
│  [Status Badge]             [Heart Wishlist] │  <- image overlay layer
│                                              │
│              PRODUCT IMAGE                   │
│           (aspect-square, 1:1)               │
│                                              │
│  [Gallery indicator dots — multi-image only] │  <- image overlay layer
└──────────────────────────────────────────────┘
  SUBCATEGORY NAME  (eyebrow — unboxed, muted, uppercase)
  Product Name (strong title, line-clamp-2)
  ৳ Price   ৳ Strike-price (if compareAtPrice)
  [               Add to Cart                  ]
```

### 17.2 Eyebrow Treatment

- **Remove:** Current heavy rounded-pill chip (`bg-[#f8f3ef] rounded-full px-2.5 py-1`).
- **Replace:** Unboxed uppercase muted typography:
  ```
  text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.14em] text-[#8b5a45]
  ```
- **Content:** `subcategoryName ?? categoryName ?? null`. When null: eyebrow line is not rendered (no empty space).

### 17.3 Typography Weights

| Element | Relative Visual Weight |
| :--- | :--- |
| Product image | Dominant visual |
| Eyebrow | Weakest text |
| `Product.name` | Strongest text — `font-semibold` |
| Price | Prominent but secondary to name |
| CTA | Action — visually separated |

---

## 18. Deterministic Status and Promotional Badge Priority

At most ONE badge is displayed per card at any time. Badge priority is strictly locked:

```
1. Out of Stock  (stock <= 0 -> always wins, regardless of promo state)
2. Promotional   (stock > 0 and (badgeText || isHotDeal || isUpcoming))
3. Low Stock     (stock > 0 and stock <= 5 and no promotional badge)
4. None          (stock > 5 and no promotional badge)
```

**Deterministic Behavior Rules:**
- `stock <= 0` => `Out of Stock` badge always renders.
- Available product with active promotional state => Promotional badge renders (using existing `badgeText` > `isHotDeal` > `isUpcoming` hierarchy and tone styling).
- Available product with NO promotional badge and `0 < stock <= 5` => `Low Stock` badge renders.
- Otherwise => No badge rendered.
- `Out of Stock` badge appears exactly once (top overlay). The disabled CTA button reads `Add to Cart`.

---

## 19. Desktop Navigation Architecture

### 19.1 Breakpoint Lock

- **Desktop horizontal Category navigation:** `lg` (>= 1024px) and above.
- **Below `lg` (< 1024px):** Uses the existing mobile/tablet drawer + accordion architecture (covering mobile at 375px and tablet at 768px).

### 19.2 Primary Horizontal Layout & Budget

```
All Products | Cat 1 ▼ | Cat 2 ▼ | Cat 3 ▼ | Cat 4 ▼ | More ▼ | Track Order
```

- **Primary budget:** `DESKTOP_NAV_PRIMARY_BUDGET = 4` active categories by `Category.sortOrder ASC`.
- `More ▼` overflow appears ONLY when active category count exceeds 4.
- If total active categories <= 4, the `More ▼` dropdown is not rendered.
- **Label truncation:** Each visible top-level category label must have a CSS max-width and truncation treatment (e.g., `max-w-[140px] truncate`) so an unexpectedly long `Category.name` cannot force horizontal overflow.
- Full human-readable category name is displayed inside dropdowns and menus.
- No runtime DOM-measurement algorithms.
- No hardcoded business category names.

### 19.3 Primary Category Link Behavior

Preserve Phase-5 category navigation semantics:

- **Clicking a top-level Category label always routes immediately to:**
  ```
  /shop?category={Category.slug}
  ```
  and displays all products for that category.
- If the Category has active subcategories, the hover dropdown provides **optional refinement links**.
- **The existence of a dropdown must NOT make `Category.name` non-navigable.** The top-level category label is a direct clickable link, while the dropdown panel opens on hover/focus.
- For categories with zero active subcategories: direct link only, with no dropdown affordance or arrow indicator.

---

## 20. More Menu Hierarchy & Grouped-Panel Design

### 20.1 Single Grouped Panel (No Nested Hover Trees)

The `More ▼` menu uses **ONE grouped dropdown panel**. It does NOT use nested hover submenus, flyout trees, or inline accordions:

- The `More ▼` panel displays all overflow categories (categories with `sortOrder` beyond the primary 4).
- For each overflow Category:
  - **`Category.name` is a clickable category link** directly navigating to `/shop?category={Category.slug}`.
  - Directly below or alongside it, all active **`Subcategory.name` links** are listed, navigating to `/shop?category={Category.slug}&subcategory={Subcategory.slug}`.
- **Subcategory accessibility is fully preserved:** Moving a category into the `More ▼` overflow does NOT hide or obstruct access to its subcategories.
- **Benefits:**
  - Predictable pointer behavior without hover tunnels.
  - Straightforward keyboard navigation and focus management.
  - Contained, stable panel layout.
- Category order follows `Category.sortOrder ASC`; subcategory order follows `Subcategory.sortOrder ASC`.

### 20.2 Direct-Link Behavior

- Categories with zero active subcategories inside the More panel render as a direct link without an empty subcategory list.
- In the mobile accordion (below `lg`), categories with zero subcategories render as direct navigation links with no accordion expand/collapse arrow.

---

## 21. Mobile & Tablet Navigation Architecture (< 1024px)

Reuse the existing `Navbar.tsx` mobile drawer and accordion subsystem below `lg` (< 1024px), serving mobile (375px) and tablet (768px).

### 21.1 Two Distinct Interactive Controls per Category

For a Category that has active subcategories, the mobile drawer MUST use **TWO distinct interactive controls**:

1. **`Category.name` (Direct Navigation Link):**
   - Ordinary navigation `<Link>` element.
   - Clicking routes immediately to: `/shop?category={Category.slug}`.
   - Preserves Phase-5 invariant: clicking a category immediately displays all products for that category.
   - Does NOT toggle the accordion.

2. **Separate Disclosure / Chevron Button (Accordion Toggle):**
   - Independent `<button>` element positioned alongside the Category link.
   - Toggles that category's subcategory accordion expand/collapse state.
   - Does NOT navigate.
   - Accessible name: `"Show subcategories for {Category.name}"` (or `"Hide subcategories for {Category.name}"` when expanded).
   - `aria-expanded="true"` when open, `aria-expanded="false"` when closed.
   - `aria-controls="{categoryId}-subcategories"` referencing the expandable subcategory container ID.
   - Touch target: minimum 44×44px.
   - Visible focus ring on keyboard focus.

Subcategory links within the expanded accordion remain optional refinement routes navigating to `/shop?category={Category.slug}&subcategory={Subcategory.slug}`.

### 21.2 Categories with Zero Active Subcategories

- Rendered as a single `Category.name` link only.
- **NO disclosure button, NO chevron icon, and NO empty accordion region.**
- Clicking routes directly to `/shop?category={Category.slug}`.

### 21.3 Preserved Drawer Behaviors

- Hamburger toggle open/close mechanics.
- Fixed `SafeMobileBottomNav` bottom tab bar.
- Auth session display and cart count indicators.
- Close-on-navigate behavior when any category or subcategory link is clicked.

---

## 22. Navigation Data Flow

Continue using existing `getCachedCategoryRows(false)` on SSR with `/api/categories` fallback. No new API contract. Existing `PublicCategory` / `PublicSubcategory` types supply `name`, `slug`, `isActive`, `sortOrder`, and `subcategories[]`.

---

## 23. Admin Gallery Ownership & Accessible Up/Down Reorder

### 23.1 Admin Product Edit UI

The admin product edit page (`/admin/products/[id]/edit`) gains a gallery management section:

- **View:** Ordered list of up to 4 images with preview thumbnail and position indicator.
- **Add:** Upload or URL entry for a new image (disabled when 4 images are present).
- **Remove:** Remove button per image (disabled when only 1 image remains).
- **Accessible Reorder (Up / Down Buttons):**
  - **Required mechanism:** Accessible **"Move Up"** and **"Move Down"** buttons per gallery item.
  - "Move Up" is disabled for the first image (`index === 0`).
  - "Move Down" is disabled for the last image (`index === images.length - 1`).
  - Reordering immediately updates the local desired gallery order state.
  - Drag-and-drop is NOT required for this feature (may be a future enhancement, but must not be necessary to manage order).
- **Primary indicator:** The first item in the list (`index === 0`) is labeled "Primary" (corresponds to `Product.image`).

### 23.2 Client-Server Contract

Admin UI submits the full desired gallery state as an array of image URLs (`images: string[]`) in the authenticated `PUT /api/products` request. Mirror synchronization is handled entirely server-side inside the transaction (Section 9).

---

## 24. Image Validation

Validation follows existing `normalizeImageSrc` conventions:
- Non-empty string after trimming
- Valid path forms: `/uploads/products/...`, `/images/...`, `https://...`
- Maximum 4 images per product (enforced at API boundary)
- Minimum 1 image per product
- Duplicate normalized URLs within the same product gallery are rejected with status 400
- Upload mechanics reuse existing `POST /api/upload`

---

## 25. Deterministic Failure & Fallback Behavior

| Scenario | Deterministic Behavior |
| :--- | :--- |
| Secondary image fails to load | Mark that slide unavailable for current `ProductCard` session; skip it in next/previous navigation; update indicator count accordingly; keep fixed frame geometry |
| Current / primary image fails to load | Use existing `SafeImage` category fallback image; keep fixed frame geometry |
| All gallery slides unavailable | Show standard `SafeImage` fallback in unchanged media frame |
| Zero `ProductImage` rows (pre-backfill) | Fallback to `[Product.image]` as single-item gallery |
| Gallery DB fetch failure | Fallback to `[Product.image]`; no error surfaced to customer |
| Unmatched `Product.subcategory` | `subcategoryName = null`; eyebrow falls back to `categoryName` |
| `Category` relation missing on legacy row | `categoryName = Product.category` snapshot |
| Admin removes final image | Server rejects (400); existing gallery unchanged |
| Admin submits > 4 images | Server rejects (400); existing gallery unchanged |
| Admin submits duplicate URLs | Server rejects (400); existing gallery unchanged |
| `images` and legacy `image` conflict | Server rejects (400); existing gallery unchanged |

No raw error or broken image icon is ever surfaced to the customer.

---

## 26. Product Detail Gallery Consistency

`ProductImage` is the shared media authority for both card and detail:
- Product detail reads `images` using the same ordered `ProductImage` selection (`sortOrder ASC, id ASC`).
- Card renders an inline carousel within its 1:1 frame.
- Detail renders a full gallery.
- Layout redesign of the product detail page is explicitly out of scope; integration is strictly consuming `images[]` from `ProductImage` authority.

---

## 27. Accessibility Design

### 27.1 Image Alternative Text

- **All product gallery images use `alt={product.name}` as safe alt text.**
- Speculative per-image `altText` is excluded from this feature design.

### 27.2 Carousel Accessibility Pattern

Do NOT use `role="tablist"` / `role="tab"` unless full tabpanel semantics with associated tabpanels are implemented. The preferred accessible carousel pattern is:

- **Carousel container:** Identified with `role="region"` and `aria-label="Product images for {product.name}"` or `aria-roledescription="carousel"`.
- **Navigation buttons:**
  - Previous button: `<button>` with `aria-label="Previous image"`
  - Next button: `<button>` with `aria-label="Next image"`
- **Slide indicators:** Ordinary `<button>` elements with:
  - `aria-label="Show image N of M"`
  - `aria-current="true"` (or `aria-pressed="true"`) on the active slide indicator
- **Touch targets:** Minimum 44×44px for all gallery navigation, wishlist buttons, and mobile disclosure buttons.
- **Focus:** Visible focus rings on all interactive controls.
- **Motion:** `prefers-reduced-motion` respected (opacity transition or instant switch; no auto-play).
- **Disabled CTA:** `disabled` attribute and `aria-disabled="true"`; button text remains `Add to Cart`.

---

## 28. Security / Commerce Non-Regression

The following are explicitly unchanged by this feature:

- Admin authentication (`requireAdmin()`) evaluated before transaction
- Customer authentication (session / CustomerSession)
- Cart price authority
- Checkout price authority (PostgreSQL `Decimal`)
- `Product.stock` and `ProductVariant.stock` authority
- `InventoryReservation` logic
- Payment and refund flows
- Order lifecycle state machine
- Rate limiting
- All Phase-5 catalog scalability invariants (bounded queries, keyset pagination, search exclusions)

No public write surface is introduced. Single write boundary is the existing authenticated `PUT /api/products`.

---

## 29. Rollout Sequence (Conceptual)

For future implementation planning only. Not the implementation plan itself.

```
Wave A: Schema & Universal Backfill Contracts
  - ProductImage model with @@unique([productId, sortOrder]) in schema.prisma (no redundant index)
  - Migration file
  - Universal backfill script (all eligible Product rows regardless of active/deleted)
  - Universal verification query

Wave B: Server Write Authority & Mirror Synchronization
  - Single write boundary in PUT /api/products
  - Pre-transaction syntactic validation + in-transaction Product revalidation
  - Branch by request authority:
    * Case 1: images payload present -> atomic replace full gallery (sortOrder 1..N), Product.image mirror sync
    * Case 2: legacy image only -> update position 1, preserve secondary positions 2..N, Product.image mirror sync
    * Case 3: metadata-only PUT -> ProductImage gallery and Product.image untouched
  - Conflict validation: images vs legacy image (400 if differing)

Wave C: Token-Bounded Batched Media & Category Read Strategy
  - Update PublicProductCardDTO (images: string[], categoryName, subcategoryName)
  - Bounded product query selects categoryId and categoryRel.name directly
  - One batch ProductImage query
  - ONE token-scoped batch Subcategory query (bounded by effective pageSize <= 48)
  - ProgressiveProductGrid prop forwarding

Wave D: Admin Gallery Management UI
  - Gallery section in /admin/products/[id]/edit
  - Accessible Up/Down reorder buttons (boundary disabled)
  - Image add/remove with primary indicator
  - Validation: max 4, min 1, no duplicate URLs

Wave E: ProductCard Visual, Carousel, and Structural Loading Cleanup
  - Remove Stock: N text
  - Unboxed eyebrow (subcategoryName -> categoryName)
  - Structural loading: only current image mounted initially
  - Gallery carousel controls with proper accessibility (no tablist misuse)
  - Deterministic badge priority: OOS > Promo > Low Stock
  - Disabled CTA labelled 'Add to Cart'

Wave F: Responsive Navigation Hierarchy
  - lg breakpoint (>= 1024px) for desktop horizontal nav
  - Primary budget = 4 active categories (DESKTOP_NAV_PRIMARY_BUDGET = 4)
  - Top-level category label remains directly clickable
  - Grouped More panel without nested hover trees
  - Mobile drawer: two distinct controls (Category link + separate disclosure button)
  - Direct-link for categories with zero subcategories (no disclosure/accordion)
  - Mobile drawer + accordion below lg

Wave G: Product Detail Gallery Integration
  - Detail page consumes images[] from ProductImage authority

Wave H: Full Regression & Real-Browser Responsive QA
  - 375×667 (mobile), 768×1024 (tablet), 1280×800 (desktop)
  - All visual acceptance criteria verified
```

---

## 30. File Responsibility Map

### Confirmed Files (Known to require modification)

| File | Change Area |
| :--- | :--- |
| `prisma/schema.prisma` | Add `ProductImage` model with `@@unique([productId, sortOrder])` and `Product.images` relation |
| `prisma/migrations/<timestamp>/` | New migration for `ProductImage` table |
| `lib/catalog/types.ts` | Add `images: string[]`, `categoryName`, `subcategoryName` to `PublicProductCardDTO` |
| `lib/catalog/publicCatalogQuery.ts` | Select `categoryId` and `categoryRel.name`; batch `ProductImage` and token-scoped `Subcategory` |
| `components/ui/ProductCard.tsx` | Eyebrow, structural gallery mounting, carousel controls, remove Stock:N text, CTA label, badge priority |
| `components/shop/ProgressiveProductGrid.tsx` | Forward `images`, `categoryName`, `subcategoryName` props |
| `components/layout/Navbar.tsx` | `lg` breakpoint, primary budget = 4, clickable category links, grouped More panel, two-control mobile accordion |
| `app/admin/products/[id]/edit/page.tsx` | Gallery management UI with accessible Up/Down buttons |
| `app/api/products/route.ts` | Single write boundary: pre-tx validation, in-tx product check, 3-way mutation branching, conflict rejection |

### Likely Files (Requires implementation-phase confirmation)

| File | Change Area |
| :--- | :--- |
| `components/shop/ShopProductGridClient.tsx` | Forward new DTO props (if still used) |
| `components/home/ProductSection.tsx` | Forward new DTO props |
| `app/product/[id]/page.tsx` | Consume `ProductImage` authority for detail gallery |
| `tests/public-catalog-query.test.ts` | Update DTO assertions; add query shape and token-scoping tests |
| New test files | Gallery integrity, universal migration, conflict handling, subcategory resolution, mobile two-control accordion |

---

## 31. Responsive Visual Acceptance

Future implementation must pass real-browser verification at:

| Viewport | Dimensions | Navigation Treatment |
| :--- | :--- | :--- |
| Mobile | 375 × 667 | Mobile drawer: Category link + separate chevron disclosure button |
| Tablet | 768 × 1024 | Mobile/tablet drawer: Category link + separate chevron disclosure button (below `lg`) |
| Desktop | 1280 × 800 | Desktop horizontal nav with primary budget = 4 + grouped `More ▼` panel (`lg`+) |

Runtime viewport dimensions must be asserted via CDP device emulation (as established in Task 9B).

**Acceptance checklist:**
- No horizontal overflow (`scrollWidth <= innerWidth`) across all viewports
- Stable card heights across the product grid
- No image zoom layout shift
- Single-image cards: clean, polished, no carousel controls
- Multi-image cards: indicators and navigation functional; touch/swipe supported
- Structural loading: only current image element mounted initially; secondary loaded on interaction
- No duplicate "Out of Stock" text (badge only; disabled button reads "Add to Cart")
- Deterministic badge priority: OOS > Promo > Low Stock
- No numeric stock text (`Stock: N`)
- Gallery controls keyboard-accessible with visible focus rings
- Desktop navbar uncluttered at 1280px; category labels truncated if long; top-level category remains directly clickable
- Grouped More panel presents categories and subcategories cleanly without nested hover submenus
- Mobile drawer accordion: clicking Category name routes to category shop page; clicking separate chevron expands/collapses subcategories; zero-subcategory categories have link only and no chevron

---

## 32. Testing Strategy

Tests written during the implementation phase. Do NOT write test code now.

| ID | Category | What to Test |
| :--- | :--- | :--- |
| A | Universal Migration | Every Product with non-empty image (active or soft-deleted) gets one ProductImage with sortOrder=1; idempotent |
| B | Mirror Sync | `Product.image === gallery[0].url` after any gallery mutation |
| C | Max 4 Images | Saving 5 images is rejected (400) |
| D | Min 1 Image | Removing the last image is rejected (400) |
| E | Unique URLs | Duplicate URLs in gallery payload rejected (400) |
| F | Conflict Rejection | When both `images` and legacy `image` are provided and differ, request is rejected (400) with zero mutation |
| G | Reorder -> Mirror | After reordering gallery, `Product.image` reflects new position 1 |
| H | Remove Primary -> Promote | Removing position 1 promotes position 2; `Product.image` updates |
| I | Single Write Boundary | Authenticated `PUT /api/products` handles gallery payload; auth and syntax check before transaction |
| J | In-Tx Revalidation | Target Product existence and non-deleted eligibility rechecked inside transaction (prevents race) |
| K | Legacy image Write (Case 2) | Legacy `PUT /api/products` with `image` only updates position 1 and preserves positions 2..N exactly |
| L | Metadata-Only PUT (Case 3) | PUT without `images` or `image` updates metadata only; does NOT touch ProductImage gallery or Product.image |
| M | Full Replace on images (Case 1) | PUT with `images` atomically replaces full gallery with sortOrder 1..N and syncs Product.image mirror |
| N | Catalog DB Query Shape | Bounded product query (with `categoryId`) + count + one batch `ProductImage` + one token-scoped batch `Subcategory` |
| O | Token-Scoped Subcategory | Subcategory batch query fetches ONLY candidate matches for current page tokens (bounded by pageSize <= 48) |
| P | Category.name Direct | `categoryName` derived from `categoryRel.name` without calling `getCachedCategoryRows()` |
| Q | Subcategory Resolution | Resolves by slug; by name; unmatched -> null |
| R | Eyebrow Fallback | subcategoryName null -> categoryName; both null -> no eyebrow rendered |
| S | Structural Loading | On initial mount, only primary image element exists in DOM; secondary mounts on interaction |
| T | Broken Secondary Slide | Secondary load failure marks slide unavailable, skips in navigation, updates control count |
| U | No Numeric Stock | ProductCard renders no `Stock: N` string |
| V | Deterministic Badge Priority | `stock <= 0` -> OOS; promo -> Promo; low stock -> Low Stock |
| W | Disabled CTA Label | Disabled CTA reads "Add to Cart", not "Out of Stock" |
| X | Desktop Nav Budget | At `lg`+, first 4 active categories in primary nav; remainder in grouped More panel |
| Y | Clickable Category Nav | Top-level category label routes to `/shop?category={slug}` even when dropdown exists |
| Z | Grouped More Panel | Single panel renders category links + subcategory links without nested hover submenus |
| AA | Mobile Two-Control Nav | Category link routes to shop; separate disclosure button toggles accordion with aria-expanded/aria-controls |
| AB | Zero-Subcategory Direct Link | Category with zero subcategories renders link only with no chevron button or empty accordion |
| AC | Admin Up/Down Reorder | Up disabled on first, Down disabled on last; reordering alters desired order |
| AD | Responsive Browser QA | Pass visual checklist at 375×667, 768×1024, 1280×800 |

---

## 33. Locked Design Decisions

| ID | Decision |
| :--- | :--- |
| D1 | `Product.name` remains the authoritative customer display title |
| D2 | `Product.displayName` is not introduced |
| D3 | `categoryRel.name` (relational join in bounded query) is the primary category display value |
| D4 | `Subcategory.name` (relational, token-bounded batch-resolved) is the authoritative subcategory display value |
| D5 | `Product.subcategoryId` is not introduced for this feature |
| D6 | Relational `ProductImage` becomes the authoritative product gallery |
| D7 | `Product.image` remains as a synchronized compatibility primary-image mirror |
| D8 | `Product.image` mirror is synchronized transactionally within the gallery write |
| D9 | Maximum 4 gallery images per product; minimum 1 image (enforced at write) |
| D10 | Primary image = first ordered `ProductImage` (sortOrder = 1) |
| D11 | `ProductImage` schema uses `@@unique([productId, sortOrder])`; redundant `@@index` removed |
| D12 | Existing authenticated `PUT /api/products` is the single write boundary (no second endpoint) |
| D13 | Authentication & syntax validation occur BEFORE transaction; Product existence/deleted state re-checked INSIDE transaction |
| D14 | Speculative `ProductImage.altText` is removed; all gallery images use `Product.name` as alt text |
| D15 | Catalog read uses ONE batch `ProductImage` query and ONE token-scoped batch `Subcategory` query (no N+1 loops) |
| D16 | Bounded product query explicitly projects `categoryId` to supply subcategory batch resolution |
| D17 | Subcategory batch query OR count bounded by effective product-query pageSize (normal chunk = 24, hard public max = 48) |
| D18 | Structural loading guarantee: only current/primary image element mounted initially; secondary on interaction |
| D19 | At most next likely slide prefetched after interaction; no unconditional prefetch of positions 2–4 |
| D20 | Broken secondary image is marked unavailable and skipped in navigation; fixed frame geometry |
| D21 | Single-image cards show no carousel controls |
| D22 | Multi-image cards show indicator buttons and navigation controls with touch/swipe support |
| D23 | Carousel accessibility uses region + standard buttons; does NOT misuse `role="tablist"` / `role="tab"` |
| D24 | Hover zoom is scoped to the image frame (overflow-hidden); cannot cause layout shift |
| D25 | No numeric stock (`Stock: N`) on any customer-facing ProductCard surface |
| D26 | Deterministic badge priority: Out of Stock (1) > Promotional (2) > Low Stock (3) > None (4) |
| D27 | "Out of Stock" badge appears exactly once (top overlay) when stock <= 0; disabled CTA reads "Add to Cart" |
| D28 | Cart, wishlist, stock business logic unchanged; presentation-only cleanup |
| D29 | Desktop horizontal category nav begins at `lg` (>= 1024px); below `lg` uses drawer + accordion |
| D30 | Desktop nav primary budget = 4 active categories (`DESKTOP_NAV_PRIMARY_BUDGET = 4`) |
| D31 | Top-level category label is directly clickable navigating to `/shop?category={slug}` even when dropdown exists |
| D32 | More menu uses ONE grouped panel without nested hover trees; preserves category and subcategory links |
| D33 | Categories with zero subcategories render as direct link with no dropdown/accordion arrow |
| D34 | Universal backfill: all non-empty Product rows migrated regardless of active/deleted status |
| D35 | Gallery conflict semantics: `images` is authoritative; if legacy `image` differs from `images[0]`, reject 400 |
| D36 | 3-way write branching: Case 1 (images) = atomic replace full gallery; Case 2 (legacy image) = update pos 1, preserve secondaries; Case 3 (metadata-only) = gallery/mirror untouched |
| D37 | Mobile accordion uses TWO distinct controls: Category.name navigation link + separate chevron disclosure button with aria-expanded/aria-controls |
| D38 | Admin gallery reordering requires accessible Up/Down buttons (boundary disabled); drag-and-drop not required |

---

## 34. Owner Decision Required Before Implementation Plan

None. All design decisions are resolved from the current codebase and the owner-approved approach.

---

## 35. Self-Review Checklist

- [x] No "at most 24" architectural maximum remains for public query batches (§6.3, D17)
- [x] Public absolute maximum remains 48 (`MAX_PAGE_SIZE = 48`); normal progressive chunk remains 24
- [x] Full gallery atomic replacement occurs ONLY when authoritative `images[]` payload is present (§9.2, D36)
- [x] Legacy `image`-only path updates position 1 and preserves secondary positions 2..N without deletion (§9.2, D36)
- [x] Metadata-only PUT (neither `images` nor `image` present) does NOT touch gallery or `Product.image` mirror (§9.2, D36)
- [x] Mobile Category link and accordion disclosure are separate controls (§21.1, D37)
- [x] Category with zero active subcategories has no disclosure button and no empty accordion (§21.2, D33)
- [x] Database-dependent target Product validation rechecked inside transaction (§9.2, D13)
- [x] Badge priority deterministic: OOS > Promo > Low Stock > None (§18, D26)
- [x] More panel has no "nested OR inline" ambiguity — locked to single grouped panel (§20.1, D32)
- [x] Category label remains directly navigable even when dropdown exists (§19.3, D31)
- [x] Accessible Up/Down reordering locked for Admin UI (§23.1, D38)
- [x] Redundant `ProductImage` secondary index removed; `@@unique([productId, sortOrder])` only (§8.2, §8.3, D11)
- [x] No TODO / TBD / placeholders
- [x] No production implementation performed
- [x] File verified as valid UTF-8 without mojibake

---

*End of Design Specification*
