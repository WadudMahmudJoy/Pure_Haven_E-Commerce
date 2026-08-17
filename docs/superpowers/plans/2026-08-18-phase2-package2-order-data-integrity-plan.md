# Phase 2 Package 2 — Order Data Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use a disciplined
> task-by-task TDD workflow. Each task must complete RED → GREEN →
> focused verification → diff review → commit before the next task.

**Goal:** Implement exact order-item variant identity, a server-authoritative
fulfilment state machine, cancellation/delivery-failure audit evidence,
and minimal UI compatibility while preserving all Phase-1 protections.

**Architecture:** Keep order lifecycle rules in a focused pure shared module.
Persist only the minimum backward-compatible Order/OrderItem fields required
for Package 2. Routes remain server-authoritative; admin/customer UI only
reflects valid lifecycle operations.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma,
PostgreSQL/Neon, node:test via tsx, Windows PowerShell.

---

## Global Constraints & Implementation Boundaries

1. **Strict Roadmap Separation:**
   - **Package 2 Scope:** Order-item variant identity persistence, server fulfillment state machine, cancellation and delivery failure audit evidence capture, and functional UI synchronization.
   - **Package 3 (Deferred):** Concurrency-safe atomic stock allocation, exact variant inventory restoration on cancellation, restock inspection workflows, and inventory event ledger.
   - **Package 4 (Deferred):** Payment state machine transitions, bKash/Nagad verification timers, and COD settlement decoupling.
   - **Phase 3 (Deferred):** Customer authentication migration to PostgreSQL, OTP/SMS phone verification, and derived customer trust profiles.
   - **Phase 9 (Deferred):** Automated payment gateway API integrations.
   - **Phase 10+ (Deferred):** Third-party courier API integrations.
2. **Schema & Data Invariants:**
   - `OrderItem.variantId` is a standalone nullable integer (`Int?`) historical inventory reference without an enforced Prisma `@relation` or foreign key to `ProductVariant`. Catalog variants may later be modified or deleted without invalidating or cascading historical orders.
   - `OrderItem.variantLabel` is a historical text snapshot preserving the variant display label at the time of purchase.
   - Existing historical order items in PostgreSQL remain `variantId = null` and `variantLabel = null`. Do not guess, parse, or heuristically backfill historical records.
   - Cancellation audit evidence is recorded via direct nullable columns on `Order` (`cancelledBy`, `cancellationReason`, `cancellationNote`, `cancelledAt`). Do not add a duplicate `cancellationFault` column; customer-attributable vs neutral fault is derived from structured reason codes.
   - `cancelledBy` is server-authoritative. Requests to `PUT /api/orders` are admin-authenticated, recording `cancelledBy = "admin"`. Client-supplied actor fields are ignored.
   - Delivery failure evidence is recorded via direct nullable columns on `Order` (`deliveryFailureReason`, `deliveryFailureNote`, `deliveryFailedAt`).
   - Post-delivery returns do **not** alter `Order.status = delivered`. Post-delivery returns remain a separate attached lifecycle for later packages.
3. **Migration Strategy & Safety:**
   - Migrations must be strictly additive and separated by task.
   - **Task 2.1 Migration:** Adds `variantId` and `variantLabel` to `OrderItem`.
   - **Task 2.2 Migration:** Adds cancellation and delivery-failure audit columns to `Order`.
   - Migration SQL statements must use explicit `ADD COLUMN` statements without `IF NOT EXISTS` so unexpected schema drift is exposed rather than silently masked.
   - Adding nullable columns without defaults is intended as a backward-compatible additive migration, but PostgreSQL may acquire brief metadata/schema locks. Do not claim zero-downtime or lock-free migrations; migration directory paths and schema drift must be verified explicitly via structured PowerShell procedures.
4. **HTTP & API Invariants:**
   - `PUT /api/orders` requires valid admin authentication via `pure_haven_admin_session` cookie (returning 401 if missing/invalid).
   - Malformed or unknown requested target status: HTTP 400 Bad Request.
   - Persisted current status that cannot be normalized to a known `OrderStatus` (corrupt or unrecognized string): Fail closed with HTTP 409 Conflict. Do not default unknown current status to `"pending"`.
   - Known status but forbidden transition from current state: HTTP 409 Conflict.
   - Same-state update (`currentStatus === targetStatus`):
     - No lifecycle transition side effects.
     - Do not rewrite cancellation evidence.
     - Do not rewrite delivery-failure evidence.
     - Do not repeat cancellation stock side effects.
     - If the request is status-only and same-state, return the existing mapped order without executing a database write. If legitimate non-status updates (e.g. payment details) are present, perform the non-lifecycle update safely while preserving existing lifecycle audit fields.
   - New cancellation (`next === "cancelled"`): Requires an explicit, valid `cancellationReason` (HTTP 400 if missing/invalid). If `cancellationReason === "other"`, a non-empty `cancellationNote` is required (HTTP 400 if omitted).
   - Delivery failure (`next === "delivery_failed"`): Requires an explicit, valid `deliveryFailureReason` (HTTP 400 if missing/invalid). If `deliveryFailureReason === "other"`, a non-empty `deliveryFailureNote` is required (HTTP 400 if omitted).
