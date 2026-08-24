/**
 * Money and Commerce Constants Behavioral Tests — Wave B (Task 3)
 *
 * Verifies:
 *   1. Server-authoritative delivery fee is 120 BDT
 *   2. Prepaid evidence deadline is 15 minutes
 *   3. Money normalization handles finite rounding to 2 decimal places
 *   4. Money normalization rejects NaN, Infinity, and non-finite values
 *   5. requireNonNegativeMoney rejects negative values and validates boundaries
 *   6. calculateOrderTotals accurately aggregates subtotal + fixed delivery fee
 *
 * Run with:
 *   npx tsx --test tests/money-and-constants.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DELIVERY_FEE,
  PREPAID_EVIDENCE_DEADLINE_MINUTES,
} from "@/lib/commerceConstants";
import {
  normalizeMoney,
  requireNonNegativeMoney,
  calculateOrderTotals,
} from "@/lib/money";

test("Task 3 — Commerce Constants Invariants", () => {
  assert.strictEqual(DEFAULT_DELIVERY_FEE, 120, "Authoritative delivery fee must be exactly 120 BDT");
  assert.strictEqual(PREPAID_EVIDENCE_DEADLINE_MINUTES, 15, "Authoritative prepaid deadline must be 15 minutes");
});

test("Task 3 — normalizeMoney Valid Values and Rounding", () => {
  assert.strictEqual(normalizeMoney(0), 0);
  assert.strictEqual(normalizeMoney(120), 120);
  assert.strictEqual(normalizeMoney(333.33), 333.33);
  assert.strictEqual(normalizeMoney(333.3333), 333.33);
  assert.strictEqual(normalizeMoney(333.33 * 3), 999.99);
  assert.strictEqual(normalizeMoney("120.50"), 120.5);
  assert.strictEqual(normalizeMoney("0.05"), 0.05);
});

test("Task 3 — normalizeMoney Non-Finite Rejections", () => {
  assert.throws(() => normalizeMoney(NaN), /must be a finite number/);
  assert.throws(() => normalizeMoney(Infinity), /must be a finite number/);
  assert.throws(() => normalizeMoney(-Infinity), /must be a finite number/);
  assert.throws(() => normalizeMoney("invalid"), /must be a finite number/);
  assert.throws(() => normalizeMoney(null), /must be a finite number/);
  assert.throws(() => normalizeMoney(undefined), /must be a finite number/);
});

test("Task 3 — requireNonNegativeMoney Validation", () => {
  assert.strictEqual(requireNonNegativeMoney(0), 0);
  assert.strictEqual(requireNonNegativeMoney(150.75), 150.75);
  assert.strictEqual(requireNonNegativeMoney("50.25"), 50.25);

  assert.throws(
    () => requireNonNegativeMoney(-0.01),
    /must be a non-negative finite number/
  );
  assert.throws(
    () => requireNonNegativeMoney(-100, "Price"),
    /Price must be a non-negative finite number/
  );
  assert.throws(() => requireNonNegativeMoney(NaN), /must be a non-negative finite number/);
});

test("Task 3 — calculateOrderTotals Aggregation", () => {
  const items = [
    { price: 250.5, quantity: 2 },
    { price: 99.99, quantity: 3 },
  ];
  // Subtotal = 501.00 + 299.97 = 800.97
  // Delivery Fee = 120
  // Total = 920.97
  const totals = calculateOrderTotals(items);

  assert.strictEqual(totals.subtotal, 800.97);
  assert.strictEqual(totals.deliveryFee, 120);
  assert.strictEqual(totals.total, 920.97);
});
