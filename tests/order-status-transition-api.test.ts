/**
 * Order Status Transition API Tests — PUT /api/orders & Privacy Boundary (Task 2.2)
 *
 * Exercises the production PUT & GET /api/orders handlers with in-memory test doubles to verify:
 *   1. Unauthenticated PUT -> 401
 *   2. Malformed / unknown requested target status -> 400
 *   3. Persisted unknown / corrupt current status -> 409 (fails closed, no mutation)
 *   4. Known forbidden transition -> 409
 *   5. Shipped -> cancelled forbidden -> 409
 *   6. Valid pending -> cancelled requires cancellationReason
 *   7. Valid confirmed -> cancelled requires cancellationReason
 *   8. Cancellation without reason -> 400
 *   9. Cancellation reason "other" without non-empty note -> 400
 *   10. Valid cancellation persists cancelledBy: "admin", reason, note, cancelledAt
 *   11. Client-supplied cancelledBy cannot override server actor
 *   12. Same-state status-only request: HTTP 200, no DB update, no stock restoration, no audit rewrite
 *   13. Same-state request with valid non-lifecycle update (e.g. paymentDetails) succeeds and preserves non-status updates
 *   14. Out_for_delivery -> delivery_failed requires deliveryFailureReason
 *   15. Delivery failure reason "other" without note -> 400
 *   16. Valid delivery_failed persists reason, note, deliveryFailedAt
 *   17. Delivery_failed -> return_in_transit allowed
 *   18. Return_in_transit -> return_received allowed
 *   19. Delivered -> processing rejected -> 409
 *   20. Cancelled -> pending rejected -> 409
 *   21. Public tracking GET does NOT expose internal lifecycle audit fields
 *   22. Admin authenticated GET includes internal lifecycle audit fields
 *   23. Admin authenticated order list GET includes internal lifecycle audit fields on all items
 *
 * DATABASE SAFETY:
 *   All Prisma interactions are intercepted with in-memory spies. No live database writes occur.
 *
 * Run with:
 *   npx tsx --test tests/order-status-transition-api.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { GET, PUT } from "../app/api/orders/route";
import { createAdminSessionToken, ADMIN_SESSION_COOKIE } from "../lib/adminSession";
import { prisma } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Test Admin Session Setup
// ---------------------------------------------------------------------------
process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");

function makeAdminCookie(): string {
  const token = createAdminSessionToken("admin@purehaven.test");
  return `${ADMIN_SESSION_COOKIE}=${token}`;
}

function makePutRequest(body: unknown, cookieHeader?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/orders", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(url: string, cookieHeader?: string): NextRequest {
  return new NextRequest(url, {
    method: "GET",
    headers: {
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// In-Memory Test Order Builder & Transaction Spy
// ---------------------------------------------------------------------------

type OrderCapture = {
  findFirstCalled: boolean;
  findFirstArgs: unknown;
  findManyCalled: boolean;
  findManyArgs: unknown;
  transactionCalled: boolean;
  orderUpdateArgs: Array<{ where: { id: string }; data: Record<string, unknown> }>;
  productUpdateArgs: Array<{ where: { id: number }; data: Record<string, unknown> }>;
};

function freshOrderCapture(): OrderCapture {
  return {
    findFirstCalled: false,
    findFirstArgs: null,
    findManyCalled: false,
    findManyArgs: null,
    transactionCalled: false,
    orderUpdateArgs: [],
    productUpdateArgs: [],
  };
}

function buildFakeOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cuid-order-12345",
    orderId: "PH-20260819-0001",
    customerName: "Rahim Chowdhury",
    customerPhone: "01711000000",
    customerCity: "Dhaka",
    customerAddress: "Banani, Dhaka",
    subtotal: 1200,
    deliveryFee: 120,
    total: 1320,
    status: "pending",
    paymentMethod: "Cash on Delivery",
    paymentStatus: "pending",
    paymentProvider: null,
    paymentSenderNumber: null,
    paymentTrxId: null,
    cancelledBy: null,
    cancellationReason: null,
    cancellationNote: null,
    cancelledAt: null,
    deliveryFailureReason: null,
    deliveryFailureNote: null,
    deliveryFailedAt: null,
    createdAt: new Date("2026-08-19T00:00:00.000Z"),
    updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    items: [
      {
        id: 101,
        orderId: "cuid-order-12345",
        productId: 501,
        variantId: null,
        variantLabel: null,
        name: "Rose Water Toner",
        price: 600,
        compareAtPrice: 750,
        image: "/uploads/toner.png",
        category: "Skincare",
        quantity: 2,
      },
    ],
    ...overrides,
  };
}

function stubPrismaForOrders(
  capture: OrderCapture,
  orderToReturn: ReturnType<typeof buildFakeOrder> | null,
  ordersListToReturn?: Array<ReturnType<typeof buildFakeOrder>>
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaAny = prisma as any;
  const originalFindFirst = prismaAny.order.findFirst;
  const originalFindMany = prismaAny.order.findMany;
  const originalTransaction = prismaAny.$transaction;

  prismaAny.order.findFirst = async (args: unknown) => {
    capture.findFirstCalled = true;
    capture.findFirstArgs = args;
    return orderToReturn;
  };

  prismaAny.order.findMany = async (args: unknown) => {
    capture.findManyCalled = true;
    capture.findManyArgs = args;
    return ordersListToReturn ?? (orderToReturn ? [orderToReturn] : []);
  };

  prismaAny.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    capture.transactionCalled = true;
    const fakeTx = {
      order: {
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          capture.orderUpdateArgs.push(args);
          return {
            ...orderToReturn,
            ...args.data,
            items: orderToReturn?.items ?? [],
            updatedAt: new Date(),
          };
        },
      },
      product: {
        update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
          capture.productUpdateArgs.push(args);
          return { id: args.where.id, stock: 100 };
        },
      },
    };
    return fn(fakeTx);
  };

  return () => {
    prismaAny.order.findFirst = originalFindFirst;
    prismaAny.order.findMany = originalFindMany;
    prismaAny.$transaction = originalTransaction;
  };
}

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------

test("CASE 1 — Unauthenticated PUT returns HTTP 401", async () => {
  const capture = freshOrderCapture();
  const restore = stubPrismaForOrders(capture, buildFakeOrder());

  try {
    const req = makePutRequest({ id: "cuid-order-12345", status: "confirmed" });
    const res = await PUT(req);
    assert.strictEqual(res.status, 401, "Expected HTTP 401 for unauthenticated PUT");
    assert.strictEqual(capture.findFirstCalled, false, "Prisma should not be queried when unauthenticated");
  } finally {
    restore();
  }
});

test("CASE 2 — Malformed or unknown requested status returns HTTP 400", async () => {
  const capture = freshOrderCapture();
  const restore = stubPrismaForOrders(capture, buildFakeOrder({ status: "pending" }));

  try {
    const req = makePutRequest(
      { id: "cuid-order-12345", status: "invalid_status_xyz" },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 400, "Expected HTTP 400 for unknown requested status");
    assert.strictEqual(capture.transactionCalled, false, "No database transaction should run on invalid target status");
  } finally {
    restore();
  }
});

test("CASE 3 — Persisted unknown or corrupt current status fails closed with HTTP 409", async () => {
  const capture = freshOrderCapture();
  const corruptOrder = buildFakeOrder({ status: "corrupted_legacy_status" });
  const restore = stubPrismaForOrders(capture, corruptOrder);

  try {
    const req = makePutRequest(
      { id: "cuid-order-12345", status: "confirmed" },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(
      res.status,
      409,
      "Expected HTTP 409 Conflict when persisted current status is corrupt/unrecognized"
    );
    assert.strictEqual(capture.transactionCalled, false, "No database mutation should occur on corrupt current status");
  } finally {
    restore();
  }
});

test("CASE 4 — Known forbidden transition returns HTTP 409", async () => {
  const capture = freshOrderCapture();
  const deliveredOrder = buildFakeOrder({ status: "delivered" });
  const restore = stubPrismaForOrders(capture, deliveredOrder);

  try {
    const req = makePutRequest(
      { id: "cuid-order-12345", status: "processing" },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 409, "Expected HTTP 409 for forbidden transition delivered -> processing");
    assert.strictEqual(capture.transactionCalled, false);
  } finally {
    restore();
  }
});

test("CASE 5 — Shipped -> cancelled transition returns HTTP 409", async () => {
  const capture = freshOrderCapture();
  const shippedOrder = buildFakeOrder({ status: "shipped" });
  const restore = stubPrismaForOrders(capture, shippedOrder);

  try {
    const req = makePutRequest(
      {
        id: "cuid-order-12345",
        status: "cancelled",
        cancellationReason: "customer_requested",
      },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 409, "Expected HTTP 409 for post-dispatch cancellation shipped -> cancelled");
    assert.strictEqual(capture.transactionCalled, false);
  } finally {
    restore();
  }
});

test("CASE 6 — Valid pending -> cancelled requires cancellationReason (missing reason returns 400)", async () => {
  const capture = freshOrderCapture();
  const pendingOrder = buildFakeOrder({ status: "pending" });
  const restore = stubPrismaForOrders(capture, pendingOrder);

  try {
    const req = makePutRequest(
      { id: "cuid-order-12345", status: "cancelled" },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 400, "Expected HTTP 400 when cancellationReason is omitted");
    assert.strictEqual(capture.transactionCalled, false);
  } finally {
    restore();
  }
});

test("CASE 7 — Valid confirmed -> cancelled requires cancellationReason (missing reason returns 400)", async () => {
  const capture = freshOrderCapture();
  const confirmedOrder = buildFakeOrder({ status: "confirmed" });
  const restore = stubPrismaForOrders(capture, confirmedOrder);

  try {
    const req = makePutRequest(
      { id: "cuid-order-12345", status: "cancelled" },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 400, "Expected HTTP 400 when confirmed order cancellation omits reason");
    assert.strictEqual(capture.transactionCalled, false);
  } finally {
    restore();
  }
});

test("CASE 8 — Cancellation with invalid reason returns HTTP 400", async () => {
  const capture = freshOrderCapture();
  const pendingOrder = buildFakeOrder({ status: "pending" });
  const restore = stubPrismaForOrders(capture, pendingOrder);

  try {
    const req = makePutRequest(
      {
        id: "cuid-order-12345",
        status: "cancelled",
        cancellationReason: "not_a_valid_reason",
      },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 400, "Expected HTTP 400 for unapproved cancellationReason");
    assert.strictEqual(capture.transactionCalled, false);
  } finally {
    restore();
  }
});

test("CASE 9 — Cancellation reason 'other' without non-empty note returns HTTP 400", async () => {
  const capture = freshOrderCapture();
  const pendingOrder = buildFakeOrder({ status: "pending" });
  const restore = stubPrismaForOrders(capture, pendingOrder);

  try {
    const req = makePutRequest(
      {
        id: "cuid-order-12345",
        status: "cancelled",
        cancellationReason: "other",
        cancellationNote: "   ",
      },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 400, "Expected HTTP 400 when cancellationReason='other' lacks note");
    assert.strictEqual(capture.transactionCalled, false);
  } finally {
    restore();
  }
});

test("CASE 10 — Valid cancellation persists cancelledBy='admin', reason, note, and server-generated cancelledAt", async () => {
  const capture = freshOrderCapture();
  const pendingOrder = buildFakeOrder({ status: "pending" });
  const restore = stubPrismaForOrders(capture, pendingOrder);

  try {
    const req = makePutRequest(
      {
        id: "cuid-order-12345",
        status: "cancelled",
        cancellationReason: "customer_requested",
        cancellationNote: "Customer called to cancel before shipment",
      },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 200, "Expected HTTP 200 for valid cancellation");

    assert.strictEqual(capture.orderUpdateArgs.length, 1);
    const updateData = capture.orderUpdateArgs[0].data;

    assert.strictEqual(updateData.status, "cancelled");
    assert.strictEqual(updateData.cancelledBy, "admin");
    assert.strictEqual(updateData.cancellationReason, "customer_requested");
    assert.strictEqual(updateData.cancellationNote, "Customer called to cancel before shipment");
    assert.ok(updateData.cancelledAt instanceof Date, "Expected cancelledAt to be a Date instance");
  } finally {
    restore();
  }
});

test("CASE 11 — Client-supplied cancelledBy cannot override server actor", async () => {
  const capture = freshOrderCapture();
  const pendingOrder = buildFakeOrder({ status: "pending" });
  const restore = stubPrismaForOrders(capture, pendingOrder);

  try {
    const req = makePutRequest(
      {
        id: "cuid-order-12345",
        status: "cancelled",
        cancellationReason: "customer_requested",
        cancelledBy: "spoofed_hacker", // Attacker attempt
      },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 200);

    const updateData = capture.orderUpdateArgs[0].data;
    assert.strictEqual(
      updateData.cancelledBy,
      "admin",
      "cancelledBy must be server-enforced as 'admin'"
    );
  } finally {
    restore();
  }
});

test("CASE 12 — Same-state status-only request returns HTTP 200 with no DB write and no stock side effect", async () => {
  const capture = freshOrderCapture();
  const deliveredOrder = buildFakeOrder({ status: "delivered" });
  const restore = stubPrismaForOrders(capture, deliveredOrder);

  try {
    const req = makePutRequest(
      { id: "cuid-order-12345", status: "delivered" },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 200, "Expected HTTP 200 for same-state status-only request");
    assert.strictEqual(capture.transactionCalled, false, "Status-only no-op should not execute DB transaction");
    assert.strictEqual(capture.productUpdateArgs.length, 0, "No stock restoration on no-op");
  } finally {
    restore();
  }
});

test("CASE 13 — Same-state request containing legitimate non-lifecycle update executes update without mutating audit fields", async () => {
  const capture = freshOrderCapture();
  const pendingOrder = buildFakeOrder({ status: "pending" });
  const restore = stubPrismaForOrders(capture, pendingOrder);

  try {
    const req = makePutRequest(
      {
        id: "cuid-order-12345",
        status: "pending",
        paymentMethod: "bKash",
        paymentStatus: "paid",
        paymentDetails: {
          provider: "bKash",
          senderNumber: "01711223344",
          trxId: "TRX_TEST_123",
        },
      },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 200, "Expected HTTP 200 for same-state update with payment details");

    assert.strictEqual(capture.orderUpdateArgs.length, 1);
    const updateData = capture.orderUpdateArgs[0].data;
    assert.strictEqual(updateData.paymentMethod, "bKash");
    assert.strictEqual(updateData.paymentStatus, "paid");
    assert.strictEqual(updateData.paymentProvider, "bKash");
    assert.strictEqual(updateData.paymentSenderNumber, "01711223344");
    assert.strictEqual(updateData.paymentTrxId, "TRX_TEST_123");
    assert.strictEqual(updateData.cancelledBy, undefined);
    assert.strictEqual(updateData.cancellationReason, undefined);
  } finally {
    restore();
  }
});

test("CASE 14 — Out_for_delivery -> delivery_failed requires deliveryFailureReason (missing reason returns 400)", async () => {
  const capture = freshOrderCapture();
  const outOrder = buildFakeOrder({ status: "out_for_delivery" });
  const restore = stubPrismaForOrders(capture, outOrder);

  try {
    const req = makePutRequest(
      { id: "cuid-order-12345", status: "delivery_failed" },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 400, "Expected HTTP 400 when deliveryFailureReason is omitted");
    assert.strictEqual(capture.transactionCalled, false);
  } finally {
    restore();
  }
});

test("CASE 15 — Delivery failure reason 'other' without note returns HTTP 400", async () => {
  const capture = freshOrderCapture();
  const outOrder = buildFakeOrder({ status: "out_for_delivery" });
  const restore = stubPrismaForOrders(capture, outOrder);

  try {
    const req = makePutRequest(
      {
        id: "cuid-order-12345",
        status: "delivery_failed",
        deliveryFailureReason: "other",
        deliveryFailureNote: "   ",
      },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 400, "Expected HTTP 400 when deliveryFailureReason='other' lacks note");
    assert.strictEqual(capture.transactionCalled, false);
  } finally {
    restore();
  }
});

test("CASE 16 — Valid delivery_failed persists reason, note, and server-generated deliveryFailedAt", async () => {
  const capture = freshOrderCapture();
  const outOrder = buildFakeOrder({ status: "out_for_delivery" });
  const restore = stubPrismaForOrders(capture, outOrder);

  try {
    const req = makePutRequest(
      {
        id: "cuid-order-12345",
        status: "delivery_failed",
        deliveryFailureReason: "customer_unreachable",
        deliveryFailureNote: "Phone unreachable after 3 attempts",
      },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 200, "Expected HTTP 200 for valid delivery_failed transition");

    assert.strictEqual(capture.orderUpdateArgs.length, 1);
    const updateData = capture.orderUpdateArgs[0].data;
    assert.strictEqual(updateData.status, "delivery_failed");
    assert.strictEqual(updateData.deliveryFailureReason, "customer_unreachable");
    assert.strictEqual(updateData.deliveryFailureNote, "Phone unreachable after 3 attempts");
    assert.ok(updateData.deliveryFailedAt instanceof Date);
  } finally {
    restore();
  }
});

test("CASE 17 — Delivery_failed -> return_in_transit transition is allowed", async () => {
  const capture = freshOrderCapture();
  const failedOrder = buildFakeOrder({ status: "delivery_failed" });
  const restore = stubPrismaForOrders(capture, failedOrder);

  try {
    const req = makePutRequest(
      { id: "cuid-order-12345", status: "return_in_transit" },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 200, "Expected HTTP 200 for delivery_failed -> return_in_transit");
    assert.strictEqual(capture.orderUpdateArgs.length, 1);
    assert.strictEqual(capture.orderUpdateArgs[0].data.status, "return_in_transit");
  } finally {
    restore();
  }
});

test("CASE 18 — Return_in_transit -> return_received transition is allowed", async () => {
  const capture = freshOrderCapture();
  const returnTransitOrder = buildFakeOrder({ status: "return_in_transit" });
  const restore = stubPrismaForOrders(capture, returnTransitOrder);

  try {
    const req = makePutRequest(
      { id: "cuid-order-12345", status: "return_received" },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 200, "Expected HTTP 200 for return_in_transit -> return_received");
    assert.strictEqual(capture.orderUpdateArgs.length, 1);
    assert.strictEqual(capture.orderUpdateArgs[0].data.status, "return_received");
  } finally {
    restore();
  }
});

test("CASE 19 — Delivered -> processing transition returns HTTP 409", async () => {
  const capture = freshOrderCapture();
  const deliveredOrder = buildFakeOrder({ status: "delivered" });
  const restore = stubPrismaForOrders(capture, deliveredOrder);

  try {
    const req = makePutRequest(
      { id: "cuid-order-12345", status: "processing" },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 409, "Expected HTTP 409 for delivered -> processing");
    assert.strictEqual(capture.transactionCalled, false);
  } finally {
    restore();
  }
});

test("CASE 20 — Cancelled -> pending transition returns HTTP 409", async () => {
  const capture = freshOrderCapture();
  const cancelledOrder = buildFakeOrder({ status: "cancelled" });
  const restore = stubPrismaForOrders(capture, cancelledOrder);

  try {
    const req = makePutRequest(
      { id: "cuid-order-12345", status: "pending" },
      makeAdminCookie()
    );
    const res = await PUT(req);
    assert.strictEqual(res.status, 409, "Expected HTTP 409 for cancelled -> pending");
    assert.strictEqual(capture.transactionCalled, false);
  } finally {
    restore();
  }
});

test("CASE 21 — Public tracking GET does NOT expose internal lifecycle audit fields", async () => {
  const capture = freshOrderCapture();
  const orderWithAudit = buildFakeOrder({
    status: "cancelled",
    cancelledBy: "admin",
    cancellationReason: "suspected_fake_order",
    cancellationNote: "Internal fraud review note",
    cancelledAt: new Date("2026-08-19T10:00:00.000Z"),
    deliveryFailureReason: "customer_unreachable",
    deliveryFailureNote: "Internal courier/admin note",
    deliveryFailedAt: new Date("2026-08-19T09:00:00.000Z"),
  });
  const restore = stubPrismaForOrders(capture, orderWithAudit);

  try {
    const req = makeGetRequest(
      "http://localhost:3000/api/orders?track=1&orderId=PH-20260819-0001&phone=01711000000"
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);

    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.order, "Expected body.order to exist");

    // Public fields must be present
    assert.strictEqual(body.order.orderId, "PH-20260819-0001");
    assert.strictEqual(body.order.status, "cancelled");

    // Internal audit fields must be OMITTED from the public DTO (not merely null)
    assert.strictEqual("cancelledBy" in body.order, false, "cancelledBy must be omitted from public tracking");
    assert.strictEqual("cancellationReason" in body.order, false, "cancellationReason must be omitted from public tracking");
    assert.strictEqual("cancellationNote" in body.order, false, "cancellationNote must be omitted from public tracking");
    assert.strictEqual("cancelledAt" in body.order, false, "cancelledAt must be omitted from public tracking");
    assert.strictEqual("deliveryFailureReason" in body.order, false, "deliveryFailureReason must be omitted from public tracking");
    assert.strictEqual("deliveryFailureNote" in body.order, false, "deliveryFailureNote must be omitted from public tracking");
    assert.strictEqual("deliveryFailedAt" in body.order, false, "deliveryFailedAt must be omitted from public tracking");
  } finally {
    restore();
  }
});

test("CASE 22 — Admin authenticated GET includes internal lifecycle audit fields", async () => {
  const capture = freshOrderCapture();
  const orderWithAudit = buildFakeOrder({
    status: "cancelled",
    cancelledBy: "admin",
    cancellationReason: "suspected_fake_order",
    cancellationNote: "Internal fraud review note",
    cancelledAt: new Date("2026-08-19T10:00:00.000Z"),
    deliveryFailureReason: "customer_unreachable",
    deliveryFailureNote: "Internal courier/admin note",
    deliveryFailedAt: new Date("2026-08-19T09:00:00.000Z"),
  });
  const restore = stubPrismaForOrders(capture, orderWithAudit);

  try {
    const req = makeGetRequest(
      "http://localhost:3000/api/orders?id=cuid-order-12345",
      makeAdminCookie()
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.order);

    // Admin fields must be present and preserve values
    assert.strictEqual(body.order.cancelledBy, "admin");
    assert.strictEqual(body.order.cancellationReason, "suspected_fake_order");
    assert.strictEqual(body.order.cancellationNote, "Internal fraud review note");
    assert.strictEqual(body.order.cancelledAt, "2026-08-19T10:00:00.000Z");
    assert.strictEqual(body.order.deliveryFailureReason, "customer_unreachable");
    assert.strictEqual(body.order.deliveryFailureNote, "Internal courier/admin note");
    assert.strictEqual(body.order.deliveryFailedAt, "2026-08-19T09:00:00.000Z");
  } finally {
    restore();
  }
});

test("CASE 23 — Admin authenticated order list GET includes internal lifecycle audit fields on all items", async () => {
  const capture = freshOrderCapture();
  const orderWithAudit = buildFakeOrder({
    status: "cancelled",
    cancelledBy: "admin",
    cancellationReason: "customer_requested",
    cancellationNote: null,
    cancelledAt: new Date("2026-08-19T11:00:00.000Z"),
  });
  const restore = stubPrismaForOrders(capture, null, [orderWithAudit]);

  try {
    const req = makeGetRequest(
      "http://localhost:3000/api/orders",
      makeAdminCookie()
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.orders));
    assert.strictEqual(body.orders.length, 1);

    const firstOrder = body.orders[0];
    assert.strictEqual(firstOrder.cancelledBy, "admin");
    assert.strictEqual(firstOrder.cancellationReason, "customer_requested");
    assert.strictEqual(firstOrder.cancellationNote, null);
    assert.strictEqual(firstOrder.cancelledAt, "2026-08-19T11:00:00.000Z");
  } finally {
    restore();
  }
});
