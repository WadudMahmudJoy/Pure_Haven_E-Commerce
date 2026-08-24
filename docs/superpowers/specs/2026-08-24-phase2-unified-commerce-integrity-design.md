# Phase 2 — Unified Commerce Integrity Design Specification
## Packages 3, 4, 5, and 6

- **Document ID:** `PH2-SPEC-UNIFIED-20260824`
- **Status:** APPROVED & LOCKED
- **Creation Date:** 2026-08-24
- **Last Amended:** 2026-08-25 (Consistency Review & Entropy Refinement)
- **Baseline Commit:** `9ce9f1ef787e013d8416ff69d7d88fbaa01a7246`
- **Scope:** Complete Architectural Specification for Remaining Phase 2 Deliverables:
  - **Package 3:** Inventory Integrity (Atomic Allocation, Reservation Lifecycle, Variant Restocking, Catalog Protection)
  - **Package 4:** Payment Workflow & Reconciliation (Two-Stage Checkout, Evidence Attempts, Single State Machine, COD Settlement, Refunds, Privacy)
  - **Package 5:** Money & Order Identifier Integrity (Normalized Money Policy, 64-bit Random Order IDs with Crockford Base32, Submission Idempotency)
  - **Package 6:** Integration Verification & Phase-2 Lock (Real-DB Concurrency Harness, Matrix Verification, Security Regression)
- **Document Type:** Canonical Architecture & Design Specification

---

## 1. Executive Summary & Foundational Invariants

This design specification establishes the authoritative architecture for the remaining packages of **Phase 2 (Order, Payment, and Inventory Integrity)**. It unifies the inventory reservation model, multi-attempt payment evidence tracking, money calculation standards, collision-proof order identification, and real-database concurrency verification into a single cohesive system.

### 1.1 Core Immutable Invariants
1. **Decoupled Lifecycles:**
   $$\text{Fulfillment Outcome} \neq \text{Payment Collection} \neq \text{Merchant Settlement} \neq \text{Inventory Restock} \neq \text{Customer Refund}$$
2. **First-Committed DB Reservation Wins:** Inventory entitlement is decided strictly by guarded database mutation at the database engine level, never by client timestamps, payment submission order, or optimistic in-memory assertions.
3. **Single Authoritative Evidence Deadline:** `InventoryReservation.evidenceDeadlineAt` is the single source of truth for the 15-minute customer evidence window. Timely submission of evidence locks the payment in `VERIFICATION_PENDING` and protects the reservation until explicit admin review.
4. **No Inventory Revival on Late Payment:** Late customer payments received after an inventory reservation has been released do not reclaim or seize inventory; they transition strictly to `PaymentRecord.state = 'REFUND_REQUIRED'`.
5. **Exact Variant Traceability & Fail-Safe Restocking:** Inventory restorations must target exact database entity IDs (`variantId` / `productId`). `variantLabel` is strictly a human-readable display snapshot and must never be used as a heuristic fallback for stock adjustments. If exact entity identity is missing or orphaned, the system fails closed to manual intervention.
6. **Single Authoritative Payment State:** `PaymentRecord.state` is the sole lifecycle truth for payment and refund status. Refund operational metadata is captured in supporting columns without creating conflicting lifecycle states.
7. **Zero Client Authority:** All prices, stock quantities, delivery fees, settlement states, and payment statuses submitted by client browsers are discarded; calculations and state transitions are strictly server-authoritative.
8. **Public Tracking Privacy:** Sensitive financial data, customer payment sender numbers, transaction IDs, and internal audit notes are strictly excluded from public tracking APIs.

---

## 2. Inventory Architecture: Dedicated `InventoryReservation` Engine

### 2.1 Model Architecture (Refined Option B)
Inventory entitlement is decoupled from raw order line item rows through a dedicated `InventoryReservation` model. An `InventoryReservation` represents the durable, auditable hold of physical or sellable stock for a specific `OrderItem`.

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
```

### 2.2 Reservation State Machine
The lifecycle of an `InventoryReservation` consists of three mutually exclusive, active or terminal states:

```
                  ┌──────────────┐
                  │   RESERVED   │
                  └──────┬───────┘
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
  ┌──────────────┐                ┌──────────────┐
  │   RELEASED   │                │  FULFILLED   │
  └──────────────┘                └──────────────┘
```

1. **`RESERVED` (Active):** Created atomically upon order creation. Stock has been decremented from sellable inventory.
2. **`RELEASED` (Terminal):** The order was cancelled prior to dispatch, or the prepaid evidence window expired without valid payment (`releaseReason = 'EVIDENCE_DEADLINE_EXPIRED'`). Reserved stock is incremented back to sellable inventory exactly once.
3. **`FULFILLED` (Terminal):** The parcel has been physically handed over to the courier partner (`SHIPPED`). The reservation is permanently consumed.

> [!IMPORTANT]
> Neither `RESTORED` nor `EXPIRED` are primary `InventoryReservation` lifecycle states. Expiry is represented as `RELEASED` with `releaseReason = 'EVIDENCE_DEADLINE_EXPIRED'`. Post-delivery returns are physical inventory intake events governed by the `ReturnItem` domain and do not alter historical reservation records.

---

## 3. Atomic Allocation & Concurrency Control

### 3.1 Guarded Database Mutations
To eliminate read-then-decrement race conditions under PostgreSQL Read Committed transaction isolation, all inventory reservations must use atomic, conditional database updates.

#### Non-Variant Product:
```sql
UPDATE "Product"
SET "stock" = "stock" - $quantity,
    "updatedAt" = NOW()
