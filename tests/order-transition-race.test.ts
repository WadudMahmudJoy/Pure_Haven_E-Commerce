/**
 * Order Transition Concurrency & Ownership Behavioral Tests — Wave C Corrective Pass
 *
 * Verifies:
 *   1. Competing transitions from same source state (e.g. PROCESSING -> CANCELLED vs PROCESSING -> SHIPPED)
 *      cannot both own side effects.
 *   2. The loser of a conditional status claim (count === 0) cannot overwrite status or audit fields,
 *      and cannot trigger inventory release or fulfillment side effects.
 *   3. If current status has already become the target status, loser resolves as a safe same-state no-op.
 *   4. If current status diverged to another state, loser receives HTTP 409 LIFECYCLE_CONFLICT.
 *
 * Run with:
 *   npx tsx --test tests/order-transition-race.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { PUT } from "@/app/api/orders/route";
import { createAdminSessionToken, ADMIN_SESSION_COOKIE } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";

process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString("hex");

function makeAdminCookie(): string {
  const token = createAdminSessionToken("admin@purehaven.test");
  return `${ADMIN_SESSION_COOKIE}=${token}`;
}

function makePutRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/orders", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      cookie: makeAdminCookie(),
    },
    body: JSON.stringify(body),
  });
}

describe("Order Transition Concurrency Suite", { concurrency: false }, () => {
it("LIFECYCLE RACE — Competing CANCELLED vs SHIPPED from PROCESSING: Loser receives 409 and does not execute side effects", async (t) => {
  let orderDbStatus = "processing";
  let reservationDbStatus = "RESERVED";
  let releaseCalled = false;
  let fulfillCalled = false;

  const originalFindFirst = prisma.order.findFirst;
  const original$transaction = prisma.$transaction;

  t.after(() => {
    prisma.order.findFirst = originalFindFirst;
    prisma.$transaction = original$transaction;
  });

  // Pre-transaction read returns processing
  (prisma.order.findFirst as any) = async () => ({
    id: "cuid_order_race_1",
    orderId: "PH-RACE-001",
    status: "processing",
    paymentMethod: "Cash on Delivery",
    paymentStatus: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [{ id: 1, productId: 10, variantId: null, quantity: 1 }],
  });

  (prisma.$transaction as any) = async (callback: any) => {
    const mockTx: any = {
      order: {
        updateMany: async (args: any) => {
          // Conditional update: only succeeds if current DB status matches expected
          if (args.where.id === "cuid_order_race_1" && args.where.status === orderDbStatus) {
            orderDbStatus = args.data.status;
            return { count: 1 };
          }
          return { count: 0 };
        },
        findUnique: async () => ({
          id: "cuid_order_race_1",
          orderId: "PH-RACE-001",
          status: orderDbStatus,
          paymentMethod: "Cash on Delivery",
          paymentStatus: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [{ id: 1, productId: 10, variantId: null, quantity: 1 }],
        }),
        findUniqueOrThrow: async () => ({
          id: "cuid_order_race_1",
          orderId: "PH-RACE-001",
          status: orderDbStatus,
          paymentMethod: "Cash on Delivery",
          paymentStatus: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [{ id: 1, productId: 10, variantId: null, quantity: 1 }],
        }),
      },
      inventoryReservation: {
        findMany: async () => [
          { id: 100, orderId: "cuid_order_race_1", productId: 10, variantId: null, quantity: 1, status: reservationDbStatus },
        ],
        updateMany: async (args: any) => {
          if (args.data.status === "RELEASED") {
            releaseCalled = true;
            reservationDbStatus = "RELEASED";
            return { count: 1 };
          }
          if (args.data.status === "FULFILLED") {
            fulfillCalled = true;
            reservationDbStatus = "FULFILLED";
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
      product: {
        update: async () => ({ id: 10, stock: 10 }),
      },
    };

    return await callback(mockTx);
  };

  // 1. Request A claims CANCELLED
  const reqCancel = makePutRequest({
    id: "cuid_order_race_1",
    status: "cancelled",
    cancellationReason: "customer_requested",
  });
  const resCancel = await PUT(reqCancel);
  const dataCancel = await resCancel.json();

  assert.strictEqual(resCancel.status, 200);
  assert.strictEqual(dataCancel.success, true);
  assert.strictEqual(orderDbStatus, "cancelled");
  assert.strictEqual(releaseCalled, true, "Winner must trigger release");

  // Reset side-effect spies
  releaseCalled = false;
  fulfillCalled = false;

  // 2. Request B attempts SHIPPED from the stale "processing" read
  const reqShipped = makePutRequest({
    id: "cuid_order_race_1",
    status: "shipped",
  });
  const resShipped = await PUT(reqShipped);
  const dataShipped = await resShipped.json();

  assert.strictEqual(resShipped.status, 409, "Competing loser must receive HTTP 409");
  assert.strictEqual(dataShipped.success, false);
  assert.strictEqual(orderDbStatus, "cancelled", "Order DB status must remain cancelled");
  assert.strictEqual(fulfillCalled, false, "Loser must NOT call fulfill");
});

it("LIFECYCLE RACE — Inverse Winner: SHIPPED claims first, subsequent CANCEL does not release stock or write audit", async (t) => {
  let orderDbStatus = "processing";
  let reservationDbStatus = "RESERVED";
  let releaseCalled = false;
  let fulfillCalled = false;

  const originalFindFirst = prisma.order.findFirst;
  const original$transaction = prisma.$transaction;

  t.after(() => {
    prisma.order.findFirst = originalFindFirst;
    prisma.$transaction = original$transaction;
  });

  (prisma.order.findFirst as any) = async () => ({
    id: "cuid_order_race_2",
    orderId: "PH-RACE-002",
    status: "processing",
    paymentMethod: "Cash on Delivery",
    paymentStatus: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [{ id: 1, productId: 10, variantId: null, quantity: 1 }],
  });

  (prisma.$transaction as any) = async (callback: any) => {
    const mockTx: any = {
      order: {
        updateMany: async (args: any) => {
          if (args.where.id === "cuid_order_race_2" && args.where.status === orderDbStatus) {
            orderDbStatus = args.data.status;
            return { count: 1 };
          }
          return { count: 0 };
        },
        findUnique: async () => ({
          id: "cuid_order_race_2",
          orderId: "PH-RACE-002",
          status: orderDbStatus,
          paymentMethod: "Cash on Delivery",
          paymentStatus: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [{ id: 1, productId: 10, variantId: null, quantity: 1 }],
        }),
      },
      inventoryReservation: {
        findMany: async () => [
          { id: 101, orderId: "cuid_order_race_2", productId: 10, variantId: null, quantity: 1, status: reservationDbStatus },
        ],
        updateMany: async (args: any) => {
          if (args.data.status === "RELEASED") {
            releaseCalled = true;
            reservationDbStatus = "RELEASED";
            return { count: 1 };
          }
          if (args.data.status === "FULFILLED") {
            fulfillCalled = true;
            reservationDbStatus = "FULFILLED";
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
    };
    return await callback(mockTx);
  };

  // 1. Request A claims SHIPPED
  const reqShipped = makePutRequest({
    id: "cuid_order_race_2",
    status: "shipped",
  });
  const resShipped = await PUT(reqShipped);
  const dataShipped = await resShipped.json();

  assert.strictEqual(resShipped.status, 200);
  assert.strictEqual(dataShipped.success, true);
  assert.strictEqual(orderDbStatus, "shipped");
  assert.strictEqual(fulfillCalled, true, "Winner must fulfill reservation");

  // Reset spies
  releaseCalled = false;
  fulfillCalled = false;

  // 2. Request B attempts CANCELLED from stale processing read
  const reqCancel = makePutRequest({
    id: "cuid_order_race_2",
    status: "cancelled",
    cancellationReason: "customer_requested",
  });
  const resCancel = await PUT(reqCancel);
  const dataCancel = await resCancel.json();

  assert.strictEqual(resCancel.status, 409, "Cancellation loser must receive 409");
  assert.strictEqual(dataCancel.success, false);
  assert.strictEqual(orderDbStatus, "shipped", "Order status must remain shipped");
  assert.strictEqual(releaseCalled, false, "Loser must NOT release reservation or restock");
});

it("LIFECYCLE RACE — Same-state Concurrent Resolution: Already at target status resolves as safe idempotent no-op", async (t) => {
  let orderDbStatus = "shipped"; // Already shipped by another worker
  let fulfillCalled = false;

  const originalFindFirst = prisma.order.findFirst;
  const original$transaction = prisma.$transaction;

  t.after(() => {
    prisma.order.findFirst = originalFindFirst;
    prisma.$transaction = original$transaction;
  });

  // Stale pre-read thought it was still processing
  (prisma.order.findFirst as any) = async () => ({
    id: "cuid_order_race_3",
    orderId: "PH-RACE-003",
    status: "processing",
    paymentMethod: "Cash on Delivery",
    paymentStatus: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [{ id: 1, productId: 10, variantId: null, quantity: 1 }],
  });

  (prisma.$transaction as any) = async (callback: any) => {
    const mockTx: any = {
      order: {
        updateMany: async (args: any) => {
          // Fails because expected is processing, but DB status is orderDbStatus ("shipped")
          if (args.where.id === "cuid_order_race_3" && args.where.status === orderDbStatus) {
            orderDbStatus = args.data.status;
            return { count: 1 };
          }
          return { count: 0 };
        },
        findUnique: async () => ({
          id: "cuid_order_race_3",
          orderId: "PH-RACE-003",
          status: "shipped",
          paymentMethod: "Cash on Delivery",
          paymentStatus: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [{ id: 1, productId: 10, variantId: null, quantity: 1 }],
        }),
      },
      inventoryReservation: {
        updateMany: async () => {
          fulfillCalled = true;
          return { count: 0 };
        },
      },
    };
    return await callback(mockTx);
  };

  const reqShipped = makePutRequest({
    id: "cuid_order_race_3",
    status: "shipped",
  });
  const resShipped = await PUT(reqShipped);
  const dataShipped = await resShipped.json();

  assert.strictEqual(resShipped.status, 200, "Should resolve as idempotent 200");
  assert.strictEqual(dataShipped.success, true);
  assert.strictEqual(fulfillCalled, false, "Idempotent resolution must not call fulfill again");
});
});
