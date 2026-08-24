# Phase 2 Unified Commerce Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 2 Packages 3–6: atomic inventory, payment/reconciliation, order-creation integrity, returns, and final integration lock.

**Architecture:** Implement the approved Wave A–F architecture from the authoritative design spec. Database-backed idempotency and conditional mutations enforce correctness; payment, inventory, order, and return responsibilities remain separated while transactional orchestration coordinates cross-domain invariants.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma, PostgreSQL/Neon, Node test runner (`node:test` via `tsx`), Windows PowerShell.

**Spec:** `docs/superpowers/specs/2026-08-24-phase2-unified-commerce-integrity-design.md`

---

## Global Constraints & Implementation Invariants

1. **Decoupled Lifecycles:**
   $$\text{Fulfillment Outcome} \neq \text{Payment Collection} \neq \text{Merchant Settlement} \neq \text{Inventory Restock} \neq \text{Customer Refund}$$
2. **First-Committed DB Reservation Wins:** Inventory entitlement is decided strictly by guarded database mutation at the database engine level (`WHERE stock >= quantity`), never by client timestamps, payment submission order, or optimistic in-memory assertions.
3. **Single Authoritative Evidence Deadline:** `InventoryReservation.evidenceDeadlineAt` is the single source of truth for the 15-minute customer evidence window. Timely submission of evidence locks the payment in `VERIFICATION_PENDING` and protects the reservation until explicit admin review.
4. **No Inventory Revival on Late Payment:** Late customer payments received after an inventory reservation has been released do not reclaim or seize inventory; they transition strictly to `PaymentRecord.state = 'REFUND_REQUIRED'`.
5. **Exact Variant Traceability & Fail-Safe Restocking:** Inventory restorations must target exact database entity IDs (`variantId` / `productId`). `variantLabel` is strictly a human-readable display snapshot and must never be used as a heuristic fallback for stock adjustments. If exact entity identity is missing or orphaned, the system fails closed to manual intervention.
6. **Single Authoritative Payment State:** `PaymentRecord.state` is the sole lifecycle truth for payment and refund status. Refund operational metadata is captured in supporting columns (`refundAmount`, `refundedAt`, etc.) without creating conflicting lifecycle states. COD settlement (`codSettlementState`) is an independent operational lifecycle.
7. **Zero Client Authority:** All prices, stock quantities, delivery fees, settlement states, and payment statuses submitted by client browsers are discarded; calculations and state transitions are strictly server-authoritative.
8. **Public Tracking Privacy:** Sensitive financial data, customer payment sender numbers, transaction IDs, and internal audit notes are strictly excluded from public tracking APIs (`/api/orders?track=1`).
9. **TDD Discipline & Behavioral RED Rule:** A missing module, syntax error, or unhandled import is **NOT** a valid behavioral RED test. For new modules, tests must import a minimal scaffold and assert expected business failure (e.g. status code, stock rejection, state transition refusal) before implementing the production logic.
10. **Migration Approval Checkpoint:** The implementation agent must **never** run `npx prisma migrate deploy` automatically. Before applying migrations to the live database, the agent must stop, display the migration SQL, verify zero destructive drops, and obtain explicit owner approval.
11. **Real PostgreSQL Concurrency Verification:** True concurrency correctness cannot be proven with in-memory transaction spies alone. Concurrency integration tests **must** target a real PostgreSQL database and mandate the presence of `DATABASE_URL_TEST`. If `DATABASE_URL_TEST` is missing, tests must abort immediately and never fall back to `DATABASE_URL`.
12. **Explicit Scope Boundaries:** Customer authentication redesign (Phase 3), customer-facing return portal (Phase 3), `Float` $\to$ `Decimal(12,2)` migration (Phase 4), catalog pagination (Phase 5), and direct payment gateway/courier APIs (Phase 9/10) are strictly out of scope.

---

## Planned File Map

### New Modules & Endpoints to Create:
- `lib/money.ts` — Server-authoritative 2-decimal money rounding and normalization.
- `lib/commerceConstants.ts` — Authoritative business constants (e.g. Bangladesh standard delivery fee ৳120).
- `lib/orderIdentifiers.ts` — 64-bit CSPRNG random order ID generation with 13-character Crockford Base32 encoding and in-transaction retry.
- `lib/inventoryService.ts` — Atomic guarded reservation, cancellation release, fulfillment consumption, and restock execution.
- `lib/paymentService.ts` — Server-authoritative payment state machine, transition validation, and status mapping.
- `lib/inventoryExpiry.ts` — Provider-neutral deadline expiry evaluation and reservation release.
- `app/api/orders/payment-evidence/route.ts` — Two-stage prepaid evidence submission endpoint with anti-replay checks.
- `app/api/orders/returns/route.ts` — Admin return intake logging endpoint.
- `app/api/orders/restock/route.ts` — Admin return inspection disposition and restock execution endpoint.
- `tests/integration/db-safety.ts` — Safety harness ensuring concurrency tests only run against dedicated `DATABASE_URL_TEST`.
- `tests/integration/concurrency-scenarios.test.ts` — Real PostgreSQL concurrency integration test suite.

### Existing Files to Modify:
- `prisma/schema.prisma` — Add `InventoryReservation`, `PaymentRecord`, `PaymentEvidenceAttempt`, `ReturnItem` models and `Order.submissionToken`.
- `app/api/orders/route.ts` — Integrate atomic reservation, two-stage checkout, submission idempotency, strong order IDs, and public tracking privacy serializer.
- `app/api/orders/payment-status/route.ts` — Refactor to use `paymentService`, enforce verifier audit, and block revival of released inventory.
- `app/api/products/route.ts` — Replace variant `deleteMany` with ID-preserving upserts; add active reservation guards to product/variant deletions; decouple generic metadata edits from live stock.
- `app/checkout/page.tsx` — Implement two-stage checkout client flow and `submissionToken` lifecycle.
- `components/admin/PaymentVerificationClient.tsx` — Integrate full payment states, evidence attempt history, and verifier audit display.
- `lib/orderPresentation.ts` — Update presentation helpers to support payment, settlement, and return states safely.