WHERE "id" = $productId
  AND "stock" >= $quantity;
```

#### Variant Product:
```sql
-- 1. Atomically guard and decrement specific variant authority
UPDATE "ProductVariant"
SET "stock" = "stock" - $quantity,
    "updatedAt" = NOW()
WHERE "id" = $variantId
  AND "stock" >= $quantity;

-- 2. Decrement product-level aggregate mirror in the same transaction
UPDATE "Product"
SET "stock" = "stock" - $quantity,
    "updatedAt" = NOW()
WHERE "id" = $productId;
```

### 3.2 Multi-Item Order Atomicity
All line items in an order must be evaluated and reserved within a single database transaction (`prisma.$transaction`).
- If any line item fails its guarded decrement (insufficient stock), the transaction immediately aborts, all prior decrements in the transaction roll back, and an HTTP `409 Conflict` (or `400 Bad Request`) is returned.
- No partial reservations are permitted.

---

## 4. Catalog Stock Source of Truth

The hierarchy of inventory authority is locked as follows:

| Product Configuration | Authoritative Stock Source | Aggregate / Display Mirror | Policy |
|---|---|---|---|
| **Non-Variant Product** | `Product.stock` | `Product.stock` | Single source of truth for checkout validation, catalog display, and admin editing. |
| **Variant Product** | `ProductVariant.stock` | `Product.stock` | `ProductVariant.stock` is the sole authority deciding if a variant can be purchased. `Product.stock` is a maintained aggregate sum ($\sum \text{variant.stock}$) for cached catalog queries and low-stock alerts. |

---

## 5. Catalog Mutation & Product Edit Safety

### 5.1 Elimination of Destructive Variant Re-creation
The legacy pattern (`deleteMany: {}, create: variants`) in `PUT /api/products` is strictly prohibited. Variant updates must follow identity-preserving reconciliation:
1. **Existing Variants:** Matched by `id`. Update `label`, `price`, `image`, and `sortOrder`.
2. **New Variants:** Rows without `id` are created with new auto-increment IDs.
3. **Removed Variants:** Deletion is permitted **only if** no active `InventoryReservation` (`status = 'RESERVED'`) references that `variantId`. If active reservations exist, variant deletion is rejected with HTTP `409 Conflict`.

### 5.2 Decoupling Product Metadata Edits from Stock Adjustments
- Generic product metadata updates (title, description, category, images, sort order) must **never** overwrite live variant or product stock using stale form snapshots. Form-level stock inputs in generic catalog editing forms are ignored on update.
- Stock adjustments are separate, explicit, server-authoritative operations executed through dedicated inventory adjustment endpoints or auditable delta mutations.

### 5.3 Product Deletion Guard
Hard deletion of a `Product` via `DELETE /api/products` is blocked (HTTP `409 Conflict`) if any `InventoryReservation` in `RESERVED` status references that `productId`.

---

## 6. Order Lifecycle & Fulfillment Boundary

### 6.1 Server-Authoritative Fulfillment Graph
The fulfillment state graph established in Package 2 remains authoritative:

```
PENDING
  ↓
CONFIRMED (Prepaid requires PaymentRecord.state = PAID)
  ↓
PROCESSING
  ↓
SHIPPED ─── [InventoryReservation -> FULFILLED] ─── (Normal Cancellation Forbidden)
  ↓
OUT_FOR_DELIVERY
  ├──► DELIVERED (Final Successful Fulfillment Outcome)
  └──► DELIVERY_FAILED (Courier undelivered flow)
         ↓
       RETURN_IN_TRANSIT
         ↓
       RETURN_RECEIVED (Physical Warehouse Intake -> ReturnItem Assessment)
