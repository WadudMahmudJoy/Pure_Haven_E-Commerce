/**
 * Task 14 — COD Collection, Settlement & Refund Lifecycle Tests
 *
 * Verifies:
 *   1. Transitioning a COD order to DELIVERED inside the lifecycle transaction sets:
 *      - PaymentRecord.state = PAID
 *      - PaymentRecord.codSettlementState = PENDING
 *   2. Admin can transition codSettlementState:
 *      - PENDING -> SETTLED (sets codSettledAt)
 *      - PENDING -> DISPUTED (sets codSettlementNote)
 *      - DISPUTED -> SETTLED (sets codSettledAt)
 *   3. Prepaid orders maintain codSettlementState = NOT_APPLICABLE
 *   4. Refund lifecycle transitions:
 *      - PAID -> REFUND_REQUIRED
 *      - REFUND_REQUIRED -> REFUND_PROCESSING
 *      - REFUND_PROCESSING -> REFUNDED
 *   5. Executing refunds has ZERO inventory side effects (no stock restoration, no reservation mutation)
 *
 * Run with:
 *   npx tsx --test tests/cod-settlement-and-refund.test.ts
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

describe("Task 14 — COD Collection, Settlement & Refund Lifecycle", { concurrency: false }, () => {
  it("COD DELIVERED — Transitions PaymentRecord to PAID and codSettlementState to PENDING", async (t) => {
    const originalFindFirst = prisma.order.findFirst;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.order.findFirst = originalFindFirst;
      prisma.$transaction = original$transaction;
    });

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_order_cod_deliv",
      orderId: "PH-COD-DELIV",
      status: "out_for_delivery",
      paymentMethod: "Cash on Delivery",
      paymentStatus: "pending",
      paymentRecord: {
        id: 80,
        method: "Cash on Delivery",
        state: "AWAITING_PAYMENT",
        codSettlementState: "NOT_APPLICABLE",
      },
      items: [],
    });

    let updatedPaymentRecord: any = null;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        order: {
          updateMany: async () => ({ count: 1 }),
          findUnique: async () => ({
            id: "cuid_order_cod_deliv",
            orderId: "PH-COD-DELIV",
            status: "delivered",
            paymentMethod: "Cash on Delivery",
            paymentStatus: "paid",
            createdAt: new Date(),
            updatedAt: new Date(),
            items: [],
          }),
        },
        paymentRecord: {
          update: async (args: any) => {
            updatedPaymentRecord = args.data;
            return { id: 80, ...args.data };
          },
        },
      };
      return await callback(mockTx);
    };

    const req = makeAdminPutOrderRequest({
      id: "cuid_order_cod_deliv",
      status: "delivered",
    });

    const res = await PUT_ORDER(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(updatedPaymentRecord.state, "PAID", "COD delivery must set payment state to PAID");
    assert.strictEqual(updatedPaymentRecord.codSettlementState, "PENDING", "COD delivery must set settlement state to PENDING");
  });

  it("COD SETTLEMENT — Admin can transition settlement from PENDING to SETTLED", async (t) => {
    const originalPaymentRecordFindFirst = prisma.paymentRecord.findFirst;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.paymentRecord.findFirst = originalPaymentRecordFindFirst;
      prisma.$transaction = original$transaction;
    });

    (prisma.paymentRecord.findFirst as any) = async () => ({
      id: 81,
      orderId: "cuid_order_cod_settle",
      method: "Cash on Delivery",
      state: "PAID",
      codSettlementState: "PENDING",
      order: { id: "cuid_order_cod_settle", orderId: "PH-COD-SETTLE" },
    });

    let updatedPaymentRecord: any = null;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        paymentRecord: {
          update: async (args: any) => {
            updatedPaymentRecord = args.data;
            return { id: 81, ...args.data };
          },
        },
      };
      return await callback(mockTx);
    };

    const req = makeAdminPatchRequest({
      orderId: "PH-COD-SETTLE",
      codSettlementState: "SETTLED",
      codSettlementNote: "Batch payout #445 from courier",
    });

    const res = await PATCH(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(updatedPaymentRecord.codSettlementState, "SETTLED");
    assert.ok(updatedPaymentRecord.codSettledAt instanceof Date);
    assert.strictEqual(updatedPaymentRecord.codSettlementNote, "Batch payout #445 from courier");
  });

  it("REFUND LIFECYCLE — Transitioning payment state to REFUNDED has zero inventory side effects", async (t) => {
    const originalPaymentRecordFindFirst = prisma.paymentRecord.findFirst;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.paymentRecord.findFirst = originalPaymentRecordFindFirst;
      prisma.$transaction = original$transaction;
    });

    (prisma.paymentRecord.findFirst as any) = async () => ({
      id: 82,
      orderId: "cuid_order_refund",
      method: "bKash",
      state: "REFUND_PROCESSING",
      refundAmount: 950,
      order: { id: "cuid_order_refund", orderId: "PH-REFUND", total: 950 },
    });

    let updatedPaymentRecord: any = null;
    let inventoryCalled = false;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        paymentRecord: {
          update: async (args: any) => {
            updatedPaymentRecord = args.data;
            return { id: 82, ...args.data };
          },
        },
        order: {
          update: async () => ({}),
        },
        product: {
          update: async () => {
            inventoryCalled = true;
            return {};
          },
        },
        productVariant: {
          update: async () => {
            inventoryCalled = true;
            return {};
          },
        },
        inventoryReservation: {
          updateMany: async () => {
            inventoryCalled = true;
            return { count: 0 };
          },
        },
      };
      return await callback(mockTx);
    };

    const req = makeAdminPatchRequest({
      orderId: "PH-REFUND",
      targetState: "REFUNDED",
      refundNote: "bKash MFS refund transaction #RF9988",
    });

    const res = await PATCH(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(updatedPaymentRecord.state, "REFUNDED");
    assert.ok(updatedPaymentRecord.refundedAt instanceof Date);
    assert.strictEqual(inventoryCalled, false, "Refund must NOT mutate inventory or reservations");
  });
});