5. **No UI Overhauls & Controlled Verification:**
   - Admin UI (`app/admin/orders/page.tsx`) and Customer UI (`components/customer/CustomerDashboardClient.tsx`, `app/track-order/page.tsx`) receive strictly functional compatibility updates. No layout redesigns or arbitrary styling changes.
   - Browser verification must not mutate real customer orders. If state mutation is needed, use dedicated disposable test orders created specifically for verification.

---

## Task 2.1: Exact Variant Identity Persistence

### 1. Goal & Architectural Scope
Ensure every order placed for a product variant persists its exact `variantId` and `variantLabel` snapshot in PostgreSQL, while non-variant items cleanly persist `null`. Historical order items remain backward-compatible and readable with `null` variant fields across admin and customer serializers.

### 2. Files & Components
- **Prisma Schema:** [`prisma/schema.prisma`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/prisma/schema.prisma)
- **Migration:** `prisma/migrations/<resolved-timestamp>_add_order_item_variant_fields/migration.sql`
- **Order Creation API:** [`app/api/orders/route.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/app/api/orders/route.ts)
- **Customer Order API:** [`app/api/customer-orders/route.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/app/api/customer-orders/route.ts)
- **Test File:** [`tests/order-item-variant-persistence.test.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/tests/order-item-variant-persistence.test.ts)

### 3. Step-by-Step Implementation Workflow

#### Step 2.1.1: Write Failing Tests (RED)
- [ ] Create test file [`tests/order-item-variant-persistence.test.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/tests/order-item-variant-persistence.test.ts) using `node:test` and `node:assert/strict`.
- [ ] Intercept `prisma.$transaction` using the in-memory spy pattern established in Phase 1 (`tests/payment-status-creation.test.ts`) so handler tests run non-destructively.
- [ ] Implement test cases:
  - **Case 1 (Variant Order Persistence):** When `POST /api/orders` receives an item with a valid `variantId`, `tx.order.create` receives `{ variantId: <id>, variantLabel: "<label>", name: "...", price: <variantPrice>, image: "...", category: "...", quantity: ... }`.
  - **Case 2 (Variant Snapshot Derivation):** Verify `variantLabel` is derived authoritatively from `ProductVariant.label` on the server and client-supplied arbitrary prices/labels are ignored.
  - **Case 3 (Non-Variant Order):** When an item has no `variantId`, `tx.order.create` receives `{ variantId: null, variantLabel: null, name: product.name, price: product.price, ... }`.
  - **Case 4 (Serializer with Variant):** `mapOrder` in `app/api/orders/route.ts` serializes items containing `variantId` and `variantLabel`.
  - **Case 5 (Legacy Serializer Safety):** `mapOrder` in `app/api/orders/route.ts` and `app/api/customer-orders/route.ts` serializes historical items where `variantId: null` and `variantLabel: null` without runtime errors or dropped fields.
- [ ] Run the RED test command:
  ```powershell
  npx tsx --test tests/order-item-variant-persistence.test.ts
  ```
- [ ] **Expected RED Reason:** `OrderItem.create` in `POST /api/orders` discards `variantId` via destructuring (`{ variantId, ...item }`) at line 430, and `mapOrder` does not include `variantId` or `variantLabel` in its item mapping.

#### Step 2.1.2: Update Prisma Schema & Generate Additive Migration
- [ ] In [`prisma/schema.prisma`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/prisma/schema.prisma), update `model OrderItem`:
  ```prisma
  model OrderItem {
    id             Int     @id @default(autoincrement())
    orderId        String
    productId      Int?
    variantId      Int?
    variantLabel   String?
    name           String
    price          Float
    compareAtPrice Float?
    image          String
    category       String
    quantity       Int

    order          Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  }
  ```
- [ ] Execute PowerShell procedure to create the timestamped migration directory:
  ```powershell
  Get-ChildItem prisma/migrations -Directory | Sort-Object Name
  $migrationTimestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
  $migrationDir = "prisma/migrations/${migrationTimestamp}_add_order_item_variant_fields"
  New-Item -ItemType Directory -Path $migrationDir -Force
  Write-Host "Resolved migration path: $migrationDir"
  ```
- [ ] Create the additive migration SQL file `prisma/migrations/${migrationTimestamp}_add_order_item_variant_fields/migration.sql`:
  ```sql
  -- AlterTable OrderItem to add variantId and variantLabel
  ALTER TABLE "OrderItem" ADD COLUMN "variantId" INTEGER;
  ALTER TABLE "OrderItem" ADD COLUMN "variantLabel" TEXT;
  ```
- [ ] Run `npx prisma generate` to update the generated Prisma Client with the new `variantId` and `variantLabel` fields.

