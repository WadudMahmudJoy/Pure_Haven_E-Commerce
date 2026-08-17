# Phase 2 — Package 1: Order, Payment, and Inventory Integrity Design Specification

- **Document ID:** `PH2-SPEC-PKG1-20260817`
- **Status:** APPROVED & LOCKED
- **Creation Date:** 2026-08-17
- **Baseline Commit:** `53f5d2d85b5e1a55ab58a2166aff9aa42d62430c` (`phase1-complete`)
- **Scope:** Package 1 (Order Integrity, Inventory Allocation, Payment State Machine, Return/Restock Logic, Settlement Boundary Design)
- **Document Type:** Canonical Architecture & Design Specification

---

## 1. Current Audited Baseline (Package 1A Audit Findings)

The following baseline realities are documented from the comprehensive Package 1A audit of the Pure Haven BD codebase at commit `53f5d2d85b5e1a55ab58a2166aff9aa42d62430c`:

1. **Customer Identity Isolation:** Registered customer records currently exist exclusively in `data/customer-users.json`. There is no PostgreSQL/Prisma `Customer` or `User` model in `prisma/schema.prisma`.
2. **Missing Relational Foreign Key:** The `Order` model in Prisma has no `customerId` or `userId` foreign key.
3. **Fragile Order Association:** Customer order history is retrieved dynamically in `GET /api/customer-orders` by querying `prisma.order.findMany({ where: { customerPhone: sanitizePhone(user.phone) } })`.
4. **Incomplete Phone Normalization & Lack of Verification:** Phone handling only strips non-digits (`\D`). Country prefix variations (`+8801...` vs `01...`) are not standardized, and there is no phone verification or OTP mechanism.
5. **Unconstrained Backend State Transitions:** `PUT /api/orders` accepts arbitrary status strings with no server-side state-machine validation, relying solely on client UI constraints.
6. **Limited Fulfilment Modeling:** Current fulfilment relies on basic string statuses (`pending`, `confirmed`, `processing`, `delivered`, `cancelled`). Carrier handoff, out-for-delivery, delivery failure, and return states are not modeled.
7. **Variant Association Data Loss:** While `OrderItem` preserves `productId`, it lacks a `variantId` column. The incoming `variantId` is discarded during `Order` creation in `POST /api/orders`, retaining only a formatted string in `OrderItem.name`.
8. **Asymmetric Inventory Handling on Cancellation:** `POST /api/orders` decrements both `Product.stock` and `ProductVariant.stock`. However, `PUT /api/orders` cancellation only increments `Product.stock`, permanently leaking variant inventory.
9. **Non-Idempotent Stock Restoration:** Order cancellation contains no durable restoration evidence or flags (`stockRestored`), allowing multiple restocks if an order transitions between statuses repeatedly.
10. **Concurrency Vulnerability in Inventory Allocation:** Inventory checks in `POST /api/orders` perform an optimistic `findUnique` read before an `update` decrement under PostgreSQL default Read Committed isolation without row-level locking or check constraints, allowing simultaneous purchases of the final unit to drive stock negative.
11. **Flat Payment Storage & Missing Ledger:** Payment data is stored as flat strings on `Order` (`paymentMethod`, `paymentStatus`, `paymentProvider`, `paymentSenderNumber`, `paymentTrxId`). There is no payment transaction ledger, multi-attempt tracking, or refund metadata.
12. **Unmodeled COD Settlement:** Cash on Delivery settlement between the courier and merchant is not modeled independently from order delivery status.

### Explicit Roadmap Boundaries
- **Customer Authentication Migration:** Customer authentication redesign, migration to Prisma/PostgreSQL, and session overhauls are explicitly deferred to **Phase 3**. Package 1 design establishes rules without introducing an immediate customer-auth migration.
- **Broader Database Architecture:** General database restructuring, multi-table normalization, and advanced analytics tables remain scheduled for **Phase 4**.

---

## 2. Customer Identity and Trust Design

### 2.1 Identity Hierarchy
To establish durable customer associations across both guest and registered purchases without creating immediate breaking changes, the long-term identity hierarchy is locked as:

1. **Registered Customer / User ID:** The canonical identity for registered accounts (`user_...` / `cust_...`).
2. **Verified Normalized Phone:** The primary identity for guest checkouts and secondary identity for registered users (normalized strictly to Bangladesh standard format `+8801XXXXXXXXX` / `01XXXXXXXXX`).
3. **Email Address:** A supporting identifier for communications, receipts, and account lookup.
4. **Non-Canonical Attributes:** Customer Name, Delivery/Shipping Address, IP Address, and Device Fingerprints must **never** be used as canonical customer identities.

### 2.2 Customer Trust Model
Customer trust tiers are determined dynamically based on authoritative historical order outcomes rather than arbitrary manual flags or mutable counters:

* **`NEW`:**
  * **Criteria:** 0 successful `DELIVERED` orders.
  * **Policy:** Cash on Delivery (COD) orders require operational verification (phone confirmation) before the order can transition to `CONFIRMED`.
* **`ESTABLISHED`:**
  * **Criteria:** Exactly 1 successful `DELIVERED` order with no negative abuse record.
  * **Policy:** Standard processing; not automatically promoted to Loyal.
* **`LOYAL`:**
  * **Criteria:** 2 or more successful `DELIVERED` orders and no customer-attributable abuse history.
  * **Policy:** Eligible for streamlined processing and potential COD auto-confirmation only after reliable canonical identity and phone verification foundations exist (Phase 3).
* **`HIGH_RISK`:**
  * **Criteria:** Customer-attributable negative history (e.g. refused parcels at doorstep, fraudulent contact info, repeated unreachable delivery attempts, explicit bad-faith abuse).
  * **Policy:** Mandatory manual phone/identity verification prior to confirmation; may be placed on operational review.
* **`COD_RESTRICTED`:**
  * **Criteria:** Confirmed repeat COD abuse, chronic refusal of dispatched parcels, or verified fraud.
  * **Policy:** COD payment method disabled at checkout (requires prepaid payment: bKash/Nagad). Restrictions must be administratively reviewable and auditable.

### 2.3 Attribution-Based Trust Rules
- **Cancellation Alone != High Risk:** A cancelled order does **not** make a customer high-risk unless the cancellation was caused by bad-faith customer actions (e.g., doorstep refusal, fake contact details).
- **Return Alone != High Risk:** A returned order does **not** make a customer high-risk unless customer fraud or deliberate damage is proven.
- **Protection from Non-Customer Faults:** Merchant stockouts, warehouse fulfillment delays, defective products, courier transit damage, or merchant errors must **never** degrade a customer's trust tier.
- **Derived Trust Computation:** Trust tiers (`NEW`, `ESTABLISHED`, `LOYAL`) must be derivable from immutable order/fulfillment history. Explicit restrictions (`COD_RESTRICTED`) may be recorded as durable administrative overrides.
- **Phase 2 Identity Scope:** Phase 2 records attribution evidence on authoritative order and lifecycle records, but does **not** construct permanent customer risk profiles on unverified phone strings. Derivation of customer-level trust tiers will be integrated in Phase 3 when canonical identity and phone verification exist.
- **Phase 2 V1 Operational Policy:** Because verified customer identity foundations are scheduled for Phase 3, all Phase 2 V1 COD orders remain in `PENDING` status until operational phone verification is completed by the merchant team. Automatic COD confirmation for Loyal customers is deferred until Phase 3.

---

## 3. Inventory Reservation Design

### 3.1 Allocation Invariants
1. **Atomic Allocation:** Inventory allocation must occur as an atomic operation. An order cannot be partially reserved across line items.
2. **First-Server-Reservation Wins:** Allocation is awarded strictly to the first request successfully committed by the database server.
3. **Submission Time Irrelevant:** Transaction ID (`paymentTrxId`) submission timestamp or client checkout clock must never decide inventory allocation priority.
4. **Client State Never Authoritative:** Client-submitted stock numbers, prices, or payment statuses are untrusted and discarded.
5. **COD Allocation:** Cash on Delivery orders reserve inventory immediately upon successful order creation.

