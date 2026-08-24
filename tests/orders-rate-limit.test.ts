/**
 * RED regression test — POST /api/orders rate-limiting and transaction protection
 *
 * Security requirements:
 *   - Order creation: max 10 requests per 60-second window per client key
 *   - Threshold crossing must return HTTP 429 with Retry-After header
 *   - Rate-limited requests must be rejected BEFORE entering prisma.$transaction
 *   - Different client limiter keys must remain isolated
 *
 * DATABASE SAFETY:
 *   - Uses the safe in-memory prisma.$transaction fake established in Task 2.
 *   - Never touches or connects to any real database.
 *
 * Run with:
 *   npx tsx --test tests/orders-rate-limit.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { type NextRequest } from "next/server";
import { POST } from "../app/api/orders/route";
import { prisma } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Named Policy Constants for Task 4
// ---------------------------------------------------------------------------
export const ORDER_CREATION_MAX_REQUESTS_PER_CLIENT = 10;
export const ORDER_CREATION_WINDOW_SECONDS = 60; // 1 min

// ---------------------------------------------------------------------------
// Synthetic product & transaction stubbing (Zero real database operations)
// ---------------------------------------------------------------------------
const SYNTHETIC_PRODUCT_ID = 99100;

const FAKE_PRODUCT = {
  id: SYNTHETIC_PRODUCT_ID,
  name: "Rate Limit Test Product",
  price: 500,
  image: "/test.jpg",
  stock: 1000,
  category: "Test",
  compareAtPrice: null as null,
  subcategory: null as null,
  description: null as null,
  isHotDeal: false,
  isUpcoming: false,
  badgeText: null as null,
  badgeTone: "sale",
  createdAt: new Date(),
  updatedAt: new Date(),
  variants: [] as never[],
};

type TestCapture = {
  transactionEntered: boolean;
  orderCreateCalled: boolean;
  transactionCount: number;
};

function freshCapture(): TestCapture {
  return {
    transactionEntered: false,
    orderCreateCalled: false,
    transactionCount: 0,
  };
}

function makeFakeTx(capture: TestCapture) {
  return {
    product: {
      findUnique: async () => FAKE_PRODUCT,
      update: async () => ({ id: SYNTHETIC_PRODUCT_ID, stock: 999 }),
      updateMany: async () => ({ count: 1 }),
    },
    productVariant: {
      updateMany: async () => ({ count: 1 }),
    },
    inventoryReservation: {
      create: async (args: Record<string, unknown>) => args.data,
    },
    paymentRecord: {
      create: async (args: Record<string, unknown>) => args.data,
    },
    order: {
      create: async (args: { data: Record<string, unknown> }) => {
        capture.orderCreateCalled = true;
        return {
          id: "fake-order-rate-limit",
          orderId: "PH-TEST-RL-001",
          customerName: "Rate Limit Customer",
          customerPhone: "01700000000",
          customerCity: "",
          customerAddress: "Test Address",
          subtotal: 500,
          deliveryFee: 120,
          total: 620,
          status: "pending",
          paymentMethod: String(args.data.paymentMethod || "Cash on Delivery"),
          paymentStatus: String(args.data.paymentStatus || "pending"),
          paymentProvider: null,
          paymentSenderNumber: null,
          paymentTrxId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [
            {
              id: 1,
              productId: SYNTHETIC_PRODUCT_ID,
              name: FAKE_PRODUCT.name,
              price: FAKE_PRODUCT.price,
              image: FAKE_PRODUCT.image,
              category: FAKE_PRODUCT.category,
              quantity: 1,
            },
          ],
        };
      },
    },
  };
}

function stubTransaction(capture: TestCapture, fakeTx: ReturnType<typeof makeFakeTx>): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = prisma as any;
  const original = p.$transaction as unknown;

  p.$transaction = async (
    callback: (tx: ReturnType<typeof makeFakeTx>) => Promise<unknown>
  ): Promise<unknown> => {
    capture.transactionEntered = true;
    capture.transactionCount++;
    return callback(fakeTx);
  };

  return () => {
    p.$transaction = original;
  };
}

function makeOrderRequest(clientIp?: string): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (clientIp) {
    headers["x-forwarded-for"] = clientIp;
    headers["x-real-ip"] = clientIp;
  }

  return new Request("http://localhost:3000/api/orders", {
    method: "POST",
    headers,
    body: JSON.stringify({
      customerName: "Rate Limit Tester",
      customerPhone: "01700000000",
      customerAddress: "123 Safe Test St",
      items: [{ productId: SYNTHETIC_PRODUCT_ID, quantity: 1 }],
      paymentMethod: "Cash on Delivery",
    }),
  });
}

// ---------------------------------------------------------------------------
// TEST CASES
// ---------------------------------------------------------------------------

test("ORDER CASE 1 — Requests below threshold reach normal order creation logic", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture);
  const restoreTx = stubTransaction(capture, fakeTx);

  try {
    const clientIp = "203.0.113.10";
    const req = makeOrderRequest(clientIp);
    const res = await POST(req as unknown as NextRequest);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(capture.transactionEntered, true);
    assert.strictEqual(capture.orderCreateCalled, true);
  } finally {
    restoreTx();
  }
});

test("ORDER CASE 2 — Threshold crossing returns HTTP 429 with Retry-After header", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture);
  const restoreTx = stubTransaction(capture, fakeTx);

  try {
    const clientIp = "203.0.113.20";

    // Exhaust quota (10 orders)
    for (let i = 0; i < ORDER_CREATION_MAX_REQUESTS_PER_CLIENT; i++) {
      const req = makeOrderRequest(clientIp);
      await POST(req as unknown as NextRequest);
    }

    // 11th order must be denied with 429
    const excessReq = makeOrderRequest(clientIp);
    const excessRes = await POST(excessReq as unknown as NextRequest);

    assert.strictEqual(
      excessRes.status,
      429,
      `Vulnerability confirmed: 11th rapid order request was not rate-limited (got HTTP ${String(excessRes.status)} instead of 429)`
    );

    const retryAfter = excessRes.headers.get("retry-after");
    assert.ok(
      retryAfter !== null && Number(retryAfter) > 0,
      "Expected positive integer Retry-After header on 429 response"
    );
  } finally {
    restoreTx();
  }
});

test("ORDER CASE 3 — Rate-limited request must NOT execute prisma.$transaction", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture);
  const restoreTx = stubTransaction(capture, fakeTx);

  try {
    const clientIp = "203.0.113.30";

    // Exhaust quota
    for (let i = 0; i < ORDER_CREATION_MAX_REQUESTS_PER_CLIENT; i++) {
      const req = makeOrderRequest(clientIp);
      await POST(req as unknown as NextRequest);
    }

    const txCountBefore = capture.transactionCount;

    // 11th order
    const excessReq = makeOrderRequest(clientIp);
    const excessRes = await POST(excessReq as unknown as NextRequest);

    assert.strictEqual(
      excessRes.status,
      429,
      "Expected HTTP 429 for over-limit order request"
    );

    assert.strictEqual(
      capture.transactionCount,
      txCountBefore,
      `Vulnerability confirmed: prisma.$transaction was executed on rate-limited request #11! ` +
        `Rate limit check must occur BEFORE opening a database transaction.`
    );
  } finally {
    restoreTx();
  }
});

test("ORDER CASE 4 — Different client limiter keys remain isolated", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture);
  const restoreTx = stubTransaction(capture, fakeTx);

  try {
    const clientIpA = "203.0.113.41";
    const clientIpB = "203.0.113.42";

    // Exhaust client A
    for (let i = 0; i < ORDER_CREATION_MAX_REQUESTS_PER_CLIENT; i++) {
      const req = makeOrderRequest(clientIpA);
      await POST(req as unknown as NextRequest);
    }

    // Client B must still be able to create an order
    const clientBReq = makeOrderRequest(clientIpB);
    const clientBRes = await POST(clientBReq as unknown as NextRequest);

    assert.strictEqual(
      clientBRes.status,
      200,
      `Expected client B to succeed with HTTP 200, got HTTP ${String(clientBRes.status)}`
    );
  } finally {
    restoreTx();
  }
});