---

## Wave Dependency Strategy & Parallel Execution Matrix

```
Wave A: Schema Foundation (Additive Migration)
  │
  ▼
Wave B: Atomic Commerce Creation & Two-Stage Foundation
  │
  ▼
Wave C: Inventory Lifecycle, Cancellation Release & Catalog Safety
  │
  ├───────────────────────────────────────┐
  ▼                                       ▼
Wave D: Payment, Evidence, Refund, COD   Wave E: Return Domain & Expiry
  │                                       │
  └───────────────────┬───────────────────┘
                      │
                      ▼
Wave F: Full Integration Verification & Phase-2 Lock
```

### Parallel Execution Matrix

| Workstream 1 (Independent) | Workstream 2 (Independent) | Synchronization Barrier |
|---|---|---|
| **Wave D:** Payment State Machine (`lib/paymentService.ts`, `app/api/orders/payment-evidence/route.ts`) | **Wave E:** Expiry & Return Domain (`lib/inventoryExpiry.ts`, `app/api/orders/returns/route.ts`, `app/api/orders/restock/route.ts`) | Must converge before **Wave F** integration testing. |
| **Task 13:** Public Tracking Privacy Serializer | **Task 14:** COD Settlement & Refund Lifecycle | Both depend on Wave D foundations but touch separate concerns. |

> [!WARNING]
> Shared core files (`prisma/schema.prisma`, `app/api/orders/route.ts`, `lib/inventoryService.ts`) must **never** be edited concurrently. Tasks modifying shared files must execute sequentially.

---

## Wave A — Foundation Schema

### Task 1: Additive Schema Foundation

**Wave:** A
**Invariant:** All Phase-2 data structures exist in `prisma/schema.prisma` with correct types, unique constraints, and relations without mutating or deleting existing models.
**Dependencies:** None (Baseline verified).
**Files:**
- Modify: `prisma/schema.prisma`
- Test: `tests/schema-foundation.test.ts`

**Interfaces:**
- Produces: Prisma models `InventoryReservation`, `PaymentRecord`, `PaymentEvidenceAttempt`, `ReturnItem`, and field `Order.submissionToken`.

```prisma
model InventoryReservation {
  id                 Int       @id @default(autoincrement())
  orderItemId        Int       @unique
  orderId            String
  productId          Int
  variantId          Int?
  quantity           Int
  status             String    // RESERVED | RELEASED | FULFILLED
  reservedAt         DateTime  @default(now())
  evidenceDeadlineAt DateTime?
  releasedAt         DateTime?
  releaseReason      String?   // CANCELLED | EVIDENCE_DEADLINE_EXPIRED | REJECTED_PAYMENT | ADMIN_OVERRIDE
  fulfilledAt        DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  orderItem          OrderItem @relation(fields: [orderItemId], references: [id], onDelete: Cascade)

  @@index([orderId])
  @@index([productId])
  @@index([variantId])
  @@index([status])
}

model PaymentRecord {
  id                  Int                      @id @default(autoincrement())
  orderId             String                   @unique
  method              String                   // Cash on Delivery | bKash | Nagad
  state               String                   // AWAITING_PAYMENT | VERIFICATION_PENDING | PAID | REJECTED | FAILED | REFUND_REQUIRED | REFUND_PROCESSING | REFUNDED
  provider            String?                  // bKash | Nagad
  verifiedAt          DateTime?
  verifiedBy          String?
  rejectionNote       String?

  // Refund Metadata
  refundAmount        Float?
  refundRequiredAt    DateTime?
  refundProcessingAt  DateTime?
  refundedAt          DateTime?
  refundNote          String?

  // COD Settlement Domain
  codSettlementState  String?                  // NOT_APPLICABLE | PENDING | SETTLED | DISPUTED
  codSettledAt        DateTime?
  codSettlementNote   String?

  createdAt           DateTime                 @default(now())
  updatedAt           DateTime                 @updatedAt

  order               Order                    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  evidenceAttempts    PaymentEvidenceAttempt[]

  @@index([state])
  @@index([codSettlementState])
}

model PaymentEvidenceAttempt {
  id              Int           @id @default(autoincrement())
  paymentRecordId Int
  provider        String        // bKash | Nagad
  senderNumber    String
  trxId           String
  normalizedTrxId String        // Uppercase, trimmed
  submittedAt     DateTime      @default(now())
  state           String        // PENDING_REVIEW | ACCEPTED | REJECTED | FAILED
  verifiedAt      DateTime?
  verifiedBy      String?
  rejectionNote   String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  paymentRecord   PaymentRecord @relation(fields: [paymentRecordId], references: [id], onDelete: Cascade)

  @@index([paymentRecordId])
  @@index([provider, normalizedTrxId])
}

model ReturnItem {
  id               Int       @id @default(autoincrement())
  orderId          String
  orderItemId      Int
  productId        Int?
  variantId        Int?
  quantity         Int
  disposition      String    // PENDING_INSPECTION | RESTOCKABLE | NON_RESTOCKABLE | DAMAGED
  physicalReturnAt DateTime  @default(now())
  restockedAt      DateTime?
  adminNote        String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  orderItem        OrderItem @relation(fields: [orderItemId], references: [id], onDelete: Cascade)

  @@index([orderId])
  @@index([orderItemId])
  @@index([disposition])
}
```

