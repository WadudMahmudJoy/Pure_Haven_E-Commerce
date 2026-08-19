/**
 * Order UI Compatibility Tests (Task 2.3 RED)
 *
 * Verifies the UI presentation & decision helpers for:
 *   - Admin next-status derivation from server lifecycle rules
 *   - Cancellation reason & note validation
 *   - Delivery failure reason & note validation
 *   - Customer active-order classification semantics
 *   - Status display labels and fallbacks for all canonical statuses
 *   - Unknown/corrupt status resilience (safe display, zero allowed transitions)
 *
 * Run with:
 *   npx tsx --test tests/order-ui-compatibility.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER_STATUSES, type OrderStatus } from "../lib/orderLifecycle";
import {
  ACTIVE_ORDER_STATUSES,
  TERMINAL_ORDER_STATUSES,
  isOrderActive,
  getOrderStatusLabel,
  getAdminNextStatusOptions,
  validateCancellationInput,
  validateDeliveryFailureInput,
} from "../lib/orderPresentation";

test("CASE A — Admin available next statuses are derived from lifecycle rules", () => {
  assert.deepStrictEqual(getAdminNextStatusOptions("pending"), ["confirmed", "cancelled"]);
  assert.deepStrictEqual(getAdminNextStatusOptions("confirmed"), ["processing", "cancelled"]);
  assert.deepStrictEqual(getAdminNextStatusOptions("processing"), ["shipped", "cancelled"]);
  assert.deepStrictEqual(getAdminNextStatusOptions("shipped"), ["out_for_delivery"]);
  assert.deepStrictEqual(getAdminNextStatusOptions("out_for_delivery"), ["delivered", "delivery_failed"]);
  assert.deepStrictEqual(getAdminNextStatusOptions("delivery_failed"), ["return_in_transit"]);
  assert.deepStrictEqual(getAdminNextStatusOptions("return_in_transit"), ["return_received"]);
  assert.deepStrictEqual(getAdminNextStatusOptions("delivered"), []);
  assert.deepStrictEqual(getAdminNextStatusOptions("cancelled"), []);
  assert.deepStrictEqual(getAdminNextStatusOptions("return_received"), []);
});

test("CASE B — Cancellation UI requires selecting a valid cancellation reason", () => {
  // Empty / missing reason
  const emptyRes = validateCancellationInput("", null);
  assert.strictEqual(emptyRes.valid, false);

  // Unapproved reason string
  const invalidRes = validateCancellationInput("not_a_real_reason", null);
  assert.strictEqual(invalidRes.valid, false);

  // Valid standard reason without note
  const validRes = validateCancellationInput("customer_requested", null);
  assert.strictEqual(validRes.valid, true);
  if (validRes.valid) {
    assert.strictEqual(validRes.reason, "customer_requested");
    assert.strictEqual(validRes.note, null);
  }
});

test("CASE C — Cancellation reason 'other' requires non-empty note", () => {
  // 'other' with missing or whitespace note
  const missingNote = validateCancellationInput("other", "");
  assert.strictEqual(missingNote.valid, false);

  const whitespaceNote = validateCancellationInput("other", "    ");
  assert.strictEqual(whitespaceNote.valid, false);

  // 'other' with valid note
  const validNote = validateCancellationInput("other", "Customer requested hold beyond limit");
  assert.strictEqual(validNote.valid, true);
  if (validNote.valid) {
    assert.strictEqual(validNote.reason, "other");
    assert.strictEqual(validNote.note, "Customer requested hold beyond limit");
  }
});

test("CASE D — Delivery failure transition requires deliveryFailureReason", () => {
  // Empty / missing reason
  const emptyRes = validateDeliveryFailureInput("", null);
  assert.strictEqual(emptyRes.valid, false);

  // Invalid reason
  const invalidRes = validateDeliveryFailureInput("random_reason", null);
  assert.strictEqual(invalidRes.valid, false);

  // Valid reason
  const validRes = validateDeliveryFailureInput("customer_unreachable", null);
  assert.strictEqual(validRes.valid, true);
  if (validRes.valid) {
    assert.strictEqual(validRes.reason, "customer_unreachable");
    assert.strictEqual(validRes.note, null);
  }
});

test("CASE E — Delivery failure reason 'other' requires non-empty note", () => {
  // 'other' with missing / whitespace note
  const missingNote = validateDeliveryFailureInput("other", "");
  assert.strictEqual(missingNote.valid, false);

  const whitespaceNote = validateDeliveryFailureInput("other", "   \t\n  ");
  assert.strictEqual(whitespaceNote.valid, false);

  // 'other' with valid note
  const validNote = validateDeliveryFailureInput("other", "Courier vehicle breakdown");
  assert.strictEqual(validNote.valid, true);
  if (validNote.valid) {
    assert.strictEqual(validNote.reason, "other");
    assert.strictEqual(validNote.note, "Courier vehicle breakdown");
  }
});

test("CASE F — Customer active-status classification semantics", () => {
  const expectedActive: OrderStatus[] = [
    "pending",
    "confirmed",
    "processing",
    "shipped",
    "out_for_delivery",
    "delivery_failed",
    "return_in_transit",
  ];

  const expectedInactive: OrderStatus[] = [
    "delivered",
    "cancelled",
    "return_received",
  ];

  assert.deepStrictEqual([...ACTIVE_ORDER_STATUSES].sort(), [...expectedActive].sort());
  assert.deepStrictEqual([...TERMINAL_ORDER_STATUSES].sort(), [...expectedInactive].sort());

  for (const s of expectedActive) {
    assert.strictEqual(isOrderActive(s), true, `Status '${s}' must be active`);
  }

  for (const s of expectedInactive) {
    assert.strictEqual(isOrderActive(s), false, `Status '${s}' must be inactive`);
  }

  // Null, undefined, unknown strings are not active
  assert.strictEqual(isOrderActive(null), false);
  assert.strictEqual(isOrderActive(undefined), false);
  assert.strictEqual(isOrderActive("unknown_status"), false);
});

test("CASE G — Every canonical lifecycle status has a stable display label/fallback", () => {
  for (const s of ORDER_STATUSES) {
    const label = getOrderStatusLabel(s);
    assert.ok(label && typeof label === "string" && label.length > 0, `Status '${s}' must have a non-empty label`);
    assert.notStrictEqual(label.toLowerCase(), "unknown", `Canonical status '${s}' should not be labeled 'Unknown'`);
  }

  // Check specific key labels
  assert.strictEqual(getOrderStatusLabel("out_for_delivery"), "Out for Delivery");
  assert.strictEqual(getOrderStatusLabel("delivery_failed"), "Delivery Failed");
  assert.strictEqual(getOrderStatusLabel("return_in_transit"), "Return in Transit");
  assert.strictEqual(getOrderStatusLabel("return_received"), "Return Received");
});

test("CASE H — Unknown/legacy unexpected display status does not crash the UI and allows no transitions", () => {
  // Display label should be safe and non-crashing
  const label = getOrderStatusLabel("legacy_custom_unknown_status");
  assert.ok(typeof label === "string" && label.length > 0);

  // Transitions for unknown status must be empty (cannot mutate corrupt/unknown order)
  const nextOptions = getAdminNextStatusOptions("corrupt_or_legacy_state");
  assert.deepStrictEqual(nextOptions, []);
});
