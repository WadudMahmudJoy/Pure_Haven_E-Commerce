# Phase 4 — Database Architecture Design
**Pure Haven BD**
**Date:** 2026-08-27
**Status:** DRAFT — Awaiting Owner Review

---

## 1. Background & Objective

Phase 1 established admin authentication. Phase 2 established the full commerce domain (orders, inventory, payment, returns) on PostgreSQL/Prisma. Phase 3 established customer authentication on PostgreSQL/Prisma.

However, significant persistent state still lives outside PostgreSQL:

- Admin credentials → `data/admin-auth.json`
- Site branding → `data/site-settings.json`
- Footer content → `data/footer-settings.json`
- Home promotional banners → `data/home-promos.json`
- Customer contact messages → `data/customer-messages.json`

Additionally, the existing PostgreSQL schema carries accumulated technical debt:

- All monetary fields use `Float` (IEEE 754 double) — introducing possible rounding errors for BDT commerce
- `Product` lacks `isActive`/`deletedAt` for catalog lifecycle management
- `Product.category` is a plain `String` with no FK to `Category`
- `Order.status` and `PaymentRecord.state` are plain `String` — not DB-backed enums
- `InventoryReservation.status` is a plain `String`
- Several missing indexes on high-read-path queries
- No DB-level `CHECK` constraints on stock non-negativity or money bounds
- `HomeSlide` exists in PostgreSQL; `HomePromo` does NOT — creating a dual-system for home content
- `CustomerMessage` (contact form) has no PostgreSQL model at all
- Admin credentials have no PostgreSQL model at all

Phase 4 will eliminate these gaps, establish PostgreSQL as the single source of truth for all mutable business data, and harden the relational schema.

---

## 2. Current Persistence Inventory

### 2.1 PostgreSQL / Prisma (POSTGRESQL_AUTHORITY)

| Model | Read Paths | Write Paths | Notes |
|:---|:---|:---|:---|
| `Product` | `/api/products GET`, `/product/[id]`, shop/admin UIs | `/api/products POST/PUT/DELETE` | No `isActive`, no FK to `Category` |
| `ProductVariant` | Product detail pages, checkout | Product admin CRUD | Cascade delete from Product |
| `Category` | Category nav, shop filter | `/api/categories` | Has `Subcategory` relation. Product.category is a free-text string, not a FK |
| `Subcategory` | Shop filter | Category admin | Unique `[categoryId, slug]` |
| `Order` | Customer dashboard, admin orders, tracking | Checkout, admin status mutations | `Float` money, `String` status |
| `OrderItem` | Order detail, returns | Checkout | `Float` price snapshot |
| `InventoryReservation` | Inventory lifecycle | Order creation, cancellation, fulfillment | `String` status (not enum) |
| `PaymentRecord` | Payment dashboard, admin | Payment evidence, admin accept/reject | `Float` refundAmount, `String` state |
| `PaymentEvidenceAttempt` | Admin payment review | Evidence submission | Properly indexed |
| `ReturnItem` | Admin return management | Returns API | `String` disposition |
| `HomeSlide` | Homepage hero slider | Admin slides CRUD | **Already in PostgreSQL** |
| `User` | Customer auth, dashboard | Registration, identity changes | Phase-3 locked |
| `CustomerSession` | All authenticated customer routes | Login, logout | Phase-3 locked |
| `CustomerAuthToken` | Password reset, email verification | Recovery flows | Phase-3 locked |

### 2.2 Legacy JSON / File System (LEGACY_JSON_AUTHORITY)