#### Step 2.1.3: Update Order Creation & Serialization Logic (GREEN)
- [ ] In [`app/api/orders/route.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/app/api/orders/route.ts):
  - In `POST /api/orders` inside the loop constructing `preparedItems`:
    ```typescript
    preparedItems.push({
      productId: product.id,
      variantId: variant ? variant.id : null,
      variantLabel: variant ? variant.label : null,
      name: itemName,
      price: moneyNumber(itemPrice),
      image: itemImage || "/uploads/placeholder-product.png",
      category: product.category || "Uncategorized",
      quantity: item.quantity,
    });
    ```
  - In `tx.order.create` (lines 429-432):
    ```typescript
    items: {
      create: preparedItems.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        variantLabel: item.variantLabel,
        name: item.name,
        price: item.price,
        image: item.image,
        category: item.category,
        quantity: item.quantity,
      })),
    },
    ```
  - In `mapOrder` (lines 93-150): update `items` signature and mapping to include `variantId: item.variantId ?? null` and `variantLabel: item.variantLabel ?? null`.
- [ ] In [`app/api/customer-orders/route.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/app/api/customer-orders/route.ts):
  - In `mapOrder` (lines 49-79): ensure `items` mapping preserves `variantId` and `variantLabel` when returning orders to customer dashboard.

#### Step 2.1.4: Verification & Gate Checks
- [ ] Re-run Task 2.1 test suite:
  ```powershell
  npx tsx --test tests/order-item-variant-persistence.test.ts
  ```
  *Must pass 100% (GREEN).*
- [ ] Run existing Phase 1 regression suites to ensure no unintended regressions:
  ```powershell
  npx tsx --test tests/payment-status-creation.test.ts tests/payment-status-auth.test.ts tests/payment-verification-data-mapping.test.ts
  ```
- [ ] Run TypeScript compile check:
  ```powershell
  npx tsc --noEmit
  ```
- [ ] Run git checks:
  ```powershell
  git diff --check
  git status --short
  ```

#### Step 2.1.5: Commit Boundary
- [ ] Commit Task 2.1 changes:
  ```powershell
  git add prisma/schema.prisma prisma/migrations/ app/api/orders/route.ts app/api/customer-orders/route.ts tests/order-item-variant-persistence.test.ts
  git commit -m "feat(orders): persist exact variant identity on order items"
  ```

---

## Task 2.2: Server Lifecycle & Audit Evidence

### 1. Goal & Architectural Scope
Establish a pure, server-authoritative fulfillment state machine in `lib/orderLifecycle.ts` modeling the full forward lifecycle, failed-delivery return flow, and pre-handoff cancellation gate. Persist cancellation and delivery-failure audit evidence in `Order` schema, and update `PUT /api/orders` to enforce transition validity and capture audit records.

### 2. Files & Components
- **Shared Module (New):** [`lib/orderLifecycle.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/lib/orderLifecycle.ts)
- **Prisma Schema:** [`prisma/schema.prisma`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/prisma/schema.prisma)
- **Migration:** `prisma/migrations/<resolved-timestamp>_add_order_lifecycle_audit_fields/migration.sql`
- **Order Update API:** [`app/api/orders/route.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/app/api/orders/route.ts)
- **Test Files:**
  - [`tests/order-state-machine.test.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/tests/order-state-machine.test.ts)
  - [`tests/order-status-transition-api.test.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/tests/order-status-transition-api.test.ts)

### 3. Step-by-Step Implementation Workflow

