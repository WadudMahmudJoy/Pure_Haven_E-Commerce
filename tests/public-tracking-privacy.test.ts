/**
 * Task 13 — Public Tracking Privacy Boundary Tests
 *
 * Verifies:
 *   1. Public tracking GET (/api/orders?track=1&orderId=...&phone=...) strictly omits:
 *      - paymentSenderNumber
 *      - paymentTrxId
 *      - senderNumber
 *      - trxId
 *      - normalizedTrxId
 *      - paymentEvidenceAttempts
 *      - verifiedBy
 *      - rejectionNote
 *      - refundNote
 *      - codSettlementNote
 *   2. Admin authenticated GET (/api/orders or /api/orders?id=...) preserves full payment operational details
 *
 * Run with:
 *   npx tsx --test tests/public-tracking-privacy.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/orders/route";
import { createAdminSessionToken, ADMIN_SESSION_COOKIE } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";

process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString("hex");

function makeAdminCookie(): string {
  const token = createAdminSessionToken("admin@purehaven.test");
  return `${ADMIN_SESSION_COOKIE}=${token}`;
}

describe("Task 13 — Public Tracking Privacy Boundary", { concurrency: false }, () => {
  it("PRIVACY — Public tracking strictly omits sensitive payment evidence and notes", async (t) => {
    const originalFindFirst = prisma.order.findFirst;
    t.after(() => {
      prisma.order.findFirst = originalFindFirst;
    });

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_order_priv",
      orderId: "PH-PRIVACY-001",
      customerName: "Joy Customer",
      customerPhone: "01712345678",
      customerAddress: "Dhaka, Bangladesh",
      paymentMethod: "bKash",
      paymentStatus: "verification_pending",
      paymentProvider: "bKash",
      paymentSenderNumber: "01799887766", // SENSITIVE
      paymentTrxId: "TRX_SECRET_999", // SENSITIVE
      status: "pending",
      subtotal: 1000,
      deliveryCharge: 120,
      total: 1120,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 1,
          productId: 10,
          name: "Face Cream",
          price: 1000,
          quantity: 1,
        },
      ],
      paymentRecord: {
        id: 10,
        method: "bKash",
        state: "VERIFICATION_PENDING",
        provider: "BKASH",
        rejectionNote: "Internal rejected reason", // SENSITIVE
        refundNote: "Internal refund reason", // SENSITIVE
        codSettlementNote: "Internal settlement note", // SENSITIVE
        evidenceAttempts: [
          {
            id: 1,
            normalizedProvider: "BKASH",
            senderNumber: "01799887766", // SENSITIVE
            trxId: "TRX_SECRET_999", // SENSITIVE
            normalizedTrxId: "TRX_SECRET_999", // SENSITIVE
            state: "PENDING_REVIEW",
          },
        ],
      },
    });

    const req = new NextRequest("http://localhost:3000/api/orders?track=1&orderId=PH-PRIVACY-001&phone=01712345678");
    const res = await GET(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    const order = data.order;

    // Public safe fields exist
    assert.strictEqual(order.orderId, "PH-PRIVACY-001");
    assert.strictEqual(order.status, "pending");
    assert.strictEqual(order.paymentMethod, "bKash");

    // SENSITIVE payment evidence fields MUST NOT exist in public tracking DTO
    assert.strictEqual(order.paymentSenderNumber, undefined, "paymentSenderNumber must be omitted in public DTO");
    assert.strictEqual(order.paymentTrxId, undefined, "paymentTrxId must be omitted in public DTO");
    assert.strictEqual(order.senderNumber, undefined, "senderNumber must be omitted in public DTO");
    assert.strictEqual(order.trxId, undefined, "trxId must be omitted in public DTO");
    assert.strictEqual(order.normalizedTrxId, undefined, "normalizedTrxId must be omitted in public DTO");
    assert.strictEqual(order.evidenceAttempts, undefined, "evidenceAttempts must be omitted in public DTO");
    assert.strictEqual(order.rejectionNote, undefined, "rejectionNote must be omitted in public DTO");
    assert.strictEqual(order.refundNote, undefined, "refundNote must be omitted in public DTO");
    assert.strictEqual(order.codSettlementNote, undefined, "codSettlementNote must be omitted in public DTO");

    if (order.paymentDetails) {
      assert.strictEqual(order.paymentDetails.senderNumber, undefined);
      assert.strictEqual(order.paymentDetails.trxId, undefined);
      assert.strictEqual(order.paymentDetails.transactionId, undefined);
    }
  });

  it("ADMIN DTO — Authenticated admin GET includes operational payment details", async (t) => {
    const originalFindFirst = prisma.order.findFirst;
    t.after(() => {
      prisma.order.findFirst = originalFindFirst;
    });

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_order_admin",
      orderId: "PH-ADMIN-001",
      customerName: "Joy Customer",
      customerPhone: "01712345678",
      customerAddress: "Dhaka, Bangladesh",
      paymentMethod: "bKash",
      paymentStatus: "verification_pending",
      paymentProvider: "bKash",
      paymentSenderNumber: "01799887766",
      paymentTrxId: "TRX_SECRET_999",
      status: "pending",
      subtotal: 1000,
      deliveryCharge: 120,
      total: 1120,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
      paymentRecord: {
        id: 11,
        method: "bKash",
        state: "VERIFICATION_PENDING",
        provider: "BKASH",
        rejectionNote: "Internal rejected reason",
      },
    });

    const req = new NextRequest("http://localhost:3000/api/orders?id=cuid_order_admin", {
      headers: {
        cookie: makeAdminCookie(),
      },
    });
    const res = await GET(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    const order = data.order;

    // Admin DTO retains operational details
    assert.strictEqual(order.paymentSenderNumber, "01799887766");
    assert.strictEqual(order.paymentTrxId, "TRX_SECRET_999");
  });
});