### 3.2 Manual Prepaid (bKash / Nagad) Reservation Window
1. **15-Minute Customer Evidence Submission Window:** Manual prepaid orders reserve inventory for exactly 15 minutes from order creation. During this window, the customer must submit their payment claim (Sender Number + TrxID).
2. **Preservation on Evidence Submission:** Once the customer submits payment evidence within the 15-minute window, the payment status transitions to `VERIFICATION_PENDING`. The inventory reservation is held and must **not** expire merely because administrative verification occurs after the 15-minute customer window has elapsed.
3. **Rejected Evidence & Reservation Resolution:**
   - If payment evidence is reviewed and `REJECTED` while the original 15-minute customer submission window is still active, the customer may correct and resubmit evidence.
   - If payment evidence is rejected after the submission window has elapsed, the reservation must **not** remain indefinitely locked. The order enters an explicit operational resolution / cancellation path, and inventory is released **exactly once** when cancellation is finalized.
   - If there is credible evidence that customer funds were actually received despite invalid or mismatched submission details, the order must not be silently cancelled as an unpaid timeout; it must route to manual financial review or `REFUND_REQUIRED` as appropriate.
4. **Operational Verification Timeout:** A separate administrative verification-pending operational timeout may be made configurable during implementation planning. Admin verification is **not** required to complete within the original 15-minute customer window, and no fixed admin timeout is hard-coded in this design specification.
5. **Single-Release Expiry on Non-Submission:** If payment evidence is not submitted within the 15-minute window, the reservation expires, the order is cancelled with a system timeout reason, and inventory is released back to stock **exactly once**.
6. **Late Payment Handling:** A genuine payment submitted after reservation expiry does **not** revive or reclaim the expired reservation, and does **not** take another customer's allocation. The late transaction enters `REFUND_REQUIRED` / manual financial handling.

### 3.3 Traceability & Restoration Idempotency
1. **Exact Product & Variant Traceability:** When an ordered item has a variant, a stable variant reference/ID sufficient to identify the exact inventory record must be preserved. Variant label, SKU, or options snapshots may ALSO be preserved for historical display, but a text snapshot alone is not sufficient for inventory restoration.
2. **Restoration Idempotency Invariant:** The same inventory entitlement must **never** be restored more than once.
3. **Adjustment Granularity:** Durable idempotency evidence must exist at the appropriate adjustment granularity, which implementation planning may determine to be at the level of the order, order item, variant/order item, return item, or a dedicated inventory restoration/event record. This granularity must safely support full-order cancellation, exact variant restoration, and future partial-item returns.
4. **Database Concurrency Target:** Implementation planning must prioritize concurrency-safe database operations (e.g., conditional updates where `stock >= requested_quantity`, row-level locking via `SELECT ... FOR UPDATE`, or database check constraints) over vulnerable read-then-decrement patterns.

---

## 4. Fulfilment State Machine

### 4.1 Approved Forward Lifecycle
```
PENDING
  ↓
CONFIRMED
  ↓
PROCESSING
  ↓
SHIPPED (Courier Handoff)
  ↓
OUT_FOR_DELIVERY (Last-Mile Delivery)
  ↓
DELIVERED
```

### 4.2 State Definitions
* **`PENDING`:** Order placed; awaiting operational phone verification (for COD) or payment evidence submission/verification (for manual prepaid). Inventory is reserved.
* **`CONFIRMED`:** Order verified by merchant and approved for fulfillment. Prepaid orders must be `PAID`.
* **`PROCESSING`:** Order is being picked, packed, and prepared for dispatch in the warehouse.
* **`SHIPPED`:** Parcel has been physically handed over to the courier partner.
* **`OUT_FOR_DELIVERY`:** Courier rider is actively attempting last-mile delivery to the customer.
* **`DELIVERED`:** Parcel has been physically handed to the customer. This represents the final fulfilment outcome.

### 4.3 Cancellation Boundaries
* `PENDING` → `CANCELLED`: Allowed (releases reserved inventory).
* `CONFIRMED` → `CANCELLED`: Allowed (releases reserved inventory).
* `PROCESSING` → `CANCELLED`: Allowed **only** before courier handoff.
* **Post-Handoff Lock:** Once an order is `SHIPPED` (handed to courier), standard cancellation is **forbidden**. The parcel must complete delivery or enter the undelivered return flow.