- [ ] Step 1 — Write behavioral RED test in `tests/schema-foundation.test.ts` verifying Prisma model definitions and properties via TypeScript type assertions.
- [ ] Step 2 — Run `npx tsx --test tests/schema-foundation.test.ts` and verify expected type/property compilation failure.
- [ ] Step 3 — Update `prisma/schema.prisma` with the 4 new models and add `submissionToken String? @unique` to `model Order`.
- [ ] Step 4 — Run `npx prisma generate` to build Prisma client types.
- [ ] Step 5 — Run `npx tsx --test tests/schema-foundation.test.ts` $\to$ PASS.
- [ ] Step 6 — Run `npx tsc --noEmit` and `git diff --check`.
- [ ] Step 7 — Review diff.
- [ ] Step 8 — Commit: `git commit -m "feat(schema): define phase2 foundation models and relations"`

---

### Task 2: Schema Foundation Migration & Checkpoint

**Wave:** A
**Invariant:** Database schema migration is purely additive, verified against live Neon database, and contains the required partial unique index for payment anti-replay.
**Dependencies:** Task 1.
**Files:**
- Create: `prisma/migrations/<timestamp>_phase2_foundation/migration.sql`
- Test: `npx prisma migrate status`, `npx prisma migrate diff`

- [ ] Step 1 — Generate migration SQL using Prisma migrate diff/dev command structure without auto-deploying:
  ```powershell
  $ts = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
  $dir = "prisma/migrations/${ts}_phase2_foundation"
  New-Item -ItemType Directory -Path $dir -Force
  npx prisma migrate diff --from-config-datasource --to-schema=prisma/schema.prisma --script | Out-File -FilePath "$dir/migration.sql" -Encoding utf8
  ```
- [ ] Step 2 — Inspect generated `migration.sql`. Append the PostgreSQL partial unique index for payment evidence anti-replay to `migration.sql`:
  ```sql
  -- Partial Unique Index for Payment Evidence Anti-Replay
  CREATE UNIQUE INDEX "idx_payment_evidence_active_claim"
    ON "PaymentEvidenceAttempt" ("provider", "normalizedTrxId")
    WHERE "state" IN ('PENDING_REVIEW', 'ACCEPTED');
  ```
- [ ] Step 3 — **MIGRATION APPROVAL CHECKPOINT (STOP):** Present migration SQL to owner. Verify zero `DROP TABLE`, zero `DROP COLUMN`, and purely additive `CREATE TABLE` / `ALTER TABLE ADD COLUMN` operations.
- [ ] Step 4 — Upon explicit owner confirmation, apply migration: `npx prisma migrate deploy`.
- [ ] Step 5 — Run `npx prisma migrate status` and `npx prisma migrate diff --from-config-datasource --to-schema=prisma/schema.prisma --script` to verify schema is up to date with zero drift.
- [ ] Step 6 — Review git diff.
- [ ] Step 7 — Commit: `git commit -m "chore(migration): apply phase2 foundation schema migration"`

---

## Wave B — Atomic Commerce Creation

### Task 3: Server-Authoritative Money & Constants

**Wave:** B
**Invariant:** All money operations enforce finite, 2-decimal rounding (`moneyNumber`), and the fixed Bangladesh delivery fee (৳120) is imported from a single authoritative source.
**Dependencies:** Task 2.
**Files:**
- Create: `lib/money.ts`, `lib/commerceConstants.ts`
- Test: `tests/money-integrity.test.ts`

**Interfaces:**
- Produces: `moneyNumber(value: unknown): number`, `DELIVERY_FEE_BDT = 120`, `calculateOrderTotals(items: { price: number; quantity: number }[]): { subtotal: number; deliveryFee: number; total: number }`.

- [ ] Step 1 — Write behavioral RED test in `tests/money-integrity.test.ts` testing float rounding edge cases (e.g. `0.1 + 0.2`, `333.33 * 3`), non-finite inputs, negative numbers, and delivery fee calculation.
- [ ] Step 2 — Run `npx tsx --test tests/money-integrity.test.ts` $\to$ verify expected behavioral failure.
- [ ] Step 3 — Implement `lib/money.ts` and `lib/commerceConstants.ts`.
- [ ] Step 4 — Run `npx tsx --test tests/money-integrity.test.ts` $\to$ PASS.
- [ ] Step 5 — Run `npx tsc --noEmit` and `git diff --check`.
- [ ] Step 6 — Commit: `git commit -m "feat(commerce): add authoritative money normalization and constants"`

---

### Task 4: 64-Bit Cryptographic Order Identifier

**Wave:** B
**Invariant:** Order identifiers match `PH-YYYYMMDD-XXXXXXXXXXXXX` (13 Crockford Base32 characters from 64 CSPRNG bits) and retry up to 5 times upon database unique constraint collisions.
**Dependencies:** Task 2.
**Files:**
- Create: `lib/orderIdentifiers.ts`
- Test: `tests/order-identifier.test.ts`

**Interfaces:**
- Produces: `generateCandidateOrderId(): string`, `encodeCrockfordBase32(buffer: Buffer): string`, `createOrderWithUniqueIdRetry<T>(tx: any, createFn: (orderId: string) => Promise<T>): Promise<T>`.

- [ ] Step 1 — Write behavioral RED test in `tests/order-identifier.test.ts` testing 13-character Crockford Base32 encoding (excludes I, L, O, U), regex pattern `^PH-\d{8}-[0-9A-HJKMNP-TV-Z]{13}$`, and transaction collision retry simulation.
- [ ] Step 2 — Run `npx tsx --test tests/order-identifier.test.ts` $\to$ verify failure.
- [ ] Step 3 — Implement `lib/orderIdentifiers.ts` using `node:crypto` `randomBytes(8)` and Crockford Base32 encoding.
- [ ] Step 4 — Run `npx tsx --test tests/order-identifier.test.ts` $\to$ PASS.
- [ ] Step 5 — Run `npx tsc --noEmit`.
- [ ] Step 6 — Commit: `git commit -m "feat(orders): implement 64-bit crockford base32 order identifier with retry"`