| File | Read Path | Write Path | Entities | Runtime Authority |
|:---|:---|:---|:---|:---|
| `data/admin-auth.json` | `app/api/admin-auth/route.ts` (POST/GET) | `app/api/admin-auth/route.ts` (PUT) | Admin email, passwordHash, recoveryEmail, recoveryPhone, recoveryCodeHash | **ACTIVE_RUNTIME AUTH** |
| `data/site-settings.json` | `app/api/site-settings/route.ts` (GET) | `app/api/site-settings/route.ts` (PUT) | siteName, siteSubtitle, logoUrl | **ACTIVE_RUNTIME CONTENT** |
| `data/footer-settings.json` | `app/api/footer-settings/route.ts` (GET), `app/page.tsx` (readJsonFile) | `app/api/footer-settings/route.ts` (PUT) | Brand, address, phone, email, social, links | **ACTIVE_RUNTIME CONTENT** |
| `data/home-promos.json` | `app/api/home-promos/route.ts` (GET), `app/page.tsx` (readJsonFile) | `app/api/home-promos/route.ts` (POST/PUT/DELETE) | Promotional banners (small/wide/slider kinds) | **ACTIVE_RUNTIME CONTENT** |
| `data/customer-messages.json` | `app/api/customer-messages/route.ts` (GET) | `app/api/customer-messages/route.ts` (POST) | Contact form messages with status tracking | **ACTIVE_RUNTIME BUSINESS DATA** |
| `data/customer-users.json` | None found in runtime code | None | Legacy customer auth remnant | `INERT_LEGACY` |
| `data/orders.json` | None found in runtime code | None | Legacy orders remnant | `INERT_LEGACY` |
| `data/products.json` | None found in runtime code | None | Legacy products remnant | `INERT_LEGACY` |

### 2.3 Other Persistence

| Source | Classification | Notes |
|:---|:---|:---|
| `localStorage` | `CLIENT_UI_STATE` | Cart, wishlist, UI prefs only. No auth authority (purged in Phase 3) |
| Environment variables | `CONFIGURATION` | `DATABASE_URL`, `APP_ORIGIN`, `SESSION_SECRET`, `ADMIN_SESSION_SECRET` |
| Uploaded files (`/uploads/`) | `CONTENT_STORAGE` | Local filesystem image storage; no DB record tracking |

---

## 3. Prisma Schema Audit

### 3.1 Model Classification

| Model | Phase-4 Classification | Key Findings |
|:---|:---|:---|
| `Product` | `EXTEND` | Missing: `isActive`, `deletedAt`, `slug`, `categoryId` FK, stock non-neg constraint |
| `ProductVariant` | `NORMALIZE` | Missing: `isActive`; stock can theoretically go negative at DB level |
| `Order` | `NORMALIZE` | Float money; `status` is untyped String; missing indexes on `createdAt`, `status` |
| `OrderItem` | `KEEP` | Snapshot design is correct. Float price. Missing: explicit `@@index([orderId])` |
| `InventoryReservation` | `NORMALIZE` | `status` should be PostgreSQL enum; add index on `evidenceDeadlineAt` |
| `PaymentRecord` | `NORMALIZE` | `state`, `codSettlementState` should be enums; Float refundAmount |
| `PaymentEvidenceAttempt` | `KEEP` | Well-indexed. String state could become enum |
| `ReturnItem` | `NORMALIZE` | `disposition` should be enum; missing index on `restockedAt` |
| `Category` | `KEEP` | Well-designed. `Product.category` String has no FK constraint |
| `Subcategory` | `KEEP` | Well-designed |
| `HomeSlide` | `KEEP` | Already PostgreSQL-backed |
| `User` | `KEEP` | Phase-3 locked. Consider index on `isActive` for session validation |
| `CustomerSession` | `KEEP` | Phase-3 locked |
| `CustomerAuthToken` | `KEEP` | Phase-3 locked |
| — `AdminCredential` | `MIGRATE_FROM_JSON` | **Does not exist in schema yet** — currently `data/admin-auth.json` |
| — `SiteBranding` | `MIGRATE_FROM_JSON` | **Does not exist in schema yet** — currently `data/site-settings.json` |
| — `FooterSettings` | `MIGRATE_FROM_JSON` | **Does not exist in schema yet** — currently `data/footer-settings.json` |
| — `HomePromo` | `MIGRATE_FROM_JSON` | **Does not exist in schema yet** — currently `data/home-promos.json` |
| — `CustomerMessage` | `MIGRATE_FROM_JSON` | **Does not exist in schema yet** — currently `data/customer-messages.json` |