### 4.4 Undelivered / Delivery Failure Flow
```
OUT_FOR_DELIVERY
  ↓
DELIVERY_FAILED (Customer unreachable, refused, invalid address)
  ↓
RETURN_IN_TRANSIT (Courier physically returning parcel to Pure Haven)
  ↓
RETURN_RECEIVED (Pure Haven warehouse physically receives parcel)
```

### 4.5 Inventory Disposition by State
* `DELIVERY_FAILED`: **No stock restoration.** Parcel is with the courier.
* `RETURN_IN_TRANSIT`: **No stock restoration.** Parcel is in transit.
* `RETURN_RECEIVED`: Triggers eligibility for physical inspection and inventory disposition assessment.

### 4.6 Server-Side Rejection of Invalid Transitions
The backend must reject all illegal or reverse state jumps with an appropriate 4xx response (e.g. 400 Bad Request or 409 Conflict, decided during implementation planning), including but not limited to:
* `DELIVERED` → `PROCESSING` (Forbidden)
* `CANCELLED` → `PENDING` (Forbidden)
* `PENDING` → `DELIVERED` (Forbidden)
* `RETURN_RECEIVED` → `CONFIRMED` (Forbidden)
* `SHIPPED` → `CANCELLED` (Forbidden)

---

## 5. Return and Restock Design

### 5.1 Restock Safety Invariant
`RETURN_RECEIVED` does **NOT** equal automatically `RESTOCKED`.

Because Pure Haven BD sells beauty, skincare, and cosmetic products, returned items present safety, hygiene, and contamination considerations:

1. **Restockable Condition:**
   * Sealed in original packaging, untampered, undamaged, and resale-safe.
   * May be restored to sellable inventory **exactly once**.
2. **Non-Restockable Condition:**
   * Opened, seal broken, used, swatched, damaged, contaminated, or expired.
   * Must **never** be returned to sellable inventory. Must be written off or designated as damaged stock.

### 5.2 Decoupled Lifecycles
The following three processes must remain strictly decoupled:
$$\text{Physical Return} \neq \text{Inventory Restock} \neq \text{Refund Completion}$$

- A physical return does not automatically trigger or complete a refund; refund timing and eligibility follow the applicable refund policy independently.
- A refund may be issued without physical return (e.g. lost in courier transit, merchant-cancelled prepaid order where funds were received).
- Post-delivery returns do **not** alter the fact that order fulfilment reached `DELIVERED`.

### 5.3 Post-Delivery Return Lifecycle
When a return occurs after delivery, `DELIVERED` remains the immutable fulfilment outcome on the `Order`. A return operates as a **separate return lifecycle** attached to that delivered order, and may apply to one or more specific line items rather than forcing whole-order returns:

```
Order Fulfilment Status: DELIVERED (Immutable outcome)

Attached Return Lifecycle (per order or per line item):
REQUESTED (Customer requests return with reason for specific item/s)
  ↓
APPROVED (Merchant approves return request)
  ↓
RETURN_IN_TRANSIT (Customer or courier ships item back)
  ↓
RETURN_RECEIVED (Warehouse physically receives item)
  ↓
INSPECTION & DISPOSITION (Restock decision: Sellable vs Damaged)
  ↓
COMPLETED (Return closed; refund issued if applicable)
```
*(Alternatively, `REQUESTED` → `REJECTED` if return policy criteria are not met).*

*Note: The exact data structure (dedicated `OrderReturn` / `ReturnItem` model vs specialized relational fields) will be determined during implementation planning based on schema fit.*

---

## 6. Cancellation & Failure Attribution

To protect customer trust while mitigating fraud, every cancellation or failed fulfillment must record attribution evidence.