---

### Task 5: Checkout Submission Idempotency

**Wave:** B
**Invariant:** Submitting an order with an existing `submissionToken` returns the original order without creating duplicate database records or re-decrementing stock.
**Dependencies:** Task 3, Task 4.
**Files:**
- Modify: `app/api/orders/route.ts`, `app/checkout/page.tsx`
- Test: `tests/order-submission-idempotency.test.ts`

**Interfaces:**
- Consumes: `Order.submissionToken`.
- Produces: Idempotent POST `/api/orders` handling on `submissionToken` collision.

- [ ] Step 1 — Write behavioral RED test in `tests/order-submission-idempotency.test.ts` simulating duplicate POST requests with identical `submissionToken` returning the existing order payload with HTTP 200.
- [ ] Step 2 — Run `npx tsx --test tests/order-submission-idempotency.test.ts` $\to$ verify failure.
- [ ] Step 3 — In `app/api/orders/route.ts`, extract `submissionToken` from request body; if present, check for existing order or handle unique constraint collision by fetching and returning the existing mapped order.
- [ ] Step 4 — In `app/checkout/page.tsx`, generate a stable `submissionToken` (via `crypto.randomUUID()`) on component mount and send it in the checkout POST payload.
- [ ] Step 5 — Run `npx tsx --test tests/order-submission-idempotency.test.ts` $\to$ PASS.
- [ ] Step 6 — Run `npx tsc --noEmit`.
- [ ] Step 7 — Commit: `git commit -m "feat(checkout): enforce submission idempotency via unique submission token"`

---

### Task 6: Atomic Guarded Stock Allocation & Two-Stage Foundation

**Wave:** B
**Invariant:** Stock reservation executes via atomic conditional updates (`WHERE stock >= qty`); all order items, `InventoryReservation` rows, and initial `PaymentRecord` (`AWAITING_PAYMENT`) are committed atomically or rolled back completely on any stockout.
**Dependencies:** Task 3, Task 4, Task 5.
**Files:**
- Create: `lib/inventoryService.ts`
- Modify: `app/api/orders/route.ts`
- Test: `tests/atomic-inventory-reservation.test.ts`

**Interfaces:**
- Produces: `inventoryService.reserveOrderInventory(tx: PrismaTx, params: ReserveOrderParams): Promise<InventoryReservation[]>`.

```typescript
// Transaction Execution Sequence:
// 1. Validate & normalize items using lib/money.ts
// 2. Execute tx.order.create (creates Order and OrderItem records)
// 3. For each OrderItem:
//    - If non-variant: tx.product.updateMany({ where: { id: productId, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } })
//    - If variant: tx.productVariant.updateMany({ where: { id: variantId, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } })
//      AND tx.product.update({ where: { id: productId }, data: { stock: { decrement: quantity } } })
//    - If any updateMany returns count === 0: throw InsufficientStockError
//    - tx.inventoryReservation.create({ data: { orderItemId, orderId, productId, variantId, quantity, status: "RESERVED", evidenceDeadlineAt: isPrepaid ? now + 15m : null } })
// 4. tx.paymentRecord.create({ data: { orderId, method, state: "AWAITING_PAYMENT", provider: isPrepaid ? provider : null, codSettlementState: isCod ? "NOT_APPLICABLE" : null } })
```

- [ ] Step 1 — Write behavioral RED test in `tests/atomic-inventory-reservation.test.ts` verifying:
  - Guarded update rejection when stock is insufficient (returning HTTP 409 `INSUFFICIENT_STOCK`).
  - Variant stock and product aggregate stock both decrement on success.
  - Multi-item partial stockout causes full rollback with 0 reservations created.
  - `PaymentRecord` created in `AWAITING_PAYMENT` with 15-minute `evidenceDeadlineAt` on `InventoryReservation` for prepaid orders.
- [ ] Step 2 — Run `npx tsx --test tests/atomic-inventory-reservation.test.ts` $\to$ verify expected failure.
- [ ] Step 3 — Implement `lib/inventoryService.ts` (`reserveOrderInventory`).
- [ ] Step 4 — Refactor `POST /api/orders` to execute the atomic reservation pipeline inside `prisma.$transaction`.
- [ ] Step 5 — Run `npx tsx --test tests/atomic-inventory-reservation.test.ts` $\to$ PASS.
- [ ] Step 6 — Run existing regression: `npx tsx --test tests/order-item-variant-persistence.test.ts`.
- [ ] Step 7 — Run `npx tsc --noEmit` and `git diff --check`.
- [ ] Step 8 — Commit: `git commit -m "feat(inventory): implement atomic guarded stock reservation and two-stage checkout foundation"`

---

## Wave C — Inventory Lifecycle + Catalog Safety

### Task 7: Idempotent Cancellation Release & Variant Restock

**Wave:** C
**Invariant:** Order cancellation releases reserved stock exactly once via atomic reservation status transition (`RESERVED` $\to$ `RELEASED`), restoring both variant stock and product aggregate without heuristic guessing.
**Dependencies:** Task 6.
**Files:**
- Modify: `lib/inventoryService.ts`, `app/api/orders/route.ts`
- Test: `tests/inventory-cancellation-release.test.ts`

**Interfaces:**
- Produces: `inventoryService.releaseOrderReservation(tx: PrismaTx, orderId: string, reason: string): Promise<ReleaseResult>`.

- [ ] Step 1 — Write behavioral RED test in `tests/inventory-cancellation-release.test.ts` verifying:
  - Cancelling an order in `PENDING`/`CONFIRMED`/`PROCESSING` restores variant stock and product aggregate.
  - Repeated cancellation calls on an already `RELEASED` reservation are strict no-ops.
  - Legacy orders with `variantId = null` safely restore only `Product.stock` without failing or guessing variant targets.