```

### 6.2 Distinction Between Undelivered Returns and Post-Delivery Returns
The system clearly differentiates two operational return paths:
1. **Case A: Failed Delivery (Undelivered) Return:**
   - The parcel was never accepted by the customer.
   - Lifecycle progression: `OUT_FOR_DELIVERY` $\to$ `DELIVERY_FAILED` $\to$ `RETURN_IN_TRANSIT` $\to$ `RETURN_RECEIVED`.
   - `Order.status` reflects `RETURN_RECEIVED`.
2. **Case B: Post-Delivery Customer Return:**
   - The parcel was successfully delivered (`Order.status = 'DELIVERED'`).
   - `Order.status` remains **immutably** `DELIVERED`. It is **never** mutated back to `RETURN_RECEIVED`.
   - The post-delivery return is tracked as an attached child workflow via the `ReturnItem` domain.

### 6.3 Reservation Fulfillment Boundary at `SHIPPED`
- **Boundary Event:** `Order.status` transitioning from `PROCESSING` to `SHIPPED`.
- **Action:** Associated `InventoryReservation` records transition to `status = 'FULFILLED'`, setting `fulfilledAt = NOW()`.
- **Operational Rationale:** At `SHIPPED`, physical goods have left the warehouse and are in possession of the logistics partner. Sellable stock has been operationally consumed. Normal order cancellation is locked.

### 6.4 Cancellation & Exactly-Once Release
- **Allowed States:** `PENDING`, `CONFIRMED`, and pre-dispatch `PROCESSING`.
- **Release Operation:** Executed inside a single transaction:
  1. Verify `InventoryReservation.status === 'RESERVED'`.
  2. For non-variant items: Increment `Product.stock`.
  3. For variant items: Increment `ProductVariant.stock` and `Product.stock` aggregate.
  4. Update `InventoryReservation`: `status = 'RELEASED'`, `releasedAt = NOW()`, `releaseReason = 'CANCELLED'`.
  5. Record cancellation audit fields on `Order`.
- **Idempotency:** If `InventoryReservation.status !== 'RESERVED'`, the release logic is a strict no-op. Stock can never be restored twice.

---

## 7. Failed Delivery, Return Intake & `ReturnItem` Domain

### 7.1 Separation of Return from Restock
Physical return of goods does **not** equal inventory restocking:
$$\text{Physical Return Intake} \neq \text{Inventory Restock} \neq \text{Customer Refund}$$

Pure Haven BD specializes in beauty, cosmetics, and skincare. Due to hygiene, seal-integrity, and safety regulations, returned products must be inspected before any unit is returned to sellable stock.

### 7.2 The `ReturnItem` Model
A dedicated `ReturnItem` model captures physical returns and inspection outcomes for both undelivered returns and post-delivery returns:

```prisma
model ReturnItem {
  id               Int       @id @default(autoincrement())
  orderId          String
  orderItemId      Int       @unique
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
  @@index([disposition])
}
```

### 7.3 Restock Invariants & Execution
1. **Creation:** Physical receipt of returned items generates `ReturnItem` rows with `disposition = 'PENDING_INSPECTION'` and `restockedAt = null`. No sellable stock is adjusted.
2. **Inspection:** Admin evaluates the item:
   - `RESTOCKABLE`: Item is factory-sealed, unswatched, untampered, and resale-safe.
   - `NON_RESTOCKABLE` / `DAMAGED`: Opened, broken seal, expired, or damaged packaging.
3. **Restock Execution:** Stock increment occurs **only** when admin explicitly triggers restock on a `RESTOCKABLE` return item:
   ```sql
   UPDATE "ReturnItem"
   SET "restockedAt" = NOW(),
       "updatedAt" = NOW()
   WHERE "id" = $returnItemId
     AND "disposition" = 'RESTOCKABLE'
     AND "restockedAt" IS NULL;
   ```
   If and only if the update affects 1 row, increment `ProductVariant.stock` (and `Product.stock`) or `Product.stock`. This guarantees strictly exactly-once restocking.

---

## 8. Two-Stage Prepaid Checkout Architecture

The checkout flow is structured into a two-stage reservation and payment sequence to eliminate inventory-lock races and ensure customers only transfer funds after stock is secured.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: Atomic Reservation & Order Creation                                │
│ Customer Submits Cart -> Server Atomically Reserves Stock                   │
│ Server Creates: Order + PaymentRecord + InventoryReservation(s)             │
│ InventoryReservation sets: evidenceDeadlineAt = now + 15 min                │
│ Response: orderId, evidenceDeadlineAt, Payment Instructions                 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 2: Customer Out-of-Band Payment & Evidence Submission                 │
│ Customer sends money via bKash/Nagad Personal -> Receives TrxID             │
│ Customer submits: senderNumber + trxId to POST /api/orders/payment-evidence  │
│ Server compares submittedAt <= InventoryReservation.evidenceDeadlineAt      │
│ Server Creates: PaymentEvidenceAttempt -> PaymentRecord -> VERIFICATION_PENDING
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 3: Administrative Verification & Fulfillment Gating                   │
│ Admin reviews transaction on /admin/payments                                │
│ Valid: PaymentRecord -> PAID; Order eligible for CONFIRMED                  │
│ Invalid (Within 15 min): REJECTED; Customer may resubmit                    │
│ Invalid (Past 15 min): REJECTED; Reservation released; Order CANCELLED       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Prepaid Evidence Timers & Expiry Policy

### 9.1 Single Source of Authority for Evidence Deadline
- **Authoritative Source:** `InventoryReservation.evidenceDeadlineAt = reservedAt + 15 minutes`.
- **Payment Domain Consumption:** The payment domain reads `evidenceDeadlineAt` directly from the active `InventoryReservation` rows of the order. `PaymentRecord` does **not** duplicate this deadline.
- **Protection Rule:** When valid evidence is submitted within the 15-minute window (`PaymentEvidenceAttempt.submittedAt <= InventoryReservation.evidenceDeadlineAt`), the payment state becomes `VERIFICATION_PENDING`.
- **Admin Independence:** Once in `VERIFICATION_PENDING`, the inventory reservation remains protected indefinitely while awaiting admin verification. Administrative backlogs do not expire the customer's reservation.

### 9.2 Expiry & Release Rules
1. **Unsubmitted Expiry:** If `NOW() > InventoryReservation.evidenceDeadlineAt` and payment state is `AWAITING_PAYMENT`, the order is eligible for automated or operational release:
   - `InventoryReservation` transitions to `RELEASED` (`releaseReason = 'EVIDENCE_DEADLINE_EXPIRED'`).
   - `Order` transitions to `CANCELLED` (`cancellationReason = 'system_timeout'`).
2. **Late Genuine Payment:** If a customer pays and submits evidence after the 15-minute deadline and the reservation has been released:
   - The reservation is **never** revived.
   - The transaction transitions strictly to `PaymentRecord.state = 'REFUND_REQUIRED'`.
3. **Evidence Resubmission Policy (Owner Approved):**
   - If an evidence submission is marked `REJECTED` while `NOW() <= InventoryReservation.evidenceDeadlineAt`, the customer may submit corrected evidence.
   - The deadline is **not** extended upon rejection or resubmission.
   - If rejected after the 15-minute window has elapsed, the reservation is released and the order enters operational cancellation.

---

## 10. Payment Data Architecture & State Machine

### 10.1 Data Models: `PaymentRecord` & `PaymentEvidenceAttempt`

```prisma
model PaymentRecord {
  id                  Int                      @id @default(autoincrement())
  orderId             String                   @unique
  method              String                   // Cash on Delivery | bKash | Nagad
  state               String                   // AWAITING_PAYMENT | VERIFICATION_PENDING | PAID | REJECTED | FAILED | REFUND_REQUIRED | REFUND_PROCESSING | REFUNDED
  provider            String?                  // bKash | Nagad
  verifiedAt          DateTime?
  verifiedBy          String?
  rejectionNote       String?

  // Refund Metadata (State truth is PaymentRecord.state)
  refundAmount        Float?
  refundRequiredAt    DateTime?
  refundProcessingAt  DateTime?
  refundedAt          DateTime?
  refundNote          String?

  // COD Settlement Domain (Independent Lifecycle)
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
```

### 10.2 Single Authoritative Payment State Machine
`PaymentRecord.state` is the single source of truth for payment lifecycle and refund progression:

```
                            ┌────────────────────┐
                            │  AWAITING_PAYMENT  │
                            └─────────┬──────────┘
                                      │ (Evidence Submitted within 15m)
                                      ▼
                            ┌────────────────────┐
                ┌───────────┤VERIFICATION_PENDING├───────────┐
                │           └────────────────────┘           │
                │ (Valid Admin Verification)                 │ (Invalid Admin Verification)
                ▼                                            ▼
        ┌──────────────┐                             ┌──────────────┐
        │     PAID     │                             │   REJECTED   │
        └───────┬──────┘                             └───────┬──────┘
                │ (Cancellation / Return / Late Paid)        │ (Within Window: Resubmit)
                ▼                                            │ (Past Window: Release)
        ┌──────────────┐                                     ▼
        │REFUND_REQUIRED                               ┌──────────────┐
        └───────┬──────┘                               │CANCELLED /   │
                │                                      │REFUND_REQD   │
                ▼                                      └──────────────┘
        ┌─────────────────┐
        │REFUND_PROCESSING│
        └───────┬─────────┘
                │
                ▼
        ┌──────────────┐
        │   REFUNDED   │
        └──────────────┘
```

### 10.3 Prepaid Confirmation Gate
- An order with a prepaid method (`bKash`, `Nagad`) **cannot** transition to `Order.status = 'CONFIRMED'` unless `PaymentRecord.state === 'PAID'`.
- Cash on Delivery (COD) orders may transition to `CONFIRMED`, `PROCESSING`, and `SHIPPED` while `PaymentRecord.state` remains `AWAITING_PAYMENT`.

---

## 11. Payment Anti-Replay & Privacy Boundaries

### 11.1 Payment Evidence Anti-Replay Mechanism
To prevent financial fraud where a single transaction ID is claimed across multiple orders:
1. **Transaction Identity:** Defined strictly as `(normalizedProvider, normalizedTrxId)` where both components are trimmed and converted to uppercase.
2. **New Evidence Submission:** If an active claim already exists on another order in `PENDING_REVIEW` or `ACCEPTED` state (or parent `PaymentRecord` in `PAID`, `REFUND_REQUIRED`, `REFUND_PROCESSING`, or `REFUNDED`), the submission is rejected with HTTP `409 Conflict`.
3. **Idempotent Retries:** Duplicate network retries for the *same* payment record with identical transaction details return the existing attempt safely without duplicating state.
4. **`REJECTED` & `FAILED` Claims:** Rejected or failed evidence attempts remain preserved in `PaymentEvidenceAttempt` history for auditing, but their active anti-replay claim is released so legitimate mistyped/corrected transaction IDs are not permanently locked against future genuine submission.
5. **`ACCEPTED`, `PAID` & `REFUNDED` Claims:** Once a transaction is accepted, its identity is permanently consumed. Refunding an order does **not** release the transaction ID for reuse on another order.
6. **Database Enforcement:** Enforced via a PostgreSQL partial unique index on active/accepted claims:
   ```sql
   CREATE UNIQUE INDEX idx_payment_evidence_active_claim
     ON "PaymentEvidenceAttempt" ("provider", "normalizedTrxId")
     WHERE "state" IN ('PENDING_REVIEW', 'ACCEPTED');
   ```

### 11.2 Public Tracking vs Admin Privacy Serialization Boundary
To protect customer financial privacy, data serialization must strictly enforce the following boundary:

| Field | Public Tracking API (`/api/orders?track=1`) | Admin Orders / Verification API |
|---|:---:|:---:|
| `orderId`, `status`, `createdAt` | ✅ Yes | ✅ Yes |
| `customerName`, `customerPhone` | ⚠️ Masked / Exact Match Check | ✅ Yes |
| `paymentMethod` | ✅ Yes | ✅ Yes |
| Customer-Safe `paymentStatus` label | ✅ Yes (`Pending`, `Paid`, `Unpaid`) | ✅ Yes |
| `paymentSenderNumber` | ❌ **FORBIDDEN** | ✅ Yes |
| `paymentTrxId` / `trxId` | ❌ **FORBIDDEN** | ✅ Yes |
| `PaymentEvidenceAttempt` list | ❌ **FORBIDDEN** | ✅ Yes |
| `verifiedBy` / Internal Audit Notes | ❌ **FORBIDDEN** | ✅ Yes |
| `codSettlementNote` / `refundNote` | ❌ **FORBIDDEN** | ✅ Yes |

---

## 12. Cash on Delivery (COD) Settlement Engine

### 12.1 Decoupling Delivery from Settlement
Customer parcel delivery and merchant courier remittance are distinct financial events:
$$\text{Order Status: DELIVERED} \neq \text{COD Settlement: SETTLED}$$

### 12.2 Lifecycle & States
1. **`NOT_APPLICABLE`:** Default for prepaid orders.
2. **`PENDING`:** Automatically set on `PaymentRecord` when a COD order transitions to `DELIVERED`. The delivery rider collected cash, but the courier partner has not yet remitted funds to Pure Haven BD.
3. **`SETTLED`:** Merchant confirms bank/cash remittance from courier statement for this specific order. Admin records `codSettledAt = NOW()`.
4. **`DISPUTED`:** Discrepancy between collected COD amount, courier fees, and remitted payout.

### 12.3 Per-Order Admin Settlement Workflow (Owner Approved)
- Admin verifies courier remittances per-order in the admin portal.
- Batch CSV statement upload and automated courier API reconciliation are deferred to future phases.

---

## 13. Money & Calculation Architecture

### 13.1 Floating-Point Policy for Phase 2
- **Storage:** Maintain existing PostgreSQL `Float` (`double precision`) columns in Phase 2 to avoid cross-cutting breaking changes across serializers and clients during this inventory/payment migration.
- **Context:** Bangladesh retail pricing at Pure Haven BD operates in whole-taka increments (e.g., ৳450, ৳1,200).
- **Strict Normalization:** All money reads and writes must pass through a centralized server helper `moneyNumber(val)` enforcing standard finite 2-decimal-place precision:
  ```typescript
  export function moneyNumber(value: unknown): number {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.round(num * 100) / 100;
  }
  ```
- **Explicit Technical Debt:** Migration of database columns to `Decimal(12,2)` is scheduled for **Phase 4 (Database Architecture)**.

### 13.2 Calculation Rules & Delivery Fee (Owner Approved)
1. **Server Calculation:**
   $$\text{subtotal} = \sum (\text{item.quantity} \times \text{item.price})$$
   $$\text{deliveryFee} = \text{subtotal} > 0 ? 120 : 0$$
   $$\text{total} = \text{subtotal} + \text{deliveryFee}$$
2. **Authoritative Constant:** Delivery fee is locked at **৳120** fixed across Bangladesh. It is imported from a single server-authoritative constants file (`lib/commerceConstants.ts`), eliminating hardcoded magic numbers.
3. **Client Totals Discarded:** Client-asserted `subtotal`, `deliveryFee`, and `total` in checkout payloads are ignored.

---

## 14. Order Identifier & Submission Idempotency

### 14.1 64-Bit Random Order ID with Crockford Base32 Encoding
The legacy 4-digit random suffix ($9,000$ daily IDs) is replaced with a cryptographically secure, support-friendly human identifier:

$$\text{Format: } \mathbf{PH\text{-}YYYYMMDD\text{-}XXXXXXXXXXXXX}$$
- **Entropy Source:** 64 bits (8 bytes) of cryptographically secure randomness generated via `crypto.randomBytes(8)`.
- **Encoding:** 13-character Crockford Base32 encoding (canonical uppercase, unambiguous characters: excludes I, L, O, U).
- **Representative Shape:** `PH-YYYYMMDD-7K4M9Q2T6W3RX` (example structure; each ID is generated dynamically).
- **Security Context:** Public order reference for customer support and tracking; not treated as an authentication secret.

#### Collision Handling & In-Transaction Retry:
The PostgreSQL database unique constraint (`@unique` on `Order.orderId`) remains the final authority on uniqueness. If an insert encounters a collision, the transaction catches the constraint violation and retries with a fresh candidate identifier up to 5 times:

```typescript
export async function createOrderWithUniqueIdRetry(
  tx: PrismaTx,
  orderDataFactory: (orderId: string) => Prisma.OrderCreateArgs
): Promise<Order> {
  const dateStr = getBangladeshDateString(); // YYYYMMDD
  const maxRetries = 5;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const randomSuffix = encodeCrockfordBase32(crypto.randomBytes(8)); // 13 chars
    const candidateId = `PH-${dateStr}-${randomSuffix}`;

    try {
      return await tx.order.create(orderDataFactory(candidateId));
    } catch (error) {
      if (isPrismaUniqueConstraintError(error, "orderId") && attempt < maxRetries) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to generate unique order identifier after maximum retry attempts.");
}
```

### 14.2 Order Submission Idempotency (`submissionToken`)
To protect against double-submissions from multi-tab checkouts, network retries, or impatient double-clicks:
1. `Order` schema adds `submissionToken String? @unique`.
2. Checkout client generates a `submissionToken` (UUID v4 / CUID) upon mounting the checkout form.
3. If a duplicate POST arrives with an existing `submissionToken`:
   - The transaction aborts gracefully.
   - The server catches the unique constraint violation and returns HTTP `200 OK` with the already-created order payload.
   - No duplicate inventory decrement or payment record creation occurs.

---

## 15. Domain Service Boundaries & Ownership Matrix

Responsibilities across the four primary commerce domains are partitioned to maintain strict separation of concerns:

| Domain | Owns Models / Entities | Authoritative Operations | Forbidden Operations |
|---|---|---|---|
| **Inventory Domain** | `InventoryReservation`, `Product.stock`, `ProductVariant.stock` | `reserveInventory()`, `releaseReservation()`, `fulfillReservation()`, `restockReturnItem()`, owns `evidenceDeadlineAt` | Must not inspect payment states or change order fulfillment status directly. |
| **Payment Domain** | `PaymentRecord`, `PaymentEvidenceAttempt` | `recordEvidence()`, `verifyPayment()`, `rejectPayment()`, `processRefund()`, `settleCOD()`, owns `PaymentRecord.state` | Must not mutate catalog stock directly; must call Inventory Domain service APIs. |
| **Order / Fulfillment Domain** | `Order`, `OrderItem` | `createOrder()`, `transitionOrderStatus()`, `cancelOrder()`, `validateTransitions()` | Must not mutate stock or record payments except through respective domain coordinators. |
| **Return Domain** | `ReturnItem` | `createReturnRecord()`, `inspectReturn()`, `evaluateRestockability()` | Must not directly adjust sellable inventory without calling `restockReturnItem()`. |

---

## 16. Implementation Waves & Dependency Strategy

Implementation proceeds through six strictly ordered waves. Wave A creates the shared database foundation; subsequent waves build domain capabilities on top.

```
Wave A: Schema Foundation (Additive Migration)
  │
  ▼
Wave B: Atomic Commerce Creation & Two-Stage Checkout Foundation
  │
  ▼
Wave C: Inventory Lifecycle, Cancellation Release & Catalog Safety
  │
  ├───────────────────────────────────────┐
  ▼                                       ▼
Wave D: Payment, Evidence, Refund, COD   Wave E: ReturnItem & Expiry Integration
  │                                       │
  └───────────────────┬───────────────────┘
                      │
                      ▼
Wave F: Full Integration Verification & Phase-2 Lock
```

### Wave A — Foundation Schema (Additive Migration)
- **Scope:** Add `InventoryReservation`, `PaymentRecord`, `PaymentEvidenceAttempt`, `ReturnItem` models and `Order.submissionToken` column in a single coordinated migration.
- **Artifacts:** `prisma/schema.prisma`, `prisma/migrations/*_phase2_foundation/migration.sql`.
- **Constraint:** Zero data mutation; purely additive tables and nullable columns.

### Wave B — Atomic Commerce Creation
- **Scope:** Guarded atomic stock decrement (`lib/inventoryService.ts`), multi-item transaction atomicity, `submissionToken` idempotency, 13-character Crockford Base32 collision-safe order ID generation, two-stage checkout order initialization (`PaymentRecord` created in `AWAITING_PAYMENT`).
- **Artifacts:** `lib/inventoryService.ts`, `app/api/orders/route.ts`, `lib/commerceConstants.ts`.

### Wave C — Inventory Lifecycle & Catalog Protection
- **Scope:** Exactly-once cancellation release (handling variant + product aggregate), `SHIPPED` fulfillment boundary (`InventoryReservation -> FULFILLED`), fail-closed `DELETE /api/orders`, variant-ID preserving product updates, active reservation deletion blocks on products and variants, explicit decoupling of generic product metadata edits from live stock.
- **Artifacts:** `app/api/orders/route.ts`, `app/api/products/route.ts`.

### Wave D — Payment Workflow, Evidence & Settlement
- **Scope:** Two-stage evidence submission endpoint (`POST /api/orders/payment-evidence`), single payment state machine, multi-attempt evidence history, `provider + normalizedTrxId` anti-replay partial index, `PAID` gate for confirmation, verifier audit, public tracking privacy masking, COD settlement transitions, refund lifecycle.
- **Artifacts:** `app/api/orders/payment-evidence/route.ts`, `app/api/orders/payment-status/route.ts`, `components/admin/PaymentVerificationClient.tsx`, `app/checkout/page.tsx`.

### Wave E — Return Domain & Expiry Integration
- **Scope:** `ReturnItem` creation on `RETURN_RECEIVED` (undelivered returns) and admin logging (post-delivery returns), admin return disposition endpoint, exactly-once restock logic, automated/operational deadline expiry cleanup for abandoned prepaid orders.
- **Artifacts:** `app/api/orders/return/route.ts`, `app/api/orders/restock/route.ts`, `lib/inventoryExpiry.ts`.

### Wave F — Full Integration Verification & Phase-2 Lock
- **Scope:** Comprehensive test suite execution, real PostgreSQL concurrency harness validation, security regression verification, clean migration status, Phase-2 sign-off.
- **Artifacts:** `tests/integration/*`, test reports.

---

## 17. Real PostgreSQL Concurrency Verification Strategy

Mocked in-memory transactions cannot prove database row-level lock behavior or race condition resilience. Wave F mandates executing a dedicated concurrency test suite against a real PostgreSQL database.

### 17.1 Environment Isolation & Safety Invariant
- Concurrency integration tests **MUST** require `DATABASE_URL_TEST`.
- If `DATABASE_URL_TEST` is undefined, tests abort immediately with an error.
- **Strict Prohibition:** Tests must **never** fall back to `DATABASE_URL` (production/development database).

### 17.2 Mandatory Real-DB Test Scenarios

```typescript
// tests/integration/concurrency-scenarios.test.ts
```

1. **Final-Unit Overselling Race:**
   - Setup: Product with `stock = 1`.
   - Action: Fire 10 simultaneous `POST /api/orders` requests for quantity 1.
   - Requirement: Exactly 1 request succeeds (HTTP 200/201); 9 requests fail (HTTP 409/400). Final stock is exactly `0` (never negative). Exactly 1 `InventoryReservation` created.
2. **Concurrent Double-Cancellation Race:**
   - Setup: Order with 2 reserved units.
   - Action: Fire 2 simultaneous `PUT /api/orders` cancellation requests.
   - Requirement: Stock is incremented by exactly 2 (never 4). `InventoryReservation.status` is `RELEASED`.
3. **Duplicate Submission Token Race:**
   - Setup: Cart checkout payload with a fixed `submissionToken`.
   - Action: Fire 2 identical simultaneous POST requests.
   - Requirement: Exactly 1 order created in database; second request returns existing order without decrementing stock again.
4. **Concurrent Duplicate Payment Evidence:**
   - Setup: Two distinct pending orders.
   - Action: Fire simultaneous evidence submissions with identical `(provider, trxId)`.
   - Requirement: Exactly 1 submission succeeds; second submission is rejected for duplicate transaction replay.

---

## 18. Legacy Historical Data Compatibility Strategy

Orders created prior to Phase 2 Package 2/3 lack `variantId`, `InventoryReservation`, or `PaymentRecord` records.

1. **Historical Variant Stock:**
   - Legacy order items with `variantId = null` cannot be mapped to variants.
   - On cancellation of legacy orders, only `Product.stock` is restored. No heuristic guessing based on `variantLabel` is permitted.
2. **Historical Payment Data:**
   - Legacy orders continue to display `paymentMethod` and `paymentStatus` via fallback properties on `Order`.
   - Read serializers check `PaymentRecord` first; if absent, they map legacy `Order.paymentStatus` (`"verified"` $\to$ `"PAID"`, `"pending"` $\to$ `"AWAITING_PAYMENT"`).
3. **Additive Integrity:**
   - Legacy orders without `InventoryReservation` rows are not retroactively modified. New integrity rules apply to all orders placed after Wave A deployment.

---

## 19. Comprehensive Final Verification Matrix

| Domain | Test Case ID | Description | Verification Method | Pass Condition |
|---|---|---|---|---|
| **Order** | `ORD-01` | Non-variant order creation | Automated Handler Test | Stock decremented; `InventoryReservation` created (`variantId=null`). |
| | `ORD-02` | Variant order creation | Automated Handler Test | `ProductVariant.stock` & aggregate decremented; `variantId` persisted. |
| | `ORD-03` | Multi-item out-of-stock rollback | Automated Handler Test | 1 line fails $\to$ entire order rolls back; 0 stock changed. |
| | `ORD-04` | Duplicate `submissionToken` | Automated Handler Test | HTTP 200 with existing order; 0 duplicate stock decrement. |
| | `ORD-05` | 13-character Crockford Base32 ID format | Automated Unit Test | Matches `PH-YYYYMMDD-XXXXXXXXXXXXX`; DB unique collision retry executes safely. |
| **Inventory** | `INV-01` | Final-unit concurrency | **Real PostgreSQL Concurrency** | 10 concurrent requests $\to$ exactly 1 winner; final stock = 0. |
| | `INV-02` | Cancellation stock restoration | Automated Handler Test | Product and Variant stock incremented; reservation `RELEASED`. |
| | `INV-03` | Concurrent double-cancel | **Real PostgreSQL Concurrency** | 2 concurrent cancels $\to$ stock restored exactly once. |
| | `INV-04` | Handoff fulfillment lock | Automated Handler Test | `SHIPPED` transitions reservation to `FULFILLED`; cancel rejected. |
| | `INV-05` | Expiry release | Automated Handler Test | Unpaid order past 15m releases stock; reservation `RELEASED` (`releaseReason = 'EVIDENCE_DEADLINE_EXPIRED'`). |
| | `INV-06` | No revival on late payment | Automated Handler Test | Paid attempt on released reservation $\to$ `PaymentRecord.state = 'REFUND_REQUIRED'`. |
| | `INV-07` | Restock `RESTOCKABLE` return | Automated Handler Test | Stock restored; `ReturnItem.restockedAt` populated. |
| | `INV-08` | Block `NON_RESTOCKABLE` restock| Automated Handler Test | Stock adjustment rejected; item remains damaged/written off. |
| **Payment** | `PAY-01` | Two-stage checkout reservation | Automated Handler Test | Stage 1 reserves stock and creates `PaymentRecord` in `AWAITING_PAYMENT`. |
| | `PAY-02` | Evidence submitted in window | Automated Handler Test | State $\to$ `VERIFICATION_PENDING`; reservation held past 15m. |
| | `PAY-03` | Resubmission within window | Automated Handler Test | Rejected attempt corrected within original 15m window succeeds. |
| | `PAY-04` | Confirmation gate | Automated Handler Test | Prepaid order cannot transition to `CONFIRMED` until `PAID`. |
| | `PAY-05` | TrxID anti-replay | **Real PostgreSQL Concurrency** | Same provider + TrxID rejected on subsequent active orders. |
| **COD** | `COD-01` | Delivery $\neq$ Settlement | Automated Handler Test | `DELIVERED` status sets `codSettlementState = 'PENDING'`. |
| | `COD-02` | Admin settlement | Automated Handler Test | Admin settles COD $\to$ `codSettlementState = 'SETTLED'`. |
| **Refund** | `REF-01` | Single authoritative refund state | Automated Handler Test | `PaymentRecord.state = 'REFUNDED'` tracks lifecycle; does not touch inventory. |
| **Privacy** | `PRV-01` | Public tracking masking | Automated Serializer Test | Public tracking output contains 0 TrxIDs, 0 phone numbers, 0 audit notes. |
| **Catalog** | `CAT-01` | Variant ID preservation | Automated Handler Test | Product update retains existing variant IDs; no `deleteMany`. |
| | `CAT-02` | Active variant delete block | Automated Handler Test | Cannot delete variant with active `RESERVED` reservation (HTTP 409). |
| | `CAT-03` | Active product delete block | Automated Handler Test | Cannot delete product with active `RESERVED` reservation (HTTP 409). |
| | `CAT-04` | Stock decoupling on generic edit | Automated Handler Test | Generic product metadata update does not overwrite live stock. |
| **Money** | `MON-01` | Server-authoritative total | Automated Unit Test | Client-submitted totals ignored; calculated from database prices. |
| | `MON-02` | Fixed ৳120 delivery fee | Automated Unit Test | Correctly imports and applies ৳120 standard delivery fee. |
| **Security** | `SEC-01` | Phase-1 60-test regression | Full Automated Regression | 100% pass across all 60 Phase 1 security and auth tests. |
| **Database** | `DB-01` | Schema drift verification | Prisma CLI Verification | `npx prisma migrate diff` reports empty drift against live database. |

---

## 20. Explicit Scope Boundaries (Out of Scope for Phase 2)

The following areas are explicitly deferred to subsequent phases as defined in the master roadmap:
- **Phase 3:** Customer authentication overhaul (migration from JSON to PostgreSQL), OTP/SMS verification, and derived customer trust score profiles.
- **Phase 3:** Customer-facing authenticated return request portal (Phase 2 uses admin-initiated return logging).
- **Phase 4:** Deep PostgreSQL schema refactoring, foreign-key cascade restructuring, and `Float` $\to$ `Decimal(12,2)` migration.
- **Phase 5:** Catalog pagination, filtering optimization, and database query indexing.
- **Phase 6:** Media asset storage, CDN offloading, and image processing pipeline.
- **Phase 7:** End-to-end caching, performance tuning, and edge optimization.
- **Phase 9+:** Direct payment gateway integrations (bKash Checkout API, Nagad Gateway, SSLCommerz) and automated webhook reconciliation.
- **Phase 10+:** Direct third-party courier partner API integrations (Steadfast, Pathao, RedX) and automated consignment booking.
- **General:** Batch CSV courier settlement reconciliation.

---

## 21. Specification Self-Review & Integrity Sign-Off

- [x] **Zero Placeholders:** Contains no `TODO`, `TBD`, or unresolved design choices.
- [x] **Order-ID Entropy Standard:** 64 bits randomness encoded in 13-character Crockford Base32 (`PH-YYYYMMDD-XXXXXXXXXXXXX`) with DB unique collision retry.
- [x] **Single Payment Lifecycle State:** `PaymentRecord.state` is authoritative truth; duplicate `refundState` eliminated.
- [x] **Evidence Deadline Single Source:** `InventoryReservation.evidenceDeadlineAt` is single authoritative source; duplicate removed from `PaymentRecord`.
- [x] **Anti-Replay Mechanism:** Partial unique index on active/accepted attempts; rejected/failed claims released; accepted/refunded claims permanently consumed.
- [x] **Return Distinction:** Failed delivery returns (`RETURN_RECEIVED`) strictly distinguished from post-delivery customer returns (`DELIVERED` immutable outcome).
- [x] **Fulfilment Boundary Consistency:** `InventoryReservation` fulfilled at `SHIPPED` (not `DELIVERED`).
- [x] **Two-Stage Checkout Clarity:** Customer receives reservation and deadline before transferring funds.
- [x] **Prepaid Evidence Semantics:** 15 minutes is customer evidence deadline; `VERIFICATION_PENDING` preserves reservation during admin review.
- [x] **Return Safety Invariant:** Physical return intake does not auto-restock; cosmetics require inspection disposition.
- [x] **Refund Independence:** Refund and restock lifecycles operate independently.
- [x] **Variant Identity Rule:** `variantLabel` is never used as a stock restoration fallback.
- [x] **Public Privacy:** Sensitive financial and customer contact data masked in tracking APIs.
- [x] **Catalog Safety:** Generic product metadata edits decoupled from live stock adjustments.
- [x] **Real Concurrency Testing:** Mandatory `DATABASE_URL_TEST` real-PostgreSQL test harness specified.
- [x] **Implementation Wave Dependencies:** Six sequential waves (A–F) with unambiguous prerequisites.

**Phase 2 Unified Commerce Integrity Design is LOCKED.**