### 3.2 Enum Candidates (Currently Plain Strings)

| Field | Current | Proposed Enum Values |
|:---|:---|:---|
| `Order.status` | `String` | `PENDING`, `CONFIRMED`, `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED`, `RETURN_RECEIVED`, `FAILED_DELIVERY` |
| `InventoryReservation.status` | `String` | `RESERVED`, `RELEASED`, `FULFILLED` |
| `PaymentRecord.state` | `String` | `AWAITING_PAYMENT`, `VERIFICATION_PENDING`, `PAID`, `REJECTED`, `FAILED`, `REFUND_REQUIRED`, `REFUND_PROCESSING`, `REFUNDED` |
| `PaymentRecord.codSettlementState` | `String?` | `NOT_APPLICABLE`, `PENDING`, `SETTLED`, `DISPUTED` |
| `PaymentEvidenceAttempt.state` | `String` | `PENDING_REVIEW`, `ACCEPTED`, `REJECTED`, `FAILED` |
| `ReturnItem.disposition` | `String` | `PENDING_INSPECTION`, `RESTOCKABLE`, `NON_RESTOCKABLE`, `DAMAGED` |

> **CAUTION**: Converting plain `String` columns to PostgreSQL enums requires a careful expand-validate-contract migration. Existing data values must be verified before adding enum constraints.

---

## 4. Money / Decimal Audit

### 4.1 Current Float Fields (IEEE 754)

| Model | Fields |
|:---|:---|
| `Product` | `price Float`, `compareAtPrice Float?` |
| `ProductVariant` | `price Float` |
| `Order` | `subtotal Float`, `deliveryFee Float`, `total Float` |
| `OrderItem` | `price Float`, `compareAtPrice Float?` |
| `PaymentRecord` | `refundAmount Float?` |

### 4.2 Problem Statement

IEEE 754 double-precision floating point cannot represent certain decimal fractions exactly. For commerce, this creates the risk of accumulated rounding errors in subtotals, totals, and refund calculations.

### 4.3 Proposed Migration: `Float` → `Decimal`

**Prisma type**: `Decimal` (maps to PostgreSQL `NUMERIC`)
**Recommended precision/scale**: `NUMERIC(12, 2)` — supports values up to BDT 9,999,999,999.99 with exactly 2 decimal places.

**Serialization**: Prisma returns `Decimal` as `Prisma.Decimal` objects. API DTOs must call `.toNumber()` or `.toString()` explicitly. No implicit coercion.

**Migration Safety**:
1. Expand: Add parallel `Decimal` columns alongside existing `Float` columns
2. Backfill: `ROUND(float_col, 2)` into new Decimal columns
3. Validate: Query for any rows where the rounded values differ significantly
4. Switch application code to write/read new Decimal columns
5. Contract: Drop old Float columns once all paths are verified

> **DECISION REQUIRED (D2)**: Owner must approve migration to `NUMERIC(12, 2)`. This is the highest-impact single migration in Phase 4.

---

## 5. Product / Inventory Architecture Findings

### 5.1 Stock Authority (Phase-2 Locked, Preserved)

- **Variant product**: `ProductVariant.stock` is authoritative; `Product.stock` is aggregate mirror
- **Non-variant product**: `Product.stock` is authoritative

### 5.2 Schema Gaps

| Gap | Risk | Proposed Fix |
|:---|:---|:---|
| No `CHECK (stock >= 0)` on `Product.stock` or `ProductVariant.stock` | Service-level only; DB allows negative stock if bypassed | Add CHECK constraint |
| No `Product.isActive` / `deletedAt` field | Hard delete removes historical order snapshot context | Add `isActive Boolean @default(true)` + soft delete |
| `Product.category` is a free-text `String`, not FK to `Category.slug` | Category rename breaks filter links | Add `Product.categoryId Int?` FK with backfill |
| `ProductVariant` has no `isActive` field | Discontinued variants may still appear in cart | Add `isActive Boolean @default(true)` |
| No `Product.slug` field | Product URLs use `id`; SEO-unfriendly | Add `slug String? @unique` for Phase-5 |