- [ ] Step 2 — Run `npx tsx --test tests/inventory-cancellation-release.test.ts` $\to$ verify expected failure.
- [ ] Step 3 — Implement `inventoryService.releaseOrderReservation` using conditional update:
  ```sql
  UPDATE "InventoryReservation"
  SET "status" = 'RELEASED', "releasedAt" = NOW(), "releaseReason" = $reason
  WHERE "orderId" = $orderId AND "status" = 'RESERVED';
  ```
  Only if reservations are updated, increment corresponding `ProductVariant.stock` and `Product.stock`.
- [ ] Step 4 — Update `PUT /api/orders` cancellation handler to invoke `inventoryService.releaseOrderReservation`.
- [ ] Step 5 — Run `npx tsx --test tests/inventory-cancellation-release.test.ts` $\to$ PASS.
- [ ] Step 6 — Run regression: `npx tsx --test tests/order-status-transition-api.test.ts`.
- [ ] Step 7 — Commit: `git commit -m "feat(inventory): enforce idempotent exactly-once cancellation stock release"`

---

### Task 8: Reservation Fulfillment Boundary at SHIPPED

**Wave:** C
**Invariant:** Transitioning an order to `SHIPPED` transitions active `InventoryReservation` rows to `FULFILLED` (`fulfilledAt = NOW()`), permanently consuming sellable inventory and locking standard cancellation.
**Dependencies:** Task 7.
**Files:**
- Modify: `lib/inventoryService.ts`, `app/api/orders/route.ts`
- Test: `tests/inventory-fulfillment-boundary.test.ts`

**Interfaces:**
- Produces: `inventoryService.fulfillOrderReservation(tx: PrismaTx, orderId: string): Promise<void>`.

- [ ] Step 1 — Write behavioral RED test in `tests/inventory-fulfillment-boundary.test.ts` verifying that `PUT /api/orders` transitioning status to `shipped` marks all reservations `FULFILLED` and subsequent cancellation attempts return HTTP 409.
- [ ] Step 2 — Run `npx tsx --test tests/inventory-fulfillment-boundary.test.ts` $\to$ verify failure.
- [ ] Step 3 — Implement `inventoryService.fulfillOrderReservation` and integrate into `PUT /api/orders` when target status is `shipped`.
- [ ] Step 4 — Run `npx tsx --test tests/inventory-fulfillment-boundary.test.ts` $\to$ PASS.
- [ ] Step 5 — Run `npx tsc --noEmit`.
- [ ] Step 6 — Commit: `git commit -m "feat(inventory): fulfill inventory reservations upon courier shipment"`

---

### Task 9: Fail-Closed Order Deletion & Catalog Mutation Safety

**Wave:** C
**Invariant:** Admin hard-deletion of non-terminal orders is rejected (HTTP 409); product/variant updates preserve IDs and ignore form-level stock snapshots; product/variant deletions are blocked if active `RESERVED` reservations exist.
**Dependencies:** Task 7.
**Files:**
- Modify: `app/api/orders/route.ts`, `app/api/products/route.ts`
- Test: `tests/catalog-deletion-safety.test.ts`

- [ ] Step 1 — Write behavioral RED test in `tests/catalog-deletion-safety.test.ts` testing:
  - `DELETE /api/orders` rejects non-terminal orders (`pending`, `confirmed`, `processing`, etc.) with HTTP 409.
  - `PUT /api/products` updates existing variants by ID without invoking `deleteMany: {}` and does not overwrite live stock with stale form values.
  - `DELETE /api/products` and variant deletion are rejected (HTTP 409) when active `RESERVED` reservations exist.
- [ ] Step 2 — Run `npx tsx --test tests/catalog-deletion-safety.test.ts` $\to$ verify failure.
- [ ] Step 3 — In `app/api/orders/route.ts`, update `DELETE` handler to check `order.status` and fail closed for non-terminal statuses.
- [ ] Step 4 — In `app/api/products/route.ts`:
  - Replace `variants: { deleteMany: {}, create: ... }` with identity-preserving upsert logic.
  - Add pre-delete check querying `InventoryReservation` where `productId === id AND status === 'RESERVED'`.
  - Exclude form-level stock fields from generic product metadata updates.
- [ ] Step 5 — Run `npx tsx --test tests/catalog-deletion-safety.test.ts` $\to$ PASS.
- [ ] Step 6 — Run `npx tsc --noEmit`.
- [ ] Step 7 — Commit: `git commit -m "feat(catalog): secure product and variant mutation and fail-closed order deletion"`

---

## Wave D — Payment / Evidence / Refund / COD Settlement

### Task 10: Server-Authoritative Payment Service

**Wave:** D
**Invariant:** `PaymentRecord.state` is the single authoritative payment lifecycle state, strictly validating allowed transitions across `AWAITING_PAYMENT`, `VERIFICATION_PENDING`, `PAID`, `REJECTED`, `FAILED`, `REFUND_REQUIRED`, `REFUND_PROCESSING`, and `REFUNDED`.
**Dependencies:** Task 2, Task 6.
**Files:**
- Create: `lib/paymentService.ts`
- Test: `tests/payment-state-machine.test.ts`

**Interfaces:**
- Produces: `paymentService.validatePaymentTransition(currentState: string, targetState: string): { allowed: boolean; reason?: string }`, `paymentService.mapLegacyPaymentStatus(status: string): string`.

- [ ] Step 1 — Write behavioral RED test in `tests/payment-state-machine.test.ts` validating the full payment transition graph, rejection of illegal jumps (e.g. `AWAITING_PAYMENT` $\to$ `PAID` directly for prepaid without verification), and legacy status mapping (`"verified"` $\to$ `"PAID"`).
- [ ] Step 2 — Run `npx tsx --test tests/payment-state-machine.test.ts` $\to$ verify failure.
- [ ] Step 3 — Implement `lib/paymentService.ts` with the canonical transition matrix and validation helpers.
- [ ] Step 4 — Run `npx tsx --test tests/payment-state-machine.test.ts` $\to$ PASS.
- [ ] Step 5 — Run `npx tsc --noEmit`.
- [ ] Step 6 — Commit: `git commit -m "feat(payments): implement server-authoritative payment state machine"`