#### Step 2.2.1: Write Failing State Machine & API Tests (RED)
- [ ] Create [`tests/order-state-machine.test.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/tests/order-state-machine.test.ts) testing pure functions from `lib/orderLifecycle.ts`:
  - **Forward Lifecycle:** `pending -> confirmed -> processing -> shipped -> out_for_delivery -> delivered`.
  - **Cancellation Boundary:** `pending -> cancelled`, `confirmed -> cancelled`, `processing -> cancelled` allowed. `shipped -> cancelled`, `out_for_delivery -> cancelled`, `delivered -> cancelled` forbidden.
  - **Failed-Delivery Return Flow:** `out_for_delivery -> delivery_failed -> return_in_transit -> return_received`.
  - **Terminal State Locks:** `delivered`, `cancelled`, `return_received` have zero allowed next statuses.
  - **Forbidden Reverse / Illegal Jumps:** `delivered -> processing`, `cancelled -> pending`, `pending -> delivered`, `return_received -> confirmed`, `shipped -> confirmed` all rejected.
  - **Normalization & Validation:** Case-insensitive string normalization (`"PROCESSING"` -> `"processing"`), unrecognized strings -> `null`.
  - **Reason Code Validation:**
    - Cancellation reasons (`customer_requested`, `customer_unreachable`, `invalid_contact`, `suspected_fake_order`, `merchant_stockout`, `merchant_error`, `system_timeout`, `other`).
    - Delivery failure reasons (`customer_unreachable`, `customer_refused`, `invalid_address`, `courier_failure`, `courier_damage`, `other`).
    - Explicit validation requiring non-empty note when reason is `"other"`.
- [ ] Create [`tests/order-status-transition-api.test.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/tests/order-status-transition-api.test.ts) testing `PUT /api/orders`:
  - **Auth Guard:** Unauthenticated PUT returns 401.
  - **Unknown Target Status:** PUT with `status: "invalid_xyz"` returns HTTP 400 Bad Request.
  - **Corrupted / Unsupported Current Status:** When persisted order has an unnormalizable status (`"corrupted_status"`), fail closed with HTTP 409 Conflict and do not mutate order.
  - **Forbidden Transition:** Transitioning `shipped` order to `cancelled` returns HTTP 409 Conflict.
  - **Forbidden Reverse:** Transitioning `delivered` order to `processing` returns HTTP 409 Conflict.
  - **Status-Only Same-State No-Op:** Transitioning `delivered` to `delivered` (with no non-status updates) returns HTTP 200 without executing transactional write or rewriting audit evidence.
  - **Same-State With Non-Status Updates:** Transitioning `pending` to `pending` with updated `paymentDetails` updates payment fields without mutating lifecycle audit fields or repeating stock restoration.
  - **Cancellation Audit Capture:** Transitioning `confirmed` to `cancelled` with `{ cancellationReason: "customer_requested", cancellationNote: "Changed mind" }` persists `cancelledBy: "admin"`, `cancellationReason: "customer_requested"`, `cancellationNote: "Changed mind"`, and `cancelledAt: <now>`.
  - **Cancellation Missing Reason Guard:** Transitioning to `cancelled` without a valid `cancellationReason` returns HTTP 400.
  - **Cancellation "Other" Without Note Guard:** Transitioning to `cancelled` with `cancellationReason: "other"` and empty `cancellationNote` returns HTTP 400.
  - **Spoofed Actor Ignored:** Request passing `cancelledBy: "customer"` still records `cancelledBy: "admin"`.
  - **Repeated Cancelled Request:** Repeated request on an already `cancelled` order does not overwrite original `cancelledAt` or audit evidence.
  - **Delivery Failure Audit Capture:** Transitioning `out_for_delivery` to `delivery_failed` with `{ deliveryFailureReason: "customer_unreachable", deliveryFailureNote: "Phone switched off" }` records `deliveryFailureReason`, `deliveryFailureNote`, and `deliveryFailedAt`.
  - **Delivery Failure Missing Reason Guard:** Transitioning `out_for_delivery` to `delivery_failed` without `deliveryFailureReason` returns HTTP 400.
  - **Delivery Failure "Other" Without Note Guard:** Transitioning to `delivery_failed` with `deliveryFailureReason: "other"` and empty `deliveryFailureNote` returns HTTP 400.
- [ ] Run RED test commands:
  ```powershell
  npx tsx --test tests/order-state-machine.test.ts tests/order-status-transition-api.test.ts
  ```
- [ ] **Expected RED Reason:** `lib/orderLifecycle.ts` does not exist yet; `PUT /api/orders` accepts arbitrary status strings without validation, returns no 409s on corrupt current status or illegal transitions, and does not enforce audit reason requirements.