---

## 6. Order / Payment Model Findings

### 6.1 Order Model Gaps

| Finding | Recommendation |
|:---|:---|
| `Order.status` is untyped `String @default("pending")` | Convert to PostgreSQL enum (Wave D) |
| Missing `@@index([status])` on Order | Add index |
| Missing `@@index([createdAt])` on Order | Add index |
| `Order.paymentMethod/paymentProvider/paymentSenderNumber/paymentTrxId` duplicated from `PaymentRecord` | See Decision D9 |
| Float money fields | Migrate to Decimal (Wave C) |

### 6.2 OrderItem

Missing `@@index([orderId])` — add in Wave E.

### 6.3 PaymentRecord / PaymentEvidenceAttempt

`state`, `codSettlementState`, `state` (evidence) all need enum conversion. `refundAmount Float?` needs Decimal migration.

---

## 7. Customer / Auth Data Findings (Phase-3 Preserved)

No weakening of Phase-3 invariants. The following additions are proposed:

| Addition | Type | Priority |
|:---|:---|:---|
| `CHECK (email IS NOT NULL OR "normalizedPhone" IS NOT NULL)` on `User` | DB CHECK constraint | HIGH |
| `@@index([isActive])` on `User` | Index | MEDIUM |
| `@@index([userId, expiresAt])` composite on `CustomerSession` | Composite index | MEDIUM |

---

## 8. Admin Data Architecture

### 8.1 Current State

Admin authentication runs entirely through `data/admin-auth.json` via `fs.readFile` / `fs.writeFile` in `app/api/admin-auth/route.ts`.

### 8.2 Risk Analysis

| Risk | Severity |
|:---|:---|
| File-based auth fails on serverless multi-instance deployments | **HIGH** |
| No admin session revocation mechanism | MEDIUM |
| No audit log of credential changes | MEDIUM |
| File write race conditions under concurrent requests | LOW |

### 8.3 Proposed PostgreSQL Migration

```prisma
model AdminCredential {
  id               Int      @id @default(autoincrement())
  email            String   @unique
  passwordHash     String
  recoveryEmail    String?
  recoveryPhone    String?
  recoveryCodeHash String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

> **DECISION REQUIRED (D1)**: Owner must decide whether admin authentication moves to PostgreSQL in Phase 4.
> **CRITICAL**: Admin and customer auth must NOT be merged. `AdminCredential` is strictly separate from `User`.

---

## 9. Content / Settings Architecture

### 9.1 Dual Home Content Problem

`HomeSlide` exists in PostgreSQL. `HomePromo` exists only in `data/home-promos.json`. These are distinct entities and should remain separate PostgreSQL models.

### 9.2 Proposed New Models

```prisma
model HomePromo {
  id        Int      @id @default(autoincrement())
  kind      String   // small | wide | slider
  label     String
  title     String
  subtitle  String   @default("")
  image     String
  href      String   @default("/shop")
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([isActive, sortOrder])
}

model SiteBranding {
  id           Int      @id @default(autoincrement())
  siteName     String   @default("PURE")
  siteSubtitle String   @default("HAVEN BD")
  logoUrl      String?
  updatedAt    DateTime @updatedAt
}

model FooterSettings {
  id            Int      @id @default(autoincrement())
  brandTitle    String   @default("PURE HAVEN BD")
  brandSubtitle String   @default("")
  description   String   @default("")
  address       String   @default("")
  phone         String   @default("")
  email         String   @default("")
  facebookUrl   String   @default("#")
  instagramUrl  String   @default("#")
  paymentNote   String   @default("")
  copyright     String   @default("")
  quickLinks    String   @default("")  // pipe-delimited; normalized in Phase 5
  categoryLinks String   @default("")
  policyLinks   String   @default("")
  updatedAt     DateTime @updatedAt
}

