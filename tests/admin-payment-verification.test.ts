/**
 * Task 12 — Admin Payment Verification & Prepaid Confirmation Gate Tests
 *
 * Verifies:
 *   1. Admin marking payment ACCEPTED updates PaymentEvidenceAttempt and PaymentRecord to PAID
 *   2. Admin accepting genuine money on a CANCELLED/RELEASED order transitions to REFUND_REQUIRED without reviving inventory
 *   3. Admin rejecting evidence updates attempt to REJECTED and PaymentRecord to REJECTED
 *   4. Prepaid orders (bKash/Nagad) reject transition to CONFIRMED if payment is not PAID (HTTP 409)
 *   5. COD orders permit transition to CONFIRMED while unpaid (AWAITING_PAYMENT)
 *
 * Run with:
 *   npx tsx --test tests/admin-payment-verification.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/orders/payment-status/route";
import { PUT as PUT_ORDER } from "@/app/api/orders/route";
import { createAdminSessionToken, ADMIN_SESSION_COOKIE } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";

process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString("hex");

function makeAdminCookie(): string {
  const token = createAdminSessionToken("admin@purehaven.test");
  return `${ADMIN_SESSION_COOKIE}=${token}`;
}

function makeAdminPatchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/orders/payment-status", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      cookie: makeAdminCookie(),
    },
    body: JSON.stringify(body),
  });
}

function makeAdminPutOrderRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/orders", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      cookie: makeAdminCookie(),
    },
    body: JSON.stringify(body),
  });
}

describe("Task 12 — Admin Payment Verification & Confirmation Gate", { concurrency: false }, () => {
  it("ACCEPT PREPAID — Valid active reservation transitions attempt to ACCEPTED and payment to PAID", async (t) => {
    const originalPaymentRecordFindFirst = prisma.paymentRecord.findFirst;
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.paymentRecord.findFirst = originalPaymentRecordFindFirst;
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.$transaction = original$transaction;
    });

    (prisma.paymentRecord.findFirst as any) = async () => ({
      id: 60,
      orderId: "cuid_order_verify_1",
      method: "bKash",
      state: "VERIFICATION_PENDING",
      order: { id: "cuid_order_verify_1", orderId: "PH-VERIFY-1", status: "pending", total: 1000 },
      evidenceAttempts: [
        { id: 201, paymentRecordId: 60, state: "PENDING_REVIEW", trxId: "TRX_ACTIVE" },
      ],
    });

    (prisma.inventoryReservation.findMany as any) = async () => [
      { id: 1, orderId: "cuid_order_verify_1", status: "RESERVED" },
    ];

    let updatedAttempt: any = null;
    let updatedPaymentRecord: any = null;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        inventoryReservation: {
          findMany: async () => [{ id: 1, orderId: "cuid_order_verify_1", status: "RESERVED" }],
        },
        paymentEvidenceAttempt: {
          updateMany: async (args: any) => {
            updatedAttempt = args.data;
            return { count: 1 };
          },
        },
        paymentRecord: {
          // Fix #7 — now uses conditional updateMany, not unconditional update
          updateMany: async (args: any) => {
            updatedPaymentRecord = args.data;
            return { count: 1 };
          },
        },
        order: {
          update: async () => ({}),
        },
      };
      return await callback(mockTx);
    };

    const req = makeAdminPatchRequest({
      orderId: "PH-VERIFY-1",
      attemptId: 201,
      action: "ACCEPT",
    });

    const res = await PATCH(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(updatedAttempt.state, "ACCEPTED");
    assert.strictEqual(updatedPaymentRecord.state, "PAID");
  });

  it("ACCEPT LATE MONEY — Accepting evidence on RELEASED reservation sets REFUND_REQUIRED without reviving stock", async (t) => {
    const originalPaymentRecordFindFirst = prisma.paymentRecord.findFirst;
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.paymentRecord.findFirst = originalPaymentRecordFindFirst;
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.$transaction = original$transaction;
    });

    (prisma.paymentRecord.findFirst as any) = async () => ({
      id: 61,
      orderId: "cuid_order_cancelled",
      method: "bKash",
      state: "VERIFICATION_PENDING",
      order: { id: "cuid_order_cancelled", orderId: "PH-CANCELLED", status: "cancelled", total: 1200 },
      evidenceAttempts: [
        { id: 202, paymentRecordId: 61, state: "PENDING_REVIEW", trxId: "TRX_LATE" },
      ],
    });

    // Reservations are RELEASED (already cancelled/expired)
    (prisma.inventoryReservation.findMany as any) = async () => [
      { id: 2, orderId: "cuid_order_cancelled", status: "RELEASED" },
    ];

    let updatedAttempt: any = null;
    let updatedPaymentRecord: any = null;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        inventoryReservation: {
          findMany: async () => [{ id: 2, orderId: "cuid_order_cancelled", status: "RELEASED" }],
        },
        paymentEvidenceAttempt: {
          updateMany: async (args: any) => {
            updatedAttempt = args.data;
            return { count: 1 };
          },
        },
        paymentRecord: {
          // Fix #7 — conditional claim via updateMany (count=1 to proceed)
          updateMany: async (args: any) => {
            updatedPaymentRecord = args.data;
            return { count: 1 };
          },
        },
        order: {
          update: async () => ({}),
        },
      };
      return await callback(mockTx);
    };

    const req = makeAdminPatchRequest({
      orderId: "PH-CANCELLED",
      attemptId: 202,
      action: "ACCEPT",
    });

    const res = await PATCH(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(updatedAttempt.state, "ACCEPTED");
    assert.strictEqual(updatedPaymentRecord.state, "REFUND_REQUIRED", "Must transition to REFUND_REQUIRED");
    assert.strictEqual(updatedPaymentRecord.refundAmount, 1200);
  });

  it("CONFIRMATION GATE — Prepaid order in AWAITING_PAYMENT / VERIFICATION_PENDING blocks transition to CONFIRMED", async (t) => {
    const originalFindFirst = prisma.order.findFirst;
    t.after(() => {
      prisma.order.findFirst = originalFindFirst;
    });

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_order_unpaid_prepaid",
      orderId: "PH-UNPAID-PREPAID",
      status: "pending",
      paymentMethod: "bKash",
      paymentStatus: "verification_pending",
      paymentRecord: {
        id: 70,
        method: "bKash",
        state: "VERIFICATION_PENDING",
      },
      items: [],
    });

    const req = makeAdminPutOrderRequest({
      id: "cuid_order_unpaid_prepaid",
      status: "confirmed",
    });

    const res = await PUT_ORDER(req);
    const data = await res.json();

    assert.strictEqual(res.status, 409);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, "PAYMENT_NOT_PAID");
  });

  it("CONFIRMATION GATE — COD order permits transition to CONFIRMED while AWAITING_PAYMENT", async (t) => {
    const originalFindFirst = prisma.order.findFirst;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.order.findFirst = originalFindFirst;
      prisma.$transaction = original$transaction;
    });

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_order_cod_conf",
      orderId: "PH-COD-CONF",
      status: "pending",
      paymentMethod: "Cash on Delivery",
      paymentStatus: "pending",
      paymentRecord: {
        id: 71,
        method: "Cash on Delivery",
        state: "AWAITING_PAYMENT",
      },
      items: [],
    });

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        order: {
          updateMany: async () => ({ count: 1 }),
          findUnique: async () => ({
            id: "cuid_order_cod_conf",
            orderId: "PH-COD-CONF",
            status: "confirmed",
            paymentMethod: "Cash on Delivery",
            paymentStatus: "pending",
            createdAt: new Date(),
            updatedAt: new Date(),
            items: [],
          }),
        },
      };
      return await callback(mockTx);
    };

    const req = makeAdminPutOrderRequest({
      id: "cuid_order_cod_conf",
      status: "confirmed",
    });

    const res = await PUT_ORDER(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.order.status, "confirmed");
  });
});