---

### Task 11: Two-Stage Payment Evidence Submission & Anti-Replay

**Wave:** D
**Invariant:** Customers submit prepaid evidence via `POST /api/orders/payment-evidence`; submissions are validated against `InventoryReservation.evidenceDeadlineAt`; `(provider, normalizedTrxId)` active claims prevent transaction replay.
**Dependencies:** Task 10.
**Files:**
- Create: `app/api/orders/payment-evidence/route.ts`
- Test: `tests/payment-evidence-submission.test.ts`

**Interfaces:**
- Produces: `POST /api/orders/payment-evidence` endpoint accepting `{ orderId, customerPhone, provider, senderNumber, trxId, submissionToken? }`.

- [ ] Step 1 — Write behavioral RED test in `tests/payment-evidence-submission.test.ts` testing:
  - Timely submission (`submittedAt <= evidenceDeadlineAt`) transitions `PaymentRecord.state` to `VERIFICATION_PENDING` and creates `PaymentEvidenceAttempt`.
  - Submission after deadline on a released reservation is rejected or flagged for refund handling.
  - Submitting a duplicate `(provider, trxId)` already active/accepted on another order returns HTTP 409.
  - Customer authorization requires matching `orderId` and `customerPhone`.
  - Resubmission within original window after a `REJECTED` attempt succeeds without resetting the original deadline.
- [ ] Step 2 — Run `npx tsx --test tests/payment-evidence-submission.test.ts` $\to$ verify failure.
- [ ] Step 3 — Implement `app/api/orders/payment-evidence/route.ts` with transaction-level anti-replay validation and `PaymentEvidenceAttempt` creation.
- [ ] Step 4 — Run `npx tsx --test tests/payment-evidence-submission.test.ts` $\to$ PASS.
- [ ] Step 5 — Run `npx tsc --noEmit`.
- [ ] Step 6 — Commit: `git commit -m "feat(payments): add payment evidence submission endpoint with anti-replay protection"`

---

### Task 12: Admin Payment Verification & Reconciliation

**Wave:** D
**Invariant:** Admin payment verification requires admin authentication, records `verifiedAt` and `verifiedBy`, gates order confirmation behind `PAID` for prepaid orders, and blocks revival of released inventory.
**Dependencies:** Task 10, Task 11.
**Files:**
- Modify: `app/api/orders/payment-status/route.ts`, `components/admin/PaymentVerificationClient.tsx`
- Test: `tests/admin-payment-verification.test.ts`

- [ ] Step 1 — Write behavioral RED test in `tests/admin-payment-verification.test.ts` testing:
  - Admin marking payment `PAID` updates `PaymentRecord` and marks corresponding `PaymentEvidenceAttempt` as `ACCEPTED`.
  - Attempting to mark a cancelled/expired order's payment as `PAID` transitions payment to `REFUND_REQUIRED` without reviving inventory.
  - Marking payment `REJECTED` within the evidence window allows customer resubmission; marking `REJECTED` past deadline triggers order cancellation.
  - Prepaid orders reject `PUT /api/orders` status $\to$ `confirmed` if `PaymentRecord.state !== 'PAID'`.
- [ ] Step 2 — Run `npx tsx --test tests/admin-payment-verification.test.ts` $\to$ verify failure.
- [ ] Step 3 — Refactor `app/api/orders/payment-status/route.ts` to use `paymentService` and update `PaymentEvidenceAttempt` records.
- [ ] Step 4 — In `app/api/orders/route.ts`, update `PUT` transition checks to gate `confirmed` behind `PaymentRecord.state === 'PAID'` for prepaid methods.
- [ ] Step 5 — Update `components/admin/PaymentVerificationClient.tsx` to display verification timestamps, admin notes, and full status options.
- [ ] Step 6 — Run `npx tsx --test tests/admin-payment-verification.test.ts` $\to$ PASS.
- [ ] Step 7 — Run regression: `npx tsx --test tests/payment-verification-data-mapping.test.ts`.
- [ ] Step 8 — Commit: `git commit -m "feat(payments): harden admin payment verification and fulfillment gating"`

---

### Task 13: Public Tracking Privacy Boundary

**Wave:** D
**Invariant:** Public tracking endpoint `/api/orders?track=1` strictly omits `paymentSenderNumber`, `paymentTrxId`, `PaymentEvidenceAttempt` rows, internal verifier identity, and refund/settlement notes.
**Dependencies:** Task 10.
**Files:**
- Modify: `app/api/orders/route.ts`, `lib/orderPresentation.ts`
- Test: `tests/public-tracking-privacy.test.ts`

- [ ] Step 1 — Write behavioral RED test in `tests/public-tracking-privacy.test.ts` asserting that public tracking GET responses contain zero sender numbers, transaction IDs, verifier identities, or operational notes, while admin GET responses retain full operational data.
- [ ] Step 2 — Run `npx tsx --test tests/public-tracking-privacy.test.ts` $\to$ verify failure.
- [ ] Step 3 — Implement explicit `mapPublicTrackingOrder(order)` and `mapAdminOrder(order)` serializers in `app/api/orders/route.ts`.
- [ ] Step 4 — Run `npx tsx --test tests/public-tracking-privacy.test.ts` $\to$ PASS.
- [ ] Step 5 — Run `npx tsc --noEmit`.
- [ ] Step 6 — Commit: `git commit -m "feat(privacy): enforce strict public tracking privacy boundary"`