#### Step 2.2.2: Implement Pure Order Lifecycle Module
- [ ] Create [`lib/orderLifecycle.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/lib/orderLifecycle.ts):
  ```typescript
  export const ORDER_STATUSES = [
    "pending",
    "confirmed",
    "processing",
    "shipped",
    "out_for_delivery",
    "delivered",
    "cancelled",
    "delivery_failed",
    "return_in_transit",
    "return_received",
  ] as const;

  export type OrderStatus = (typeof ORDER_STATUSES)[number];

  export const CANCELLATION_REASONS = [
    "customer_requested",
    "customer_unreachable",
    "invalid_contact",
    "suspected_fake_order",
    "merchant_stockout",
    "merchant_error",
    "system_timeout",
    "other",
  ] as const;

  export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

  export const DELIVERY_FAILURE_REASONS = [
    "customer_unreachable",
    "customer_refused",
    "invalid_address",
    "courier_failure",
    "courier_damage",
    "other",
  ] as const;

  export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];

  export function normalizeOrderStatus(value: unknown): OrderStatus | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return (ORDER_STATUSES as readonly string[]).includes(normalized)
      ? (normalized as OrderStatus)
      : null;
  }

  export function normalizeCancellationReason(value: unknown): CancellationReason | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return (CANCELLATION_REASONS as readonly string[]).includes(normalized)
      ? (normalized as CancellationReason)
      : null;
  }

  export function normalizeDeliveryFailureReason(value: unknown): DeliveryFailureReason | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return (DELIVERY_FAILURE_REASONS as readonly string[]).includes(normalized)
      ? (normalized as DeliveryFailureReason)
      : null;
  }

  const TRANSITION_GRAPH: Record<OrderStatus, readonly OrderStatus[]> = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["processing", "cancelled"],
    processing: ["shipped", "cancelled"],
    shipped: ["out_for_delivery"],
    out_for_delivery: ["delivered", "delivery_failed"],
    delivery_failed: ["return_in_transit"],
    return_in_transit: ["return_received"],
    delivered: [],
    cancelled: [],
    return_received: [],
  };

  export function getAllowedNextStatuses(current: OrderStatus): readonly OrderStatus[] {
    return TRANSITION_GRAPH[current] ?? [];
  }

  export function canCancelOrder(current: OrderStatus): boolean {
    return TRANSITION_GRAPH[current]?.includes("cancelled") ?? false;
  }

  export function validateOrderTransition(
    current: OrderStatus,
    next: OrderStatus
  ):
    | { allowed: true; noop: boolean }
    | { allowed: false; reason: "unknown_status" | "forbidden_transition"; message: string } {
    if (current === next) {
      return { allowed: true, noop: true };
    }

    const allowedNext = TRANSITION_GRAPH[current];
    if (!allowedNext || !allowedNext.includes(next)) {
      return {
        allowed: false,
        reason: "forbidden_transition",
        message: `Cannot transition order status from '${current}' to '${next}'. Allowed next statuses: [${(allowedNext || []).join(", ")}].`,
      };
    }

    return { allowed: true, noop: false };
  }
  ```

#### Step 2.2.3: Update Prisma Schema & Generate Additive Migration
- [ ] In [`prisma/schema.prisma`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/prisma/schema.prisma), update `model Order`:
  ```prisma
  model Order {
    id                    String      @id @default(cuid())
    orderId               String      @unique
    customerName          String
    customerPhone         String
    customerCity          String
    customerAddress       String
    subtotal              Float
    deliveryFee           Float
    total                 Float
    status                String      @default("pending")
    paymentMethod         String      @default("Cash on Delivery")
    paymentStatus         String      @default("pending")
    paymentProvider       String?
    paymentSenderNumber   String?
    paymentTrxId          String?
    cancelledBy           String?
    cancellationReason    String?
    cancellationNote      String?
    cancelledAt           DateTime?
    deliveryFailureReason String?
    deliveryFailureNote   String?
    deliveryFailedAt      DateTime?
    createdAt             DateTime    @default(now())
    updatedAt             DateTime    @updatedAt
    items                 OrderItem[]
  }
  ```
- [ ] Execute PowerShell procedure to create the timestamped migration directory:
  ```powershell
  Get-ChildItem prisma/migrations -Directory | Sort-Object Name
  $migrationTimestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
  $migrationDir = "prisma/migrations/${migrationTimestamp}_add_order_lifecycle_audit_fields"
  New-Item -ItemType Directory -Path $migrationDir -Force
  Write-Host "Resolved migration path: $migrationDir"
  ```
- [ ] Create additive migration SQL file `prisma/migrations/${migrationTimestamp}_add_order_lifecycle_audit_fields/migration.sql`:
  ```sql
  -- AlterTable Order to add cancellation and delivery failure audit fields
  ALTER TABLE "Order" ADD COLUMN "cancelledBy" TEXT;
  ALTER TABLE "Order" ADD COLUMN "cancellationReason" TEXT;
  ALTER TABLE "Order" ADD COLUMN "cancellationNote" TEXT;
  ALTER TABLE "Order" ADD COLUMN "cancelledAt" TIMESTAMP(3);
  ALTER TABLE "Order" ADD COLUMN "deliveryFailureReason" TEXT;
  ALTER TABLE "Order" ADD COLUMN "deliveryFailureNote" TEXT;
  ALTER TABLE "Order" ADD COLUMN "deliveryFailedAt" TIMESTAMP(3);
  ```
- [ ] Run `npx prisma generate`.

#### Step 2.2.4: Integrate State Machine & Audit Capture in `PUT /api/orders` (GREEN)
- [ ] In [`app/api/orders/route.ts`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/app/api/orders/route.ts):
  - Import validators from `lib/orderLifecycle`:
    ```typescript
    import {
      normalizeOrderStatus,
      normalizeCancellationReason,
      normalizeDeliveryFailureReason,
      validateOrderTransition,
      type OrderStatus,
    } from "@/lib/orderLifecycle";
    ```
  - In `PUT /api/orders`:
    - Authenticate via `requireAdmin(req)`.
    - Check `id` and load `existing` order via `prisma.order.findFirst`.
    - Validate current persisted status:
      ```typescript
      const currentStatus = normalizeOrderStatus(existing.status);
      if (!currentStatus) {
        return NextResponse.json(
          {
            success: false,
            message: `Current order status '${existing.status}' is unrecognized. Cannot safely transition.`,
          },
          { status: 409 }
        );
      }
      ```
    - Resolve target status:
      ```typescript
      const requestedStatusRaw = body.status !== undefined ? normalizeString(body.status) : null;
      let targetStatus: OrderStatus = currentStatus;
      if (requestedStatusRaw !== null) {
        const normalizedTarget = normalizeOrderStatus(requestedStatusRaw);
        if (!normalizedTarget) {
          return NextResponse.json(
            { success: false, message: "Invalid order status." },
            { status: 400 }
          );
        }
        targetStatus = normalizedTarget;
      }
      ```
    - Validate transition:
      ```typescript
      const validation = validateOrderTransition(currentStatus, targetStatus);
      if (!validation.allowed) {
        return NextResponse.json(
          { success: false, message: validation.message },
          { status: 409 }
        );
      }
      ```
    - Handle new cancellation:
      ```typescript
      let cancellationFields = {};
      if (targetStatus === "cancelled" && currentStatus !== "cancelled") {
        const reason = normalizeCancellationReason(body.cancellationReason || body.reason);
        if (!reason) {
          return NextResponse.json(
            { success: false, message: "A valid cancellationReason is required to cancel an order." },
            { status: 400 }
          );
        }
        const note = normalizeString(body.cancellationNote);
        if (reason === "other" && !note) {
          return NextResponse.json(
            { success: false, message: "A non-empty cancellationNote is required when cancellationReason is 'other'." },
            { status: 400 }
          );
        }
        cancellationFields = {
          cancelledBy: "admin",
          cancellationReason: reason,
          cancellationNote: note || null,
          cancelledAt: new Date(),
        };
      }
      ```
    - Handle new delivery failure:
      ```typescript
      let deliveryFailureFields = {};
      if (targetStatus === "delivery_failed" && currentStatus !== "delivery_failed") {
        const reason = normalizeDeliveryFailureReason(body.deliveryFailureReason || body.reason);
        if (!reason) {
          return NextResponse.json(
            { success: false, message: "A valid deliveryFailureReason is required when delivery fails." },
            { status: 400 }
          );
        }
        const note = normalizeString(body.deliveryFailureNote);
        if (reason === "other" && !note) {
          return NextResponse.json(
            { success: false, message: "A non-empty deliveryFailureNote is required when deliveryFailureReason is 'other'." },
            { status: 400 }
          );
        }
        deliveryFailureFields = {
          deliveryFailureReason: reason,
          deliveryFailureNote: note || null,
          deliveryFailedAt: new Date(),
        };
      }
      ```
    - Check if the request is a status-only no-op:
      ```typescript
      const hasNonStatusUpdates =
        body.paymentMethod !== undefined ||
        body.paymentStatus !== undefined ||
        body.paymentDetails !== undefined;

      if (validation.noop && !hasNonStatusUpdates) {
        return NextResponse.json({
          success: true,
          message: "Order updated successfully.",
          order: mapOrder(existing),
        });
      }
      ```
    - Execute transactional update:
      - Apply status, payment fields, and newly populated audit fields without overwriting historical audit data if status did not change.
      - Maintain existing Package 1 cancellation stock increment (`currentStatus !== "cancelled" && targetStatus === "cancelled"`) without introducing variant restoration (deferred to Package 3).
  - In `mapOrder`: include cancellation and delivery-failure audit metadata in the serialized order DTO.

#### Step 2.2.5: Verification & Gate Checks
- [ ] Run state machine and transition API tests:
  ```powershell
  npx tsx --test tests/order-state-machine.test.ts tests/order-status-transition-api.test.ts
  ```
  *Must pass 100% (GREEN).*
- [ ] Run all test suites:
  ```powershell
  npx tsx --test `
    tests/order-item-variant-persistence.test.ts `
    tests/order-state-machine.test.ts `
    tests/order-status-transition-api.test.ts `
    tests/payment-status-creation.test.ts `
    tests/payment-status-auth.test.ts `
    tests/payment-verification-data-mapping.test.ts
  ```
- [ ] Run TypeScript compile check:
  ```powershell
  npx tsc --noEmit
  ```
- [ ] Run git checks:
  ```powershell
  git diff --check
  git status --short
  ```

#### Step 2.2.6: Commit Boundary
- [ ] Commit Task 2.2 changes:
  ```powershell
  git add lib/orderLifecycle.ts prisma/schema.prisma prisma/migrations/ app/api/orders/route.ts tests/order-state-machine.test.ts tests/order-status-transition-api.test.ts
  git commit -m "feat(orders): enforce fulfillment lifecycle and audit evidence"
  ```

---

## Task 2.3: Functional Order UI Compatibility & Package Gate

### 1. Goal & Architectural Scope
Synchronize the Admin Order Management UI (`app/admin/orders/page.tsx`) with the expanded fulfillment lifecycle and state-machine transitions, providing explicit inline reason selection for cancellation and delivery failure. Update Customer Dashboard and Order Tracking badges/filters to display new statuses cleanly without visual disruption.

### 2. Files & Components
- **Admin UI:** [`app/admin/orders/page.tsx`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/app/admin/orders/page.tsx)
- **Customer Dashboard:** [`components/customer/CustomerDashboardClient.tsx`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/components/customer/CustomerDashboardClient.tsx)
- **Order Tracker:** [`app/track-order/page.tsx`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/app/track-order/page.tsx)

### 3. Step-by-Step Implementation Workflow

#### Step 2.3.1: Admin Orders UI Synchronization
- [ ] In [`app/admin/orders/page.tsx`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/app/admin/orders/page.tsx):
  - Import `ORDER_STATUSES`, `CANCELLATION_REASONS`, `DELIVERY_FAILURE_REASONS`, `getAllowedNextStatuses`, `canCancelOrder` from `@/lib/orderLifecycle`.
  - Update `filterStatuses`:
    ```typescript
    const filterStatuses = [
      "all",
      "pending",
      "confirmed",
      "processing",
      "shipped",
      "out_for_delivery",
      "delivered",
      "cancelled",
      "delivery_failed",
      "return_in_transit",
      "return_received",
    ];
    ```
  - Update `canCancel(order)`: delegate directly to `canCancelOrder(currentStatus(order))`.
  - Update `nextStatusOptions(order)`: delegate to `getAllowedNextStatuses(currentStatus(order))`. If empty (terminal status), return `[status]`.
  - Update `statusBadgeClass(status)`:
    - `"pending"` -> amber / yellow
    - `"confirmed"` -> emerald / green
    - `"processing"` -> blue
    - `"shipped"` -> indigo
    - `"out_for_delivery"` -> purple
    - `"delivered"` -> green
    - `"cancelled"` -> red
    - `"delivery_failed"` -> rose / orange
    - `"return_in_transit"` -> amber
    - `"return_received"` -> slate / neutral
  - Update cancellation action:
    - When clicking "Cancel Order", expand an inline reason selector with an empty/unselected placeholder (`"Select a reason..."`) and options from `CANCELLATION_REASONS` (formatted human-readably).
    - Do not default to any reason; require an explicit admin selection.
    - If `"other"` is selected, display a required note input field.
    - Submitting cancellation sends `{ id, status: "cancelled", cancellationReason, cancellationNote }` to `PUT /api/orders`.
  - Update delivery failure action:
    - When an order is in `out_for_delivery`, allow transitioning to `delivery_failed` with an explicit reason selector (placeholder `"Select failure reason..."`, options from `DELIVERY_FAILURE_REASONS`).
    - If `"other"` is selected, require a non-empty note input field.
  - Update quick action buttons according to current status:
    - `pending` -> Confirm Order (`confirmed`)
    - `confirmed` -> Mark Processing (`processing`)
    - `processing` -> Mark Shipped (`shipped`)
    - `shipped` -> Mark Out for Delivery (`out_for_delivery`)
    - `out_for_delivery` -> Mark Delivered (`delivered`) or Mark Failed (`delivery_failed`)
    - `delivery_failed` -> Mark Return in Transit (`return_in_transit`)
    - `return_in_transit` -> Mark Return Received (`return_received`)
  - Display recorded cancellation or delivery-failure audit details in the order expanded card if present.

#### Step 2.3.2: Customer Viewport Synchronization
- [ ] In [`components/customer/CustomerDashboardClient.tsx`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/components/customer/CustomerDashboardClient.tsx):
  - In `statusClass(status)`: add cases for `shipped` (indigo), `out_for_delivery` (purple), `delivery_failed` (orange/red), `return_in_transit` (amber), `return_received` (slate).
  - In `stats` calculation: semantically align the active/unresolved orders count to include all in-flight non-terminal states:
    ```typescript
    const pending = orders.filter((order) =>
      [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "out_for_delivery",
        "delivery_failed",
        "return_in_transit",
      ].includes(String(order.status || "pending").toLowerCase())
    ).length;
    ```
    *(Excludes terminal outcomes: `delivered`, `cancelled`, `return_received`).*
- [ ] In [`app/track-order/page.tsx`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/app/track-order/page.tsx):
  - Update `statusBadge(status)` to map `shipped`, `out_for_delivery`, `delivery_failed`, `return_in_transit`, `return_received` to appropriate badge styles.

#### Step 2.3.3: Controlled Interactive Verification Plan
- [ ] Launch development server or test instance (`npm run dev`).
- [ ] **Safety Rule for Verification:** Do NOT mutate real or valuable customer orders. Create dedicated disposable non-variant test orders (since variant stock restoration is deferred to Package 3) and record their test IDs.
- [ ] **Admin UI Verification:**
  1. Open `/admin/orders` in browser.
  2. Inspect a dedicated test order in `pending`: Verify action buttons show "Confirm Order" and "Cancel Order". Verify dropdown shows only `["confirmed", "cancelled"]`.
  3. Advance test order to `confirmed` -> verify dropdown shows `["processing", "cancelled"]`.
  4. Advance test order to `processing` -> verify dropdown shows `["shipped", "cancelled"]`.
  5. Advance test order to `shipped` -> verify "Cancel Order" is NO LONGER visible/allowed. Verify dropdown shows only `["out_for_delivery"]`.
  6. Advance test order to `out_for_delivery` -> verify options for `delivered` and `delivery_failed`.
  7. On a separate test order, test `delivery_failed`: verify explicit reason selection is enforced (no default reason) and `"other"` requires a note.
  8. On another test order in `pending`, test cancellation: verify explicit reason selection is enforced (no default reason) and audit details appear on the card after cancellation.
- [ ] **Customer UI Verification:**
  1. Open `/customer/orders` and `/track-order`.
  2. Verify test orders in `shipped`, `out_for_delivery`, `delivery_failed`, `return_in_transit`, `return_received` render clean badges without layout defects.
  3. Verify dashboard statistics count active in-flight orders accurately (including in-transit return/failure states, excluding terminal states).

#### Step 2.3.4: Package 2 Comprehensive Final Gate
- [ ] Run newly created Package-2 test suites:
  ```powershell
  npx tsx --test `
    tests/order-item-variant-persistence.test.ts `
    tests/order-state-machine.test.ts `
    tests/order-status-transition-api.test.ts
  ```
  *(Record actual tests/pass count; must pass 100%).*
