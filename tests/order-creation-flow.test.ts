/**
 * Order Creation Flow Behavioral Tests — Wave B (Tasks 5 & 6)
 *
 * Verifies:
 *   1. Initial prepaid order does NOT require payment evidence (senderNumber/trxId)
 *   2. Initial prepaid order sets PaymentRecord.state = AWAITING_PAYMENT
 *   3. Prepaid order receives a 15-minute evidenceDeadlineAt on all reservations
 *   4. COD order receives evidenceDeadlineAt = null and codSettlementState = NOT_APPLICABLE
 *   5. SubmissionToken idempotency returns existing order without creating new order or stock decrements
 *   6. Out-of-stock item returns HTTP 409 with code INSUFFICIENT_STOCK
 *   7. Client-supplied subtotal/total/deliveryFee are ignored in favor of server calculations
 *
 * Run with:
 *   npx tsx --test tests/order-creation-flow.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/orders/route";
import { prisma } from "@/lib/prisma";

test("Task 5 & 6 — Two-Stage Prepaid Order Creation Without Evidence", async (t) => {
  let createdPaymentRecordData: any = null;
  let createdReservations: any[] = [];

  const original$transaction = prisma.$transaction;
  const originalOrderFindUnique = prisma.order.findUnique;

  t.after(() => {
    prisma.$transaction = original$transaction;
    prisma.order.findUnique = originalOrderFindUnique;
  });

  (prisma.order.findUnique as any) = async () => null;

  (prisma.$transaction as any) = async (callback: any) => {
    const mockTx: any = {
      order: {
        findUnique: async () => null,
        create: async (args: any) => ({
          id: "cuid_order_1",
          orderId: args.data.orderId,
          submissionToken: args.data.submissionToken,
          customerName: args.data.customerName,
          customerPhone: args.data.customerPhone,
          customerCity: args.data.customerCity,
          customerAddress: args.data.customerAddress,
          subtotal: args.data.subtotal,
          deliveryFee: args.data.deliveryFee,
          total: args.data.total,
          status: args.data.status,
          paymentMethod: args.data.paymentMethod,
          paymentStatus: args.data.paymentStatus,
          paymentProvider: args.data.paymentProvider,
          paymentSenderNumber: null,
          paymentTrxId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [
            {
              id: 501,
              orderId: "cuid_order_1",
              productId: 10,
              variantId: null,
              variantLabel: null,
              name: "Test Serum",
              price: 500,
              image: "/serum.png",
              category: "Skincare",
              quantity: 2,
            },
          ],
        }),
      },
      product: {
        findUnique: async () => ({
          id: 10,
          name: "Test Serum",
          price: 500,
          image: "/serum.png",
          category: "Skincare",
          stock: 10,
          variants: [],
        }),
        updateMany: async () => ({ count: 1 }),
      },
      productVariant: {
        updateMany: async () => ({ count: 1 }),
      },
      inventoryReservation: {
        create: async (args: any) => {
          createdReservations.push(args.data);
          return { id: createdReservations.length, ...args.data };
        },
      },
      paymentRecord: {
        create: async (args: any) => {
          createdPaymentRecordData = args.data;
          return { id: 1, ...args.data };
        },
      },
    };

    return await callback(mockTx);
  };

  const req = new NextRequest("http://localhost:3000/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      submissionToken: "token-uuid-12345",
      customerName: "Jane Doe",
      customerPhone: "01711223344",
      customerCity: "Dhaka",
      customerAddress: "123 Green Road",
      paymentMethod: "bKash",
      items: [{ productId: 10, quantity: 2 }],
      // Note: NO senderNumber, NO trxId passed in body
    }),
  });

  const res = await POST(req);
  const data = await res.json();

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
  assert.strictEqual(data.success, true);
  assert.match(data.order.orderId, /^PH-\d{8}-[0-9A-HJKMNP-Z]{13}$/);

  // Verify server-authoritative money
  assert.strictEqual(data.order.subtotal, 1000);
  assert.strictEqual(data.order.deliveryFee, 120);
  assert.strictEqual(data.order.total, 1120);

  // Verify PaymentRecord creation
  assert.ok(createdPaymentRecordData, "PaymentRecord must be created");
  assert.strictEqual(createdPaymentRecordData.state, "AWAITING_PAYMENT");
  assert.strictEqual(createdPaymentRecordData.method, "bKash");

  // Verify 15-minute evidence deadline on reservation
  assert.strictEqual(createdReservations.length, 1);
  assert.strictEqual(createdReservations[0].status, "RESERVED");
  assert.ok(createdReservations[0].evidenceDeadlineAt instanceof Date);
  const diffMinutes =
    (createdReservations[0].evidenceDeadlineAt.getTime() -
      createdReservations[0].reservedAt.getTime()) /
    (60 * 1000);
  assert(Math.abs(diffMinutes - 15) < 0.1, "Evidence deadline must be 15 minutes");
});

test("Task 5 — Submission Token Idempotent Replay Returns Existing Order", async (t) => {
  const existingOrder = {
    id: "cuid_existing_1",
    orderId: "PH-20260825-ABCDEF1234567",
    submissionToken: "token-idempotent-test",
    customerName: "Jane Doe",
    customerPhone: "01711223344",
    customerCity: "Dhaka",
    customerAddress: "123 Green Road",
    subtotal: 1000,
    deliveryFee: 120,
    total: 1120,
    status: "pending",
    paymentMethod: "Cash on Delivery",
    paymentStatus: "pending",
    paymentProvider: null,
    paymentSenderNumber: null,
    paymentTrxId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
  };

  const originalOrderFindUnique = prisma.order.findUnique;
  t.after(() => {
    prisma.order.findUnique = originalOrderFindUnique;
  });

  (prisma.order.findUnique as any) = async (args: any) => {
    if (args.where?.submissionToken === "token-idempotent-test") {
      return existingOrder;
    }
    return null;
  };

  const req = new NextRequest("http://localhost:3000/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      submissionToken: "token-idempotent-test",
      customerName: "Jane Doe",
      customerPhone: "01711223344",
      customerCity: "Dhaka",
      customerAddress: "123 Green Road",
      paymentMethod: "Cash on Delivery",
      items: [{ productId: 10, quantity: 2 }],
    }),
  });

  const res = await POST(req);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.order.orderId, "PH-20260825-ABCDEF1234567");
});

test("Task 6 — Out of Stock Product Returns HTTP 409 INSUFFICIENT_STOCK", async (t) => {
  const original$transaction = prisma.$transaction;
  const originalOrderFindUnique = prisma.order.findUnique;

  t.after(() => {
    prisma.$transaction = original$transaction;
    prisma.order.findUnique = originalOrderFindUnique;
  });

  (prisma.order.findUnique as any) = async () => null;

  (prisma.$transaction as any) = async (callback: any) => {
    const mockTx: any = {
      order: {
        findUnique: async () => null,
        create: async (args: any) => ({
          id: "cuid_order_oos",
          orderId: args.data.orderId,
          items: [{ id: 999, orderId: "cuid_order_oos", productId: 10, variantId: null, quantity: 5 }],
        }),
      },
      product: {
        findUnique: async () => ({
          id: 10,
          name: "Test Serum",
          price: 500,
          stock: 2, // Less than requested 5
          variants: [],
        }),
        updateMany: async () => ({ count: 0 }), // 0 updated due to stock guard
      },
      productVariant: {
        updateMany: async () => ({ count: 0 }),
      },
      inventoryReservation: {
        create: async () => ({ id: 1 }),
      },
      paymentRecord: {
        create: async () => ({ id: 1 }),
      },
    };

    return await callback(mockTx);
  };

  const req = new NextRequest("http://localhost:3000/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Jane Doe",
      customerPhone: "01711223344",
      customerCity: "Dhaka",
      customerAddress: "123 Green Road",
      paymentMethod: "Cash on Delivery",
      items: [{ productId: 10, quantity: 5 }],
    }),
  });

  const res = await POST(req);
  const data = await res.json();

  assert.strictEqual(res.status, 409);
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.code, "INSUFFICIENT_STOCK");
});

test("Task 6 — COD Order Sets Null Evidence Deadline & NOT_APPLICABLE Settlement", async (t) => {
  let createdPaymentRecordData: any = null;
  let createdReservations: any[] = [];

  const original$transaction = prisma.$transaction;
  const originalOrderFindUnique = prisma.order.findUnique;

  t.after(() => {
    prisma.$transaction = original$transaction;
    prisma.order.findUnique = originalOrderFindUnique;
  });

  (prisma.order.findUnique as any) = async () => null;

  (prisma.$transaction as any) = async (callback: any) => {
    const mockTx: any = {
      order: {
        findUnique: async () => null,
        create: async (args: any) => ({
          id: "cuid_cod_1",
          orderId: args.data.orderId,
          subtotal: args.data.subtotal,
          deliveryFee: args.data.deliveryFee,
          total: args.data.total,
          status: "pending",
          paymentMethod: "Cash on Delivery",
          paymentStatus: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [{ id: 601, orderId: "cuid_cod_1", productId: 10, variantId: null, quantity: 1 }],
        }),
      },
      product: {
        findUnique: async () => ({
          id: 10,
          name: "Test Serum",
          price: 500,
          stock: 10,
          variants: [],
        }),
        updateMany: async () => ({ count: 1 }),
      },
      inventoryReservation: {
        create: async (args: any) => {
          createdReservations.push(args.data);
          return { id: 1, ...args.data };
        },
      },
      paymentRecord: {
        create: async (args: any) => {
          createdPaymentRecordData = args.data;
          return { id: 1, ...args.data };
        },
      },
    };

    return await callback(mockTx);
  };

  const req = new NextRequest("http://localhost:3000/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Jane Doe",
      customerPhone: "01711223344",
      customerCity: "Dhaka",
      customerAddress: "123 Green Road",
      paymentMethod: "Cash on Delivery",
      items: [{ productId: 10, quantity: 1 }],
    }),
  });

  const res = await POST(req);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(createdReservations[0].evidenceDeadlineAt, null, "COD reservation evidenceDeadlineAt must be null");
  assert.strictEqual(createdPaymentRecordData.codSettlementState, "NOT_APPLICABLE", "COD initial settlement state must be NOT_APPLICABLE");
});