---

### Task 14: COD Collection, Settlement & Refund Lifecycle

**Wave:** D
**Invariant:** COD delivery sets `PaymentRecord.state = 'PAID'` and `codSettlementState = 'PENDING'`; admin settlement transitions to `SETTLED` or `DISPUTED`; refund executions transition `PaymentRecord.state` to `REFUNDED` with zero inventory side effects.
**Dependencies:** Task 10, Task 12.
**Files:**
- Modify: `app/api/orders/payment-status/route.ts`, `app/api/orders/route.ts`
- Test: `tests/cod-settlement-and-refund.test.ts`

- [ ] Step 1 — Write behavioral RED test in `tests/cod-settlement-and-refund.test.ts` verifying:
  - Transitioning COD order to `delivered` leaves `codSettlementState` as `PENDING`.
  - Admin can update `codSettlementState` to `SETTLED` (recording `codSettledAt`) or `DISPUTED`.
  - Transitioning payment state to `REFUNDED` records `refundedAt` and does not increment stock.
- [ ] Step 2 — Run `npx tsx --test tests/cod-settlement-and-refund.test.ts` $\to$ verify failure.
- [ ] Step 3 — Update `app/api/orders/route.ts` (`PUT`) and `app/api/orders/payment-status/route.ts` (`PATCH`) to handle COD settlement and refund transitions.
- [ ] Step 4 — Run `npx tsx --test tests/cod-settlement-and-refund.test.ts` $\to$ PASS.
- [ ] Step 5 — Run `npx tsc --noEmit`.
- [ ] Step 6 — Commit: `git commit -m "feat(finance): implement cod settlement decoupling and refund lifecycle"`

---

## Wave E — Return + Expiry Integration

### Task 15: Automated & Operational Evidence Expiry Release

**Wave:** E
**Invariant:** Prepaid orders past `InventoryReservation.evidenceDeadlineAt` without timely evidence submission are released (`releaseReason = 'EVIDENCE_DEADLINE_EXPIRED'`) and cancelled without disturbing orders protected by `VERIFICATION_PENDING`.
**Dependencies:** Task 7, Task 11.
**Files:**
- Create: `lib/inventoryExpiry.ts`
- Test: `tests/prepaid-evidence-expiry.test.ts`

**Interfaces:**
- Produces: `inventoryExpiry.releaseExpiredReservations(now?: Date): Promise<{ releasedCount: number; orderIds: string[] }>`.

- [ ] Step 1 — Write behavioral RED test in `tests/prepaid-evidence-expiry.test.ts` verifying:
  - Unpaid orders past 15 minutes have reservations released and orders cancelled.
  - Orders in `VERIFICATION_PENDING` past 15 minutes are preserved and **not** released.
  - Expired reservations cannot be revived by subsequent late payment attempts.
- [ ] Step 2 — Run `npx tsx --test tests/prepaid-evidence-expiry.test.ts` $\to$ verify failure.
- [ ] Step 3 — Implement `lib/inventoryExpiry.ts` querying `InventoryReservation` where `status === 'RESERVED' AND evidenceDeadlineAt < now` and checking parent `PaymentRecord.state === 'AWAITING_PAYMENT'` before calling `inventoryService.releaseOrderReservation`.
- [ ] Step 4 — Run `npx tsx --test tests/prepaid-evidence-expiry.test.ts` $\to$ PASS.
- [ ] Step 5 — Run `npx tsc --noEmit`.
- [ ] Step 6 — Commit: `git commit -m "feat(expiry): implement provider-neutral prepaid reservation expiry engine"`

---

### Task 16: ReturnItem Domain & Inspection Restock

**Wave:** E
**Invariant:** Physical return intake creates `ReturnItem` in `PENDING_INSPECTION`; post-delivery returns leave `Order.status` as `DELIVERED`; restock executes exactly once upon admin `RESTOCKABLE` disposition with exact variant destination.
**Dependencies:** Task 7, Task 8.
**Files:**
- Create: `app/api/orders/returns/route.ts`, `app/api/orders/restock/route.ts`
- Modify: `lib/inventoryService.ts`, `app/api/orders/route.ts`
- Test: `tests/return-item-restock.test.ts`

**Interfaces:**
- Produces: `POST /api/orders/returns` (create return intake), `POST /api/orders/restock` (admin disposition & restock execution).
- Validation: $0 < \text{returnedQuantity} \le \text{purchasedQuantity}$.

- [ ] Step 1 — Write behavioral RED test in `tests/return-item-restock.test.ts` verifying:
  - `RETURN_RECEIVED` on undelivered orders auto-creates `ReturnItem` in `PENDING_INSPECTION` with 0 stock increment.
  - Post-delivery return creation logs `ReturnItem` while `Order.status` remains `DELIVERED`.
  - Admin setting disposition to `RESTOCKABLE` triggers exactly-once stock increment (populating `restockedAt`).
  - Admin setting disposition to `NON_RESTOCKABLE` or `DAMAGED` blocks stock restoration.
  - Repeated restock calls on an already restocked `ReturnItem` return no-op without double-incrementing stock.
- [ ] Step 2 — Run `npx tsx --test tests/return-item-restock.test.ts` $\to$ verify failure.
- [ ] Step 3 — Implement `app/api/orders/returns/route.ts` and `app/api/orders/restock/route.ts`.
- [ ] Step 4 — Implement `inventoryService.restockReturnItem` with conditional update guard on `restockedAt IS NULL AND disposition = 'RESTOCKABLE'`.
- [ ] Step 5 — Run `npx tsx --test tests/return-item-restock.test.ts` $\to$ PASS.
- [ ] Step 6 — Run `npx tsc --noEmit`.
- [ ] Step 7 — Commit: `git commit -m "feat(returns): implement return item domain with inspected exactly-once restocking"`

---