- [ ] Run locked Phase-1 60-test security regression suite:
  ```powershell
  npx tsx --test `
    tests/rate-limit-policy.test.ts `
    tests/rate-limiter.test.ts `
    tests/admin-auth-rate-limit.test.ts `
    tests/orders-rate-limit.test.ts `
    tests/admin-session-secret-security.test.ts `
    tests/admin-auth-security.test.ts `
    tests/payment-status-auth.test.ts `
    tests/payment-status-creation.test.ts
  ```
  *(Expected baseline: tests 60, pass 60, fail 0).*
- [ ] Run payment verification data mapping regression:
  ```powershell
  npx tsx --test tests/payment-verification-data-mapping.test.ts
  ```
  *(Expected baseline: 5 pass, 0 fail).*
- [ ] Run full TypeScript verification:
  ```powershell
  npx tsc --noEmit
  ```
- [ ] Run targeted ESLint on modified files:
  ```powershell
  npx eslint `
    lib/orderLifecycle.ts `
    app/api/orders/route.ts `
    app/api/customer-orders/route.ts `
    app/admin/orders/page.tsx `
    components/customer/CustomerDashboardClient.tsx `
    app/track-order/page.tsx
  ```
  *(Any newly introduced lint error/warning is a blocker. Pre-existing inherited lint debt must not trigger unrelated refactoring).*
