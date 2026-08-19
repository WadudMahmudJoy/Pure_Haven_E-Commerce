/**
 * Order State Machine Unit Tests (Task 2.2 RED)
 *
 * Tests the pure server-authoritative state machine logic in lib/orderLifecycle.ts:
 *   - Approved forward lifecycle (pending -> confirmed -> processing -> shipped -> out_for_delivery -> delivered)
 *   - Approved failed-delivery return flow (out_for_delivery -> delivery_failed -> return_in_transit -> return_received)
 *   - Cancellation boundary (pre-dispatch cancellation allowed; post-dispatch forbidden)
 *   - Terminal state locks (delivered, cancelled, return_received)
 *   - Forbidden reverse transitions and illegal jumps
 *   - Status and reason normalization
 *   - Reason requirements (reason "other" requires non-empty note)
 *   - Same-state no-op detection
 *
 * Run with:
 *   npx tsx --test tests/order-state-machine.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_STATUSES,
  CANCELLATION_REASONS,
  DELIVERY_FAILURE_REASONS,
  normalizeOrderStatus,
  normalizeCancellationReason,
  normalizeDeliveryFailureReason,
  getAllowedNextStatuses,
  canCancelOrder,
  validateOrderTransition,
  type OrderStatus,
  type CancellationReason,
  type DeliveryFailureReason,
} from "../lib/orderLifecycle";

test("CONSTANTS — ORDER_STATUSES contains all 10 approved statuses", () => {
  const expected: OrderStatus[] = [
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
  assert.deepStrictEqual([...ORDER_STATUSES], expected);
});

test("CONSTANTS — CANCELLATION_REASONS contains all 8 approved reasons", () => {
  const expected: CancellationReason[] = [
    "customer_requested",
    "customer_unreachable",
    "invalid_contact",
    "suspected_fake_order",
    "merchant_stockout",
    "merchant_error",
    "system_timeout",
    "other",
  ];
  assert.deepStrictEqual([...CANCELLATION_REASONS], expected);
});

test("CONSTANTS — DELIVERY_FAILURE_REASONS contains all 6 approved reasons", () => {
  const expected: DeliveryFailureReason[] = [
    "customer_unreachable",
    "customer_refused",
    "invalid_address",
    "courier_failure",
    "courier_damage",
    "other",
  ];
  assert.deepStrictEqual([...DELIVERY_FAILURE_REASONS], expected);
});

test("NORMALIZATION — normalizeOrderStatus handles case, whitespace, and rejects invalid strings", () => {
  assert.strictEqual(normalizeOrderStatus("pending"), "pending");
  assert.strictEqual(normalizeOrderStatus("  CONFIRMED  "), "confirmed");
  assert.strictEqual(normalizeOrderStatus("Out_For_Delivery"), "out_for_delivery");
  assert.strictEqual(normalizeOrderStatus("return_in_transit"), "return_in_transit");
  assert.strictEqual(normalizeOrderStatus("UNKNOWN_STATUS"), null);
  assert.strictEqual(normalizeOrderStatus(""), null);
  assert.strictEqual(normalizeOrderStatus(null), null);
  assert.strictEqual(normalizeOrderStatus(undefined), null);
  assert.strictEqual(normalizeOrderStatus(123), null);
});

test("NORMALIZATION — normalizeCancellationReason handles case, whitespace, and rejects invalid strings", () => {
  assert.strictEqual(normalizeCancellationReason("customer_requested"), "customer_requested");
  assert.strictEqual(normalizeCancellationReason("  CUSTOMER_UNREACHABLE  "), "customer_unreachable");
  assert.strictEqual(normalizeCancellationReason("other"), "other");
  assert.strictEqual(normalizeCancellationReason("invalid_reason"), null);
  assert.strictEqual(normalizeCancellationReason(""), null);
  assert.strictEqual(normalizeCancellationReason(null), null);
});

test("NORMALIZATION — normalizeDeliveryFailureReason handles case, whitespace, and rejects invalid strings", () => {
  assert.strictEqual(normalizeDeliveryFailureReason("courier_failure"), "courier_failure");
  assert.strictEqual(normalizeDeliveryFailureReason("  CUSTOMER_REFUSED "), "customer_refused");
  assert.strictEqual(normalizeDeliveryFailureReason("other"), "other");
  assert.strictEqual(normalizeDeliveryFailureReason("invalid_reason"), null);
  assert.strictEqual(normalizeDeliveryFailureReason(""), null);
  assert.strictEqual(normalizeDeliveryFailureReason(null), null);
});

test("TRANSITIONS — Approved forward lifecycle transitions are allowed", () => {
  const forwardSteps: Array<[OrderStatus, OrderStatus]> = [
    ["pending", "confirmed"],
    ["confirmed", "processing"],
    ["processing", "shipped"],
    ["shipped", "out_for_delivery"],
    ["out_for_delivery", "delivered"],
  ];

  for (const [current, next] of forwardSteps) {
    const result = validateOrderTransition(current, next);
    assert.strictEqual(
      result.allowed,
      true,
      `Expected transition '${current}' -> '${next}' to be allowed`
    );
    assert.strictEqual((result as { noop: boolean }).noop, false);
  }
});

test("TRANSITIONS — Approved failed-delivery return flow transitions are allowed", () => {
  const returnSteps: Array<[OrderStatus, OrderStatus]> = [
    ["out_for_delivery", "delivery_failed"],
    ["delivery_failed", "return_in_transit"],
    ["return_in_transit", "return_received"],
  ];

  for (const [current, next] of returnSteps) {
    const result = validateOrderTransition(current, next);
    assert.strictEqual(
      result.allowed,
      true,
      `Expected transition '${current}' -> '${next}' to be allowed`
    );
    assert.strictEqual((result as { noop: boolean }).noop, false);
  }
});

test("TRANSITIONS — Pre-dispatch cancellations are allowed", () => {
  const cancelAllowed: OrderStatus[] = ["pending", "confirmed", "processing"];

  for (const current of cancelAllowed) {
    const result = validateOrderTransition(current, "cancelled");
    assert.strictEqual(
      result.allowed,
      true,
      `Expected cancellation from '${current}' to be allowed`
    );
    assert.strictEqual(canCancelOrder(current), true);
  }
});

test("TRANSITIONS — Post-dispatch cancellations are forbidden", () => {
  const cancelForbidden: OrderStatus[] = [
    "shipped",
    "out_for_delivery",
    "delivered",
    "delivery_failed",
    "return_in_transit",
    "return_received",
  ];

  for (const current of cancelForbidden) {
    const result = validateOrderTransition(current, "cancelled");
    assert.strictEqual(
      result.allowed,
      false,
      `Expected cancellation from '${current}' to be forbidden`
    );
    assert.strictEqual(canCancelOrder(current), false);
  }
});

test("TRANSITIONS — Reverse transitions and illegal jumps are forbidden", () => {
  const forbiddenTransitions: Array<[OrderStatus, OrderStatus]> = [
    ["delivered", "processing"],
    ["delivered", "pending"],
    ["cancelled", "pending"],
    ["cancelled", "confirmed"],
    ["pending", "delivered"],
    ["pending", "shipped"],
    ["return_received", "confirmed"],
    ["return_received", "delivered"],
    ["shipped", "confirmed"],
    ["shipped", "processing"],
    ["delivery_failed", "delivered"],
  ];

  for (const [current, next] of forbiddenTransitions) {
    const result = validateOrderTransition(current, next);
    assert.strictEqual(
      result.allowed,
      false,
      `Expected transition '${current}' -> '${next}' to be forbidden`
    );
  }
});

test("TRANSITIONS — Terminal states have zero allowed next statuses", () => {
  const terminalStatuses: OrderStatus[] = ["delivered", "cancelled", "return_received"];

  for (const status of terminalStatuses) {
    const allowedNext = getAllowedNextStatuses(status);
    assert.deepStrictEqual(
      [...allowedNext],
      [],
      `Expected terminal status '${status}' to have no allowed next statuses`
    );
  }
});

test("TRANSITIONS — Same-state transition is recognized as a valid no-op", () => {
  for (const status of ORDER_STATUSES) {
    const result = validateOrderTransition(status, status);
    assert.strictEqual(result.allowed, true, `Expected same-state '${status}' to be allowed`);
    assert.strictEqual((result as { noop: boolean }).noop, true, `Expected same-state '${status}' to be noop`);
  }
});