## Wave F — Full Phase-2 Integration Lock

### Task 17: Real PostgreSQL Concurrency Test Suite

**Wave:** F
**Invariant:** Real database concurrency harness executes against dedicated `DATABASE_URL_TEST` proving race-free stock allocation, double-cancellation resilience, submission token uniqueness, and payment anti-replay.
**Dependencies:** Tasks 1–16.
**Files:**
- Create: `tests/integration/db-safety.ts`, `tests/integration/concurrency-scenarios.test.ts`
- Test: `tests/integration/concurrency-scenarios.test.ts`

- [ ] Step 1 — Implement `tests/integration/db-safety.ts` verifying `DATABASE_URL_TEST` is defined, distinct from `DATABASE_URL`, and configuring isolated run prefixes with cleanup in `finally` blocks.
- [ ] Step 2 — Implement real PostgreSQL concurrency test suite in `tests/integration/concurrency-scenarios.test.ts`:
  1. Final-unit overselling race: 10 concurrent requests for 1 stock unit $\to$ exactly 1 success, stock = 0.
  2. Concurrent double-cancellation: 2 concurrent cancel requests $\to$ stock restored exactly once.
  3. Duplicate submission token: 2 simultaneous checkouts $\to$ exactly 1 order row created.
  4. Concurrent payment evidence replay: 2 orders claiming same `(provider, trxId)` $\to$ exactly 1 accepted.
- [ ] Step 3 — Run real-DB integration test suite:
  ```powershell
  $env:DATABASE_URL_TEST = "<neon_test_branch_or_docker_url>"
  npx tsx --test tests/integration/concurrency-scenarios.test.ts
  ```
  *(Must pass 100%).*
- [ ] Step 4 — Commit: `git commit -m "test(integration): verify commerce concurrency invariants on real postgresql database"`

---

### Task 18: Full Regression, Security & Phase-2 Lock

**Wave:** F
**Invariant:** Complete Phase 1 security suite (60 tests), all Phase 2 domain suites, and schema drift checks pass 100% with zero regressions.
**Dependencies:** Task 17.
**Files:**
- Test: All test suites in `tests/`

- [ ] Step 1 — Run complete Phase 1 security regression suite:
  ```powershell
  npx tsx --test tests/admin-auth-security.test.ts tests/admin-auth-rate-limit.test.ts tests/admin-session-secret-security.test.ts tests/orders-rate-limit.test.ts tests/rate-limiter.test.ts tests/rate-limit-policy.test.ts
  ```
- [ ] Step 2 — Run complete Phase 2 unit and handler regression suites:
  ```powershell
  npx tsx --test tests/schema-foundation.test.ts tests/money-integrity.test.ts tests/order-identifier.test.ts tests/order-submission-idempotency.test.ts tests/atomic-inventory-reservation.test.ts tests/inventory-cancellation-release.test.ts tests/inventory-fulfillment-boundary.test.ts tests/catalog-deletion-safety.test.ts tests/payment-state-machine.test.ts tests/payment-evidence-submission.test.ts tests/admin-payment-verification.test.ts tests/public-tracking-privacy.test.ts tests/cod-settlement-and-refund.test.ts tests/prepaid-evidence-expiry.test.ts tests/return-item-restock.test.ts tests/order-item-variant-persistence.test.ts tests/order-state-machine.test.ts tests/order-status-transition-api.test.ts tests/order-ui-compatibility.test.ts tests/payment-verification-data-mapping.test.ts
  ```
- [ ] Step 3 — Run TypeScript compilation check:
  ```powershell
  npx tsc --noEmit
  ```
- [ ] Step 4 — Run Prisma schema drift check:
  ```powershell
  npx prisma migrate status
  npx prisma migrate diff --from-config-datasource --to-schema=prisma/schema.prisma --script
  ```
  *(Must report schema up to date and empty migration drift).*
- [ ] Step 5 — Run git whitespace and hygiene check:
  ```powershell
  git diff --check
  git status --short
  ```
- [ ] Step 6 — Commit: `git commit -m "chore(phase2): complete full regression verification and lock phase-2 packages 3-6"`

---

## Rollback & Failure Recovery Procedures

| Wave | Failure Scenario | Recovery Procedure |
|---|---|---|
| **Wave A** | Migration fails or schema drift detected | Do not deploy to production. Revert `prisma/schema.prisma`, delete migration directory, run `npx prisma generate`. If applied to dev Neon, drop new unreferenced tables manually. |
| **Wave B** | Stock reservation race or calculation error | Revert Wave B commits locally via `git revert`. Database tables remain empty/additive without data loss. |
| **Wave C** | Cancellation release fails to restore variant stock | Targeted fix in `lib/inventoryService.ts`. No schema changes involved. |
| **Wave D** | Payment anti-replay rejects legitimate resubmission | Update partial unique index condition in migration script; re-run `tests/payment-evidence-submission.test.ts`. |
| **Wave E** | Expiry releases timely evidence order | Fix query in `lib/inventoryExpiry.ts` to ensure `VERIFICATION_PENDING` check precedes release. |
| **Wave F** | Concurrency test failure on real DB | Inspect PostgreSQL lock behavior and transaction isolation in `lib/inventoryService.ts`. Fix before Phase 2 lock. |

---

## Definition of Phase-2 Completion

Phase 2 Packages 3–6 are formally certified **COMPLETE & LOCKED** when:
1. All 18 implementation tasks are completed with clean commit history.
2. All unit, handler, and real-DB concurrency integration tests pass 100%.
3. Full Phase-1 60-test security regression suite passes with zero failures.
4. `npx prisma migrate status` and `npx prisma migrate diff` confirm zero schema drift against live PostgreSQL.
5. `npx tsc --noEmit` and `git diff --check` return clean zero-exit codes.
6. The final Phase-2 lock commit is approved by the project owner.