### 6.1 Attribution Categories
* **Customer-Attributable Factors (Captured on lifecycle records):**
  * `CUSTOMER_REFUSED`: Customer refused parcel upon delivery without valid defect reason.
  * `INVALID_CONTACT`: Customer provided fake, inactive, or unreachable phone/address.
  * `CUSTOMER_UNREACHABLE`: Courier attempted delivery multiple times with no customer response.
  * `SUSPECTED_FAKE_ORDER`: Deliberate spam, bot, or prank order.
  * `CUSTOMER_CANCELLED_LATE`: Customer cancelled after preparation without legitimate cause.
* **Non-Damaging Factors (Must NOT impact customer trust tier):**
  * `MERCHANT_STOCKOUT`: Pure Haven BD ran out of inventory.
  * `WRONG_ITEM`: Incorrect item packed by warehouse.
  * `DEFECTIVE_PRODUCT`: Product arrived damaged, leaking, or expired.
  * `COURIER_DAMAGE`: Parcel damaged or lost by logistics partner.
  * `MERCHANT_ERROR`: Pricing, catalog, or administrative error.
  * `CUSTOMER_CHANGE_OF_MIND_EARLY`: Cancellation requested in `PENDING` status before processing.

### 6.2 Required Conceptual Audit Evidence
Every cancellation must capture information equivalent to:
1. **Who cancelled:** Party who performed or caused cancellation (`CUSTOMER`, `ADMIN`, `SYSTEM`).
2. **Why cancelled:** Specific reason code and optional notes.
3. **When cancelled:** Immutable cancellation timestamp.
4. **Fault Attribution:** Attribution sufficient to distinguish customer causes from merchant, courier, or system causes.

*Note: Customer-attributable and non-customer-attributable evidence is captured on authoritative order, delivery, cancellation, and return lifecycle records. Phase 2 does not construct permanent customer risk profiles on unverified phone strings. Exact database columns, enums, or model structures will be finalized during implementation planning to avoid unnecessary duplicate fields.*

---

## 7. Payment State Machine

### 7.1 Approved Conceptual Payment States
1. **`AWAITING_PAYMENT`:** Order created; payment has not yet been submitted or collected. (This is the target conceptual state for both unpaid prepaid orders and uncollected COD orders).
2. **`VERIFICATION_PENDING`:** Payment evidence submitted (e.g. bKash/Nagad TrxID & sender number); awaiting administrative or automated verification.
3. **`PAID`:** Payment has been authoritatively verified by admin or automated gateway.
4. **`REJECTED`:** Submitted payment evidence was invalid, duplicate, or incorrect.
5. **`FAILED`:** Gateway technical failure or unrecoverable transaction error.
6. **`REFUND_REQUIRED`:** Customer funds were verified/collected, but must be returned due to cancellation, stockout, or approved return.
7. **`REFUND_PROCESSING`:** Refund transaction initiated but pending final confirmation.
8. **`REFUNDED`:** Refund successfully executed with auditable refund transaction details.

*(Note: If legacy code/database records currently use `"pending"`, that is an implementation compatibility concern. `AWAITING_PAYMENT` is the target conceptual state before payment is submitted/collected).*

### 7.2 Method-Specific Invariants
* **Prepaid Invariant (bKash / Nagad):**
  * A prepaid order **cannot** transition to `CONFIRMED` until payment state is `PAID`.
* **Cash on Delivery (COD) Invariant:**
  * A COD order **may** transition to `CONFIRMED`, `PROCESSING`, and `SHIPPED` while payment status remains `AWAITING_PAYMENT`.

### 7.3 Manual Prepaid Workflow
```
Order Created → Stock Reserved (15-min customer window) → AWAITING_PAYMENT
  ↓ (Customer submits Sender Number & TrxID within 15 mins)
VERIFICATION_PENDING (Reservation held pending operational review)
  ↓
Admin Review:
  ├── Valid TrxID   → PAID → Order CONFIRMED allowed
  └── Invalid TrxID → REJECTED:
        ├── Within 15-min window → Customer may correct/resubmit evidence
        └── After 15-min window  → Operational resolution path / Order CANCELLED → Inventory released (1x)
                                   (If customer funds received → REFUND_REQUIRED)

Timeout Path:
15-min expires with no payment evidence → Order CANCELLED (SYSTEM_TIMEOUT) → Inventory released (1x)

Late Payment Path:
Payment submitted/verified after reservation expiry → Does NOT reclaim inventory → REFUND_REQUIRED
```

