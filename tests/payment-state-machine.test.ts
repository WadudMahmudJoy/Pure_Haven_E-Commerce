/**
 * Task 10 — Payment State Machine Tests
 *
 * Verifies:
 *   1. Canonical payment transition graph (AWAITING_PAYMENT -> VERIFICATION_PENDING -> PAID -> REFUND_REQUIRED -> REFUND_PROCESSING -> REFUNDED)
 *   2. Rejection of illegal forward jumps (e.g. AWAITING_PAYMENT -> PAID directly for prepaid, PAID -> REFUNDED directly)
 *   3. Rejection of reverse jumps (e.g. PAID -> AWAITING_PAYMENT, REFUNDED -> PAID)
 *   4. Same-state idempotency
 *   5. COD settlement transitions (PENDING -> SETTLED, PENDING -> DISPUTED, DISPUTED -> SETTLED, NOT_APPLICABLE cannot settle)
 *   6. Legacy payment status mapping
 *
 * Run with:
 *   npx tsx --test tests/payment-state-machine.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PAYMENT_STATES,
  COD_SETTLEMENT_STATES,
  validatePaymentTransition,
  validateCodSettlementTransition,
  mapLegacyPaymentStatus,
  mapCanonicalToLegacyStatus,
  normalizePaymentState,
  normalizeProvider,
  normalizeTrxId,
} from "@/lib/paymentService";

describe("Task 10 — Payment State Machine", () => {
  it("CONSTANTS — All 8 canonical payment states and 4 COD settlement states are defined", () => {
    assert.strictEqual(PAYMENT_STATES.length, 8);
    assert.ok(PAYMENT_STATES.includes("AWAITING_PAYMENT"));
    assert.ok(PAYMENT_STATES.includes("VERIFICATION_PENDING"));
    assert.ok(PAYMENT_STATES.includes("PAID"));
    assert.ok(PAYMENT_STATES.includes("REJECTED"));
    assert.ok(PAYMENT_STATES.includes("FAILED"));
    assert.ok(PAYMENT_STATES.includes("REFUND_REQUIRED"));
    assert.ok(PAYMENT_STATES.includes("REFUND_PROCESSING"));
    assert.ok(PAYMENT_STATES.includes("REFUNDED"));

    assert.strictEqual(COD_SETTLEMENT_STATES.length, 4);
    assert.ok(COD_SETTLEMENT_STATES.includes("NOT_APPLICABLE"));
    assert.ok(COD_SETTLEMENT_STATES.includes("PENDING"));
    assert.ok(COD_SETTLEMENT_STATES.includes("SETTLED"));
    assert.ok(COD_SETTLEMENT_STATES.includes("DISPUTED"));
  });

  it("VALIDATION — Normalizes payment states (case-insensitive & trimmed)", () => {
    assert.strictEqual(normalizePaymentState("awaiting_payment"), "AWAITING_PAYMENT");
    assert.strictEqual(normalizePaymentState("  PAID  "), "PAID");
    assert.strictEqual(normalizePaymentState("UNKNOWN_STATUS"), null);
    assert.strictEqual(normalizePaymentState(null), null);
  });

  it("TRANSITIONS — Allowed forward payment transitions succeed", () => {
    // Stage 1 -> Stage 2 evidence submitted
    assert.strictEqual(validatePaymentTransition("AWAITING_PAYMENT", "VERIFICATION_PENDING").allowed, true);
    // AWAITING_PAYMENT → PAID is NOT allowed via the generic transition graph.
    // COD delivery collection is handled by the explicit OUT_FOR_DELIVERY→DELIVERED
    // order lifecycle transition in the order route — not via this generic function.
    assert.strictEqual(validatePaymentTransition("AWAITING_PAYMENT", "PAID").allowed, false);
    // Admin accepts evidence
    assert.strictEqual(validatePaymentTransition("VERIFICATION_PENDING", "PAID").allowed, true);
    // Admin rejects evidence
    assert.strictEqual(validatePaymentTransition("VERIFICATION_PENDING", "REJECTED").allowed, true);
    // Admin accepts late evidence on released reservation
    assert.strictEqual(validatePaymentTransition("VERIFICATION_PENDING", "REFUND_REQUIRED").allowed, true);
    // Customer resubmits within original deadline
    assert.strictEqual(validatePaymentTransition("REJECTED", "VERIFICATION_PENDING").allowed, true);
    // Refund workflow
    assert.strictEqual(validatePaymentTransition("PAID", "REFUND_REQUIRED").allowed, true);
    assert.strictEqual(validatePaymentTransition("REFUND_REQUIRED", "REFUND_PROCESSING").allowed, true);
    assert.strictEqual(validatePaymentTransition("REFUND_PROCESSING", "REFUNDED").allowed, true);
  });

  it("TRANSITIONS — Same-state transition is a valid no-op", () => {
    for (const state of PAYMENT_STATES) {
      assert.strictEqual(validatePaymentTransition(state, state).allowed, true);
    }
  });

  it("TRANSITIONS — Illegal jumps and reverse transitions are forbidden", () => {
    // Jump straight to REFUNDED from PAID (must go through REFUND_REQUIRED and REFUND_PROCESSING)
    assert.strictEqual(validatePaymentTransition("PAID", "REFUNDED").allowed, false);
    // Reverse from REFUNDED to PAID
    assert.strictEqual(validatePaymentTransition("REFUNDED", "PAID").allowed, false);
    // Reverse from PAID to AWAITING_PAYMENT
    assert.strictEqual(validatePaymentTransition("PAID", "AWAITING_PAYMENT").allowed, false);
    // Reverse from VERIFICATION_PENDING to AWAITING_PAYMENT
    assert.strictEqual(validatePaymentTransition("VERIFICATION_PENDING", "AWAITING_PAYMENT").allowed, false);
    // Terminal REFUNDED has zero forward transitions
    assert.strictEqual(validatePaymentTransition("REFUNDED", "AWAITING_PAYMENT").allowed, false);
    assert.strictEqual(validatePaymentTransition("REFUNDED", "VERIFICATION_PENDING").allowed, false);
    // Prepaid direct-PAID bypass: AWAITING_PAYMENT → PAID is forbidden in generic transitions
    // (COD uses a dedicated order route handler, not this function)
    assert.strictEqual(validatePaymentTransition("AWAITING_PAYMENT", "PAID").allowed, false);
  });

  it("COD SETTLEMENT — Valid transitions and forbidden transitions", () => {
    assert.strictEqual(validateCodSettlementTransition("PENDING", "SETTLED").allowed, true);
    assert.strictEqual(validateCodSettlementTransition("PENDING", "DISPUTED").allowed, true);
    assert.strictEqual(validateCodSettlementTransition("DISPUTED", "SETTLED").allowed, true);
    assert.strictEqual(validateCodSettlementTransition("PENDING", "PENDING").allowed, true);

    // NOT_APPLICABLE (prepaid) cannot settle
    assert.strictEqual(validateCodSettlementTransition("NOT_APPLICABLE", "SETTLED").allowed, false);
    assert.strictEqual(validateCodSettlementTransition("NOT_APPLICABLE", "PENDING").allowed, false);
    // SETTLED cannot revert to PENDING
    assert.strictEqual(validateCodSettlementTransition("SETTLED", "PENDING").allowed, false);
  });

  it("LEGACY MAPPING — Accurately translates historical order payment strings", () => {
    assert.strictEqual(mapLegacyPaymentStatus("pending"), "AWAITING_PAYMENT");
    assert.strictEqual(mapLegacyPaymentStatus("unpaid"), "AWAITING_PAYMENT");
    assert.strictEqual(mapLegacyPaymentStatus("awaiting_payment"), "AWAITING_PAYMENT");
    assert.strictEqual(mapLegacyPaymentStatus("verification_pending"), "VERIFICATION_PENDING");
    assert.strictEqual(mapLegacyPaymentStatus("verified"), "PAID");
    assert.strictEqual(mapLegacyPaymentStatus("paid"), "PAID");
    assert.strictEqual(mapLegacyPaymentStatus("rejected"), "REJECTED");
    assert.strictEqual(mapLegacyPaymentStatus("failed"), "FAILED");
    assert.strictEqual(mapLegacyPaymentStatus("refunded"), "REFUNDED");
    assert.strictEqual(mapLegacyPaymentStatus(""), "AWAITING_PAYMENT");
    assert.strictEqual(mapLegacyPaymentStatus(null), "AWAITING_PAYMENT");
  });

  it("LEGACY EXPORT — Maps canonical states to UI compatibility strings", () => {
    assert.strictEqual(mapCanonicalToLegacyStatus("AWAITING_PAYMENT"), "unpaid");
    assert.strictEqual(mapCanonicalToLegacyStatus("VERIFICATION_PENDING"), "verification_pending");
    assert.strictEqual(mapCanonicalToLegacyStatus("PAID"), "verified");
    assert.strictEqual(mapCanonicalToLegacyStatus("REJECTED"), "rejected");
    assert.strictEqual(mapCanonicalToLegacyStatus("REFUNDED"), "refunded");
  });

  it("NORMALIZATION — Providers and TrxIDs normalize cleanly", () => {
    assert.strictEqual(normalizeProvider("bkash"), "BKASH");
    assert.strictEqual(normalizeProvider("Nagad "), "NAGAD");
    assert.strictEqual(normalizeTrxId("  trx123abc  "), "TRX123ABC");
    assert.strictEqual(normalizeTrxId(""), null);
    assert.strictEqual(normalizeTrxId(null), null);
  });
});
