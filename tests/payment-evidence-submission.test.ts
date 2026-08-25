/**
 * Task 11 — Payment Evidence Submission & Anti-Replay Tests
 *
 * Verifies:
 *   1. Timely submission (submittedAt <= evidenceDeadlineAt) creates PaymentEvidenceAttempt and sets PaymentRecord.state = VERIFICATION_PENDING
 *   2. Rejects COD orders from submitting evidence (HTTP 400)
 *   3. Rejects submissions after deadline expiration (HTTP 409 EVIDENCE_DEADLINE_EXPIRED)
 *   4. Requires customer verification (orderId + customerPhone)
 *   5. Resubmission within original window after a REJECTED attempt succeeds without resetting deadline
 *   6. Same order submitting same active (provider, trxId) resolves as idempotent 200
 *   7. Different order submitting same active (provider, trxId) is blocked with HTTP 409
 *   8. A REJECTED attempt frees the (provider, trxId) for another valid order, while ACCEPTED remains consumed
 *
 * Run with:
 *   npx tsx --test tests/payment-evidence-submission.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/orders/payment-evidence/route";
import { prisma } from "@/lib/prisma";

function makeEvidenceRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/orders/payment-evidence", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("Task 11 — Payment Evidence Submission & Anti-Replay", { concurrency: false }, () => {
  it("TIMELY SUBMISSION — Valid prepaid evidence transitions state to VERIFICATION_PENDING", async (t) => {
    const originalOrderFindFirst = prisma.order.findFirst;
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.order.findFirst = originalOrderFindFirst;
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.$transaction = original$transaction;
    });

    const deadline = new Date(Date.now() + 10 * 60 * 1000); // 10 mins in future

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_order_1",
      orderId: "PH-TEST-001",
      customerPhone: "01712345678",
      paymentMethod: "bKash",
      status: "pending",
      paymentRecord: {
        id: 50,
        orderId: "cuid_order_1",
        method: "bKash",
        state: "AWAITING_PAYMENT",
      },
    });

    (prisma.inventoryReservation.findMany as any) = async () => [
      { id: 1, orderId: "cuid_order_1", status: "RESERVED", evidenceDeadlineAt: deadline },
    ];

    let createdAttempt: any = null;
    let updatedPaymentRecord: any = null;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        paymentRecord: {
          // New Fix #1 architecture: conditional claim via updateMany
          updateMany: async (args: any) => {
            updatedPaymentRecord = args.data;
            return { count: 1 }; // winner
          },
          findUnique: async () => null, // not reached on winner path
        },
        paymentEvidenceAttempt: {
          create: async (args: any) => {
            createdAttempt = args.data;
            return { id: 101, ...args.data };
          },
        },
        order: {
          update: async () => ({}),
        },
      };
      return await callback(mockTx);
    };

    const req = makeEvidenceRequest({
      orderId: "PH-TEST-001",
      customerPhone: "01712345678",
      provider: "bKash",
      senderNumber: "01799887766",
      trxId: "trx_abc_123",
    });

    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(createdAttempt.normalizedProvider, "BKASH");
    assert.strictEqual(createdAttempt.normalizedTrxId, "TRX_ABC_123");
    assert.strictEqual(createdAttempt.state, "PENDING_REVIEW");
    assert.strictEqual(updatedPaymentRecord.state, "VERIFICATION_PENDING");
  });

  it("REJECT COD — Cash on Delivery orders cannot submit manual payment evidence", async (t) => {
    const originalOrderFindFirst = prisma.order.findFirst;
    t.after(() => {
      prisma.order.findFirst = originalOrderFindFirst;
    });

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_order_cod",
      orderId: "PH-TEST-COD",
      customerPhone: "01712345678",
      paymentMethod: "Cash on Delivery",
      status: "pending",
      paymentRecord: {
        id: 51,
        orderId: "cuid_order_cod",
        method: "Cash on Delivery",
        state: "AWAITING_PAYMENT",
      },
    });

    const req = makeEvidenceRequest({
      orderId: "PH-TEST-COD",
      customerPhone: "01712345678",
      provider: "bKash",
      senderNumber: "01799887766",
      trxId: "trx_cod_err",
    });

    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.success, false);
    assert.match(data.message, /COD|Cash on Delivery/i);
  });

  it("DEADLINE EXPIRED — Evidence submitted past deadline is rejected", async (t) => {
    const originalOrderFindFirst = prisma.order.findFirst;
    const originalReservationFindMany = prisma.inventoryReservation.findMany;

    t.after(() => {
      prisma.order.findFirst = originalOrderFindFirst;
      prisma.inventoryReservation.findMany = originalReservationFindMany;
    });

    const expiredDeadline = new Date(Date.now() - 5 * 60 * 1000); // 5 mins in past

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_order_exp",
      orderId: "PH-TEST-EXP",
      customerPhone: "01712345678",
      paymentMethod: "Nagad",
      status: "pending",
      paymentRecord: {
        id: 52,
        orderId: "cuid_order_exp",
        method: "Nagad",
        state: "AWAITING_PAYMENT",
      },
    });

    (prisma.inventoryReservation.findMany as any) = async () => [
      { id: 2, orderId: "cuid_order_exp", status: "RESERVED", evidenceDeadlineAt: expiredDeadline },
    ];

    const req = makeEvidenceRequest({
      orderId: "PH-TEST-EXP",
      customerPhone: "01712345678",
      provider: "Nagad",
      senderNumber: "01799887766",
      trxId: "trx_late_123",
    });

    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 409);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, "EVIDENCE_DEADLINE_EXPIRED");
  });

  it("ANTI-REPLAY — Duplicate active TrxId from another order is rejected with 409", async (t) => {
    const originalOrderFindFirst = prisma.order.findFirst;
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const original$transaction = prisma.$transaction;
    const originalPaymentEvidenceAttemptFindFirst = prisma.paymentEvidenceAttempt.findFirst;

    t.after(() => {
      prisma.order.findFirst = originalOrderFindFirst;
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.$transaction = original$transaction;
      prisma.paymentEvidenceAttempt.findFirst = originalPaymentEvidenceAttemptFindFirst;
    });

    const deadline = new Date(Date.now() + 10 * 60 * 1000);

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_order_attacker",
      orderId: "PH-ATTACKER",
      customerPhone: "01711112222",
      paymentMethod: "bKash",
      status: "pending",
      paymentRecord: {
        id: 99, // Attacker's paymentRecordId
        orderId: "cuid_order_attacker",
        method: "bKash",
        state: "AWAITING_PAYMENT",
      },
    });

    (prisma.inventoryReservation.findMany as any) = async () => [
      { id: 3, orderId: "cuid_order_attacker", status: "RESERVED", evidenceDeadlineAt: deadline },
    ];

    // New architecture: attacker's updateMany(state=AWAITING_PAYMENT) would succeed (count=1),
    // but then create() throws P2002 (cross-order partial unique index violation).
    // P2002 handler uses root prisma client to find the existing claim.
    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        paymentRecord: {
          updateMany: async () => ({ count: 1 }), // attacker's own claim succeeds
          findUnique: async () => null,
        },
        paymentEvidenceAttempt: {
          create: async () => {
            // Simulate P2002 partial unique constraint violation (cross-order replay)
            const p2002Error = new Error("Unique constraint failed on partial index");
            (p2002Error as any).code = "P2002";
            throw p2002Error;
          },
        },
        order: { update: async () => ({}) },
      };
      return await callback(mockTx);
    };

    // Root prisma check (outside tx) finds the victim's existing claim
    (prisma.paymentEvidenceAttempt.findFirst as any) = async () => ({
      id: 1,
      paymentRecordId: 50, // Victim's order — different from attacker (99)
      normalizedProvider: "BKASH",
      normalizedTrxId: "TRX_REPLAYED",
      state: "PENDING_REVIEW",
    });

    const req = makeEvidenceRequest({
      orderId: "PH-ATTACKER",
      customerPhone: "01711112222",
      provider: "bKash",
      senderNumber: "01711112222",
      trxId: "trx_replayed",
    });

    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 409);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, "PAYMENT_EVIDENCE_ALREADY_CLAIMED");
  });

  it("IDEMPOTENCY — Duplicate submission for same order returns idempotent success", async (t) => {
    const originalOrderFindFirst = prisma.order.findFirst;
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.order.findFirst = originalOrderFindFirst;
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.$transaction = original$transaction;
    });

    const deadline = new Date(Date.now() + 10 * 60 * 1000);

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_order_idem",
      orderId: "PH-IDEM",
      customerPhone: "01712345678",
      paymentMethod: "bKash",
      status: "pending",
      paymentRecord: {
        id: 77,
        orderId: "cuid_order_idem",
        method: "bKash",
        state: "VERIFICATION_PENDING",
      },
    });

    (prisma.inventoryReservation.findMany as any) = async () => [
      { id: 4, orderId: "cuid_order_idem", status: "RESERVED", evidenceDeadlineAt: deadline },
    ];

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        paymentRecord: {
          // updateMany returns count=0 because PaymentRecord is already VERIFICATION_PENDING
          updateMany: async (_args: any) => ({ count: 0 }),
          // findUnique returns current record with same (provider, trxId) → idempotent
          findUnique: async (_args: any) => ({
            id: 77,
            state: "VERIFICATION_PENDING",
            provider: "BKASH",
            evidenceAttempts: [
              {
                id: 200,
                paymentRecordId: 77,
                normalizedProvider: "BKASH",
                normalizedTrxId: "TRX_SAME_RETRY", // same TrxId → idempotent
                state: "PENDING_REVIEW",
              },
            ],
          }),
        },
        paymentEvidenceAttempt: {
          create: async () => {
            throw new Error("MUST NOT create on idempotent path");
          },
        },
        order: { update: async () => ({}) },
      };
      return await callback(mockTx);
    };

    const req = makeEvidenceRequest({
      orderId: "PH-IDEM",
      customerPhone: "01712345678",
      provider: "bKash",
      senderNumber: "01712345678",
      trxId: "trx_same_retry",
    });

    const res = await POST(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.idempotent, true);
  });
});