*Note: Payment rejection by itself (e.g. mistyped TrxID) must **not** automatically mark a customer High Risk.*

---

## 8. COD Settlement & Accounting Boundary

### 8.1 Settlement Decoupling
Customer delivery and merchant financial settlement are independent operational stages:

$$\text{DELIVERED} \neq \text{COD Settlement: SETTLED}$$

When a COD parcel is delivered:
1. The customer pays cash to the delivery rider.
2. The order status becomes `DELIVERED`.
3. Merchant COD settlement remains `PENDING` until the courier remits funds to Pure Haven BD.

### 8.2 Approved COD Settlement States
* **`NOT_APPLICABLE`:** For prepaid orders (bKash/Nagad).
* **`PENDING`:** Parcel delivered; courier has collected cash but has not remitted payment to Pure Haven BD.
* **`SETTLED`:** Courier remittance received, reconciled, and confirmed in merchant account.
* **`DISPUTED`:** Discrepancy between collected COD amount, courier fees, and remitted funds.

---

## 9. Courier & Logistics Boundary

### 9.1 Fee vs Cost Separation
* **Customer Delivery Fee:** The fixed or calculated fee charged to the customer at checkout (e.g., ৳120).
* **Merchant Courier Cost:** The actual operational logistics expense billed to Pure Haven BD by the courier partner.

### 9.2 Future Logistics Fields (Forward Compatibility)
To support future courier integrations (e.g., Steadfast, Pathao, RedX), the architecture should accommodate:
* Courier Provider Name
* Consignment / Tracking ID
* Courier Handover Timestamp
* Delivery Timestamp
* Actual Courier Delivery Fee
* Courier COD Processing Fee
* Return Logistics Cost
* Courier Settlement Batch ID & Timestamp

*Future implementation packages will introduce only the minimum necessary fields required to enforce the state machine and preserve baseline stability.*

---

## 10. Refund & Inventory Independence Invariants

The following invariants are locked across all modules:

1. **Refund does not automatically restore stock:** Issuing a refund to a customer does not mean the item has been returned or is in resaleable condition.
2. **Stock restoration does not automatically refund money:** Restoring inventory does not trigger financial payout without explicit refund processing.
3. **Physical return does not automatically complete refund:** Receiving a return does not automatically trigger/complete a refund; refund timing and eligibility follow the applicable refund policy independently.
4. **`RETURN_RECEIVED` does not automatically mean sellable inventory restored:** Contaminated, damaged, or opened beauty products must be routed to damaged inventory, not sellable stock.
5. **Prepaid cancellation refund condition:**
   - Cancelled prepaid order where funds were actually received/verified → `REFUND_REQUIRED`.
   - Cancelled prepaid order where no funds were received (e.g. reservation timeout) → No refund required.
6. **Defective/Damaged cosmetic returns:** Refund amount and eligibility follow the applicable customer service policy independently, while unsafe/non-restockable items must not re-enter sellable inventory.

---

## 11. Server Authority & Validation Model

1. **Zero Client Authority:** The client browser is strictly a presentation and input interface. Client-asserted prices, totals, stock states, and status changes are never trusted.
2. **Server-Side Validation Matrix:** All API endpoints (`PUT /api/orders`, `PATCH /api/orders/payment-status`, etc.) must enforce:
   * Verification of the order's current state.
   * Rejection of illegal state transitions.
   * Enforcement of payment prerequisites prior to confirmation.
   * Enforcement of the courier-handoff boundary for cancellations.
   * Single-execution idempotent stock adjustments at the appropriate entity granularity.
   * Authentication and authorization for admin operations.

---

## 12. Fake Order & COD Abuse Mitigation Policy

To minimize losses from fraudulent or prank COD orders without harming legitimate conversion rates, Pure Haven BD implements a layered defensive approach:

1. **Layer 1 (Rate Limiting):** Strict client and IP rate limiting on checkout endpoints (retained from Phase 1).
2. **Layer 2 (Atomic Stock Reservation):** Concurrency-safe inventory reservations prevent inventory locking exploits.
3. **Layer 3 (Prepaid Evidence Expiry):** Strict 15-minute payment-evidence submission timer on manual prepaid orders.
4. **Layer 4 (Operational Verification for COD V1):** All V1 COD orders require phone confirmation before moving to `CONFIRMED`.
5. **Layer 5 (Attribution Tracking):** Accurate recording of customer-attributable vs non-customer-attributable fulfillment failures on lifecycle records.
6. **Layer 6 (Targeted Restrictions):** Confirmed abusive profiles are restricted to prepaid payments (`COD_RESTRICTED`), subject to administrative audit.

*Broad, automated, permanent customer blacklisting is explicitly prohibited in Package 1.*

---

## 13. Future Payment Gateway Roadmap

Actual payment gateway API integrations (e.g. bKash merchant gateway, Nagad direct API, SSLCommerz) are scheduled for later phases according to the master roadmap:

* **Phase 2 (Current):** Gateway-ready order, payment, refund, and inventory state architecture.
* **Phase 3:** Canonical customer identity, authentication migration, and phone verification.
* **Phase 4:** Durable PostgreSQL schema migrations and payment transaction ledger tables.
* **Phase 9:** Payment gateway API integration and automated checkout redirection.
* **Phase 11:** Gateway webhook, idempotency, failure recovery, and reconciliation testing.
* **Phase 12:** Production credentials, live reconciliation, and launch hardening.

*Rule: Future automated gateway callbacks and webhooks will be verified strictly server-to-server. Client-side browser redirect landing pages will never be treated as authoritative payment proof.*

---

## 14. Phase 2 Implementation Roadmap & Package Boundaries

Package 1 is the **Design and State-Architecture** package. Approved Phase-2 implementation requirements derived from this Package 1 design are allocated across the subsequent Phase-2 implementation packages according to the approved six-package structure:

1. **Package 1 — Order / Payment / Return / Inventory Design:** (Current Design Specification Lock).
2. **Package 2 — Order Data Integrity:** Schema foundations, exact variant preservation (`variantId`), state machine enforcement, and cancellation attribution.
3. **Package 3 — Inventory Integrity:** Concurrency-safe atomic allocation, multi-granularity idempotent restoration, and restock assessment rules.
4. **Package 4 — Payment Workflow & Reconciliation:** Payment state machine, manual bKash/Nagad verification flows, 15-minute customer submission timers, rejected evidence resolution paths, and COD settlement decoupling.
5. **Package 5 — Money & Order-ID Integrity:**
   - Safe monetary representation: review and correction of Float money precision risks (technical choice of Decimal vs integer minor-units determined in Package-5 implementation planning).
   - Calculation integrity for subtotal, delivery fee, and grand total.
   - Rounding consistency across line items and order totals.
   - Accounting separation between Customer Delivery Fee and Merchant Courier Cost.
   - Robust order-ID generation with collision prevention and handling.
   - Regression test suite for monetary calculations and unique order identifiers.
6. **Package 6 — Integration Verification & Phase-2 Lock:** Comprehensive automated integration testing, edge-case validation, and Phase-2 sign-off.

*(Note: Sub-packages may be inserted as needed during implementation).*

### Explicitly Excluded from Phase 2
- **No Customer Authentication Migration:** Customer login/auth remains in JSON for Phase 3.
- **No SMS / OTP Provider Integration:** Deferred to Phase 3.
- **No Payment Gateway API Integrations:** Deferred to Phase 9.
- **No Third-Party Courier API Integrations:** Courier automation deferred to later phases.
- **No UI Overhauls or Redesigns:** Phase 2 focuses strictly on data integrity, state machines, and backend business logic.
- **No Unrelated Database Cleanup:** Existing schema tables must remain backwards-compatible.

---

## 15. Acceptance & Testing Principles

Prior to completion of the relevant Phase 2 implementation packages and final Phase-2 lock, automated test suites must validate the following scenarios:

1. **Final-Unit Concurrency:** Two concurrent purchase requests for the last remaining unit of an item result in exactly 1 successful order and 1 out-of-stock rejection (stock must not drop below 0).
2. **Exact Variant Traceability:** An ordered product variant maintains its exact variant reference/ID throughout its lifecycle.
3. **Server-Side State Machine Integrity:** Attempting illegal state jumps (e.g. `DELIVERED` → `PROCESSING`, `SHIPPED` → `CANCELLED`) returns an appropriate 4xx error response.
4. **Courier Handoff Cancellation Gate:** Orders in `PENDING`, `CONFIRMED`, or pre-handoff `PROCESSING` can be cancelled; orders in `SHIPPED` or `OUT_FOR_DELIVERY` reject cancellation.
5. **Idempotent Stock Restoration:** Restoring inventory for an order, line item, or variant restores stock exactly once, preventing double-restock across multiple calls.
6. **Variant Stock Restoration:** Cancelling a variant order increments `ProductVariant.stock` accurately.
7. **Delivery Failure Non-Restock:** Transitioning to `DELIVERY_FAILED` or `RETURN_IN_TRANSIT` does not restore stock.
8. **Return Received Restock Decision:** Items marked `RETURN_RECEIVED` require explicit restock action; damaged/opened items do not re-enter sellable inventory.
9. **Partial-Item Returns:** Return and restock workflows support item-level and variant-level adjustments without forcing whole-order returns.
10. **Prepaid Confirmation Gate:** Prepaid orders cannot be confirmed until payment status is `PAID`.
11. **15-Minute Prepaid Customer Submission Expiry:** Manual prepaid orders without submitted payment evidence within 15 minutes expire and release inventory exactly once.
12. **Verification-Pending Reservation Hold:** Submitting payment evidence within 15 minutes sets status to `VERIFICATION_PENDING` and preserves the inventory reservation regardless of when admin review occurs.
13. **Rejected Evidence Resolution:** Payment evidence rejected after the 15-minute window transitions to an operational resolution / cancellation path releasing inventory exactly once (routing to `REFUND_REQUIRED` if funds were received).
14. **Late Payment Handling:** Payments submitted after reservation expiry route to `REFUND_REQUIRED` rather than reviving or reclaiming inventory.
15. **COD Settlement Decoupling:** Marking a COD order `DELIVERED` leaves COD settlement as `PENDING`.
16. **Refund & Inventory Independence:** Issuing a refund does not alter stock; restocking an item does not trigger automated refund.
17. **Money & Order-ID Integrity:** Monetary calculations maintain precision and rounding consistency; order-ID generation guarantees uniqueness under concurrency.
18. **Phase 1 Security Regression:** All existing locked protections remain intact, including admin authentication/session protections, payment-status authorization, server-authoritative payment state, abuse/rate limiting, recovery enumeration protections, and the existing Phase-1 security regression suite.

---

## 16. Specification Self-Review & Integrity Sign-Off

- [x] **No Placeholders:** Contains zero `TODO`, `TBD`, or placeholder values.
- [x] **Zero Contradictions:** All state transitions, invariants, and boundaries are logically consistent.
- [x] **No Scope Creep:** Customer-auth migration, OTP integrations, and gateway APIs are clearly isolated to Phase 3/4/9.
- [x] **Delivered != Paid / Settled:** COD settlement and prepaid invariants explicitly prevent conflation of delivery and payment.
- [x] **Returned != Restocked:** Beauty and skincare restock safety criteria explicitly prevent automatic restocking of returned cosmetics.
- [x] **Cancelled / Returned != High Risk:** Attribution rules protect customers from merchant/courier/stockout faults.
- [x] **Financial Integrity:** Monetary values, delivery fees, and merchant costs are decoupled. Safe money representation and Order-ID integrity locked in Package 5 scope.
- [x] **Prepaid Deadline & Rejected Evidence Semantics:** Correctly distinguishes 15-minute customer submission from admin verification, with clear resolution paths for rejected evidence.
- [x] **No Reactivation of Expired Reservations:** Expired reservations never steal stock or revive upon late payment.
- [x] **Restoration Granularity:** Business invariant locked for multi-granularity (order, item, variant, return) idempotent restoration.
- [x] **Roadmap Fidelity:** Preserves the six-package Phase-2 implementation structure.