- [ ] Run git diff whitespace and hygiene check:
  ```powershell
  git diff --check
  git status --short
  ```

#### Step 2.3.5: Commit Boundary
- [ ] Commit Task 2.3 changes:
  ```powershell
  git add app/admin/orders/page.tsx components/customer/CustomerDashboardClient.tsx app/track-order/page.tsx
  git commit -m "feat(admin): support expanded order fulfillment lifecycle"
  ```

---

## Plan Self-Review & Verification Matrix

| Check | Requirement | Verification in Plan |
| :--- | :--- | :--- |
| **1. Exact Variant Identity** | Persist `variantId` & `variantLabel`; no guessed backfills | Task 2.1 explicit in schema, creation loop, serializer, and tests. |
| **2. Migration Separation & Safety** | Task 2.1 and 2.2 separate; no `IF NOT EXISTS` | Separate migrations with explicit `ADD COLUMN` and PowerShell directory discovery. |
| **3. Pure State Machine** | `lib/orderLifecycle.ts` with no Next.js/Prisma/DB dependency | Task 2.2 implements pure helper with complete transition graph. |
| **4. Fail Closed on Corrupt Status** | Unrecognized current status -> 409 Conflict | Explicitly enforced in `PUT /api/orders` and tested with RED test. |
| **5. Same-State No-Op Semantics** | No duplicate audit/stock effects; non-status updates preserved | Explicitly specified and tested in Task 2.2. |
| **6. Explicit Audit Reasons** | No default reason selection; `"other"` requires note | Explicitly enforced on server and UI in Task 2.2 and 2.3. |
| **7. Cancellation Gate** | Cancel allowed only for `pending`, `confirmed`, `processing` | Enforced in state machine, API route, and Admin UI. |
| **8. Package 3 Boundary** | No variant stock restoration or concurrency allocation in Package 2 | Scope constraints explicitly exclude Package 3 logic. |
| **9. Post-Delivery Returns** | Post-delivery returns do NOT overwrite `delivered` | Explicitly preserved; returns are separate attached lifecycle. |
| **10. Active Orders Stat** | Include unresolved states; exclude terminal states | Semantically aligned in `CustomerDashboardClient.tsx`. |
| **11. Controlled Browser Mutation** | No mutation of real customer orders | Disposable test order protocol specified for browser verification. |
| **12. Test Commands & Lint Policy** | Separated commands, baseline counts, targeted ESLint | Clean commands and explicit lint blocker policy specified. |