model CustomerMessage {
  id        Int      @id @default(autoincrement())
  name      String
  phone     String?
  email     String?
  message   String
  status    String   @default("unread") // unread | read | replied
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status])
  @@index([createdAt])
}
```

> **DECISION REQUIRED (D3)**: Approve `SiteBranding` as structured model vs. generic key-value `SiteSettings`.
> **DECISION REQUIRED (D4)**: Approve keeping pipe-delimited footer link fields for Phase 4, normalized in Phase 5.

---

## 10. Delete / Archive Policy

| Model | Current | Proposed |
|:---|:---|:---|
| `Product` | Hard delete | `SOFT_DELETE_REQUIRED` — add `isActive`, `deletedAt` |
| `ProductVariant` | Cascade delete | `SOFT_DELETE_REQUIRED` if parent soft-deleted |
| `Category` | Hard delete | `RESTRICT` if products reference it; hard delete otherwise |
| `Order` | `Restrict` on User | `ARCHIVE_STATUS` — preserve all historical orders |
| `User` | `Restrict` (Phase-3) | `SOFT_DELETE` via `isActive=false` — never hard delete |
| `AdminCredential` (new) | N/A | `RESTRICT` — update only, never delete |
| `HomeSlide` | Hard delete | `HARD_DELETE_ALLOWED` (owner-controlled content) |
| `HomePromo` (new) | Hard delete | `HARD_DELETE_ALLOWED` |
| `CustomerMessage` (new) | Hard delete | `HARD_DELETE_ALLOWED` + `status` soft-archive |

---

## 11. Index Audit

### 11.1 Missing High-Priority Indexes

| Table | Index | Justification |
|:---|:---|:---|
| `Order` | `@@index([status])` | Admin filter by status |
| `Order` | `@@index([createdAt])` | Pagination |
| `OrderItem` | `@@index([orderId])` | Load items for order |
| `InventoryReservation` | `@@index([evidenceDeadlineAt])` | Expiry engine |
| `User` | `@@index([isActive])` | Session validation |
| `CustomerSession` | `@@index([userId, expiresAt])` composite | Active session lookup |
| `HomePromo` (new) | `@@index([isActive, sortOrder])` | Homepage render |

---

## 12. Constraint Hardening

| Constraint | Model | Priority |
|:---|:---|:---|
| `CHECK (stock >= 0)` | `Product`, `ProductVariant` | HIGH |
| `CHECK (quantity > 0)` | `OrderItem`, `InventoryReservation`, `ReturnItem` | HIGH |
| `CHECK (price >= 0)` | `Product`, `ProductVariant` | MEDIUM |
| `CHECK (email IS NOT NULL OR "normalizedPhone" IS NOT NULL)` | `User` | HIGH (Phase-3 invariant hardened to DB) |

---

## 13. Security / Privacy Data Classification

| Field | Classification | Enforcement |
|:---|:---|:---|
| `User.passwordHash` | `SECRET_HASH` | Never log, never expose in API response |
| `CustomerSession.tokenHash` | `SECRET_HASH` | Never log; raw token only in HttpOnly cookie |
| `CustomerAuthToken.tokenHash` | `SECRET_HASH` | Never log; raw token only in recovery email |
| `AdminCredential.passwordHash` | `SECRET_HASH` | Never log |
| `AdminCredential.recoveryCodeHash` | `SECRET_HASH` | Never log |
| `User.email` | `PII` | Masked in logs |
| `User.normalizedPhone` | `PII` | Masked in logs |
| `Order.customerPhone` | `PII` | Admin-visible; redacted from public tracking DTO |
| `Order.customerAddress` | `PII` | Admin-visible; redacted from public tracking DTO |
| `PaymentEvidenceAttempt.senderNumber` | `PII` | Admin-visible only |
| `PaymentEvidenceAttempt.trxId` | `FINANCIAL` | Admin-visible only |
| `PaymentRecord.refundAmount` | `FINANCIAL` | Admin-visible only |
| `ReturnItem.adminNote` | `OPERATIONAL` | Admin-only |
| `CustomerMessage` (new) | `PII` | Admin-only; contains customer contact info |

---

## 14. Migration Safety Strategy

All Phase-4 migrations follow **expand / backfill / validate / contract**:

1. **Never destructive one-step migration** on live commercial data
2. **Test DB first**: rehearse all migrations on `DATABASE_URL_TEST`
3. **Backfill before constraining**: add column nullable → backfill → add NOT NULL
4. **Validate before contract**: verify zero NULL/invalid rows before constraint
5. **Document rollback SQL** per migration before applying to Neon
6. **Pre-migration `pg_dump`** required before each destructive step

---

## 15. Proposed Phase-4 Waves

| Wave | Name | Scope | Risk |
|:---|:---|:---|:---|
| **A** | Schema Foundation | Add 5 new models; add soft-delete fields to Product/ProductVariant; add slug | LOW — additive only |
| **B** | JSON Authority Migration | Seed new models from JSON; switch API routes to Prisma; retire JSON write paths | MEDIUM — API route rewrites |
| **C** | Float → Decimal | Expand-backfill-validate-contract for all monetary fields | HIGH — most impactful |
| **D** | Enum Conversion | Convert all String status/state fields to Prisma enums | MEDIUM — careful backfill |
| **E** | Constraints & Indexes | Add CHECK constraints, missing indexes, soft-delete query filters | LOW — additive |
| **F** | Migration Rehearsal & Lock | Full regression; browser smoke; production build; owner gate | — |

---

## 16. Owner Decision Register

| # | Decision | Recommended | Risks | Impact |
|:---|:---|:---|:---|:---|
| **D1** | Admin auth → PostgreSQL? | YES — required for serverless deployments | Migration must not lock out admin | HIGH |
| **D2** | Float → NUMERIC(12,2)? | YES — required for commercial accuracy | Most complex migration; test suite updates | HIGH |
| **D3** | `SiteBranding` structured vs. key-value `SiteSettings`? | Structured model | Less flexible but type-safe | LOW |
| **D4** | FooterSettings: pipe-delimited links vs. `FooterLink` table? | Pipe-delimited for Phase 4; normalize in Phase 5 | Technical debt deferred | LOW |
| **D5** | Add `Product.categoryId` FK? | YES — with nullable FK + backfill | Backfill may fail for unmatched strings | MEDIUM |
| **D6** | Product soft-delete? | YES — add `isActive` + `deletedAt` | Requires filter changes in all product queries | LOW |
| **D7** | CustomerMessage retention policy? | PostgreSQL + hard-delete-allowed | Contact messages have low legal sensitivity | LOW |
| **D8** | Merge `HomePromo` + `HomeSlide`? | NO — keep separate | Different visual layouts and admin contexts | LOW |
| **D9** | Deprecate Order-level payment fields? | Deferred to Wave D evaluation | Requires ensuring all reads use `PaymentRecord` | MEDIUM |
| **D10** | Enum migration: all-at-once vs. incremental? | Incremental per model | Less risky; targeted rollback possible | MEDIUM |

---

## 17. Normal Neon Status (Read-Only)

```
7 migrations found in prisma/migrations
Database schema is up to date!
Drift: -- This is an empty migration.
```

No Phase-4 fixtures created on Neon. No schema mutations applied.

---

## 18. Reservation Expiry Scheduler

**Phase-2 reservation-expiry scheduler**: `DEFERRED_LAUNCH_INFRASTRUCTURE`

The expiry engine logic exists and is tested. The scheduler (cron/background job) to invoke it has not been deployed. This remains a launch dependency.

**Classification**: `PHASE3_APPLICATION_CODE_COMPLETE` does **NOT** equal `COMMERCIAL_LAUNCH_READY`.

---

## 19. Out-of-Scope for Phase 4

- Product catalog improvements (search, slugs routing, bundles) → Phase 5
- Admin RBAC / multi-admin → Phase 6
- Analytics schema → Phase 7
- Fulfillment / logistics schema → Phase 8
- Distributed rate limiting (Redis) → future
- Email transport infrastructure → launch dependency
- Image storage migration to object storage → future
- Phase 2 reservation expiry scheduler deployment → launch dependency
