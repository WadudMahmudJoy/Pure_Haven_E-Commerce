/**
 * Security regression test — POST /api/orders server-authoritative payment state
 *
 * Guards against the client-controlled paymentStatus vulnerability:
 *   POST /api/orders must not trust client-supplied body.paymentStatus to set
 *   the initial stored payment state.
 *
 * Server-authoritative payment policy:
 *   Cash on Delivery  -> "pending"
 *   bKash             -> "verification_pending"
 *   Nagad             -> "verification_pending"
 *   anything else     -> HTTP 400
 *
 * DATABASE SAFETY:
 *   prisma.$transaction is replaced before every handler call with an
 *   in-memory fake that never opens a real connection. No Prisma query,
 *   no stock decrement, no order row, and no real database operation can
 *   occur under any test input in this file.
 *
 *   Prisma v7 uses a Proxy internally. Direct property assignment with
 *   explicit save/restore in try/finally intercepts the transaction safely
 *   and restores the original reference unconditionally.
 *
 * Run with:
 *   npx tsx --test tests/payment-status-creation.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { type NextRequest } from "next/server";
import { POST } from "../app/api/orders/route";
import { prisma } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Synthetic product — never a real database ID
// ---------------------------------------------------------------------------

const SYNTHETIC_PRODUCT_ID = 99001;

const FAKE_PRODUCT = {
  id: SYNTHETIC_PRODUCT_ID,
  name: "Test Product",
  price: 250,
  image: "/test-product.jpg",
  stock: 99,
  category: "Test Category",
  compareAtPrice: null as null,
  subcategory: null as null,
  description: null as null,
  isHotDeal: false,
  isUpcoming: false,
  badgeText: null as null,
  badgeTone: "sale",
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  variants: [] as never[],
};

// ---------------------------------------------------------------------------
// Fake-order shape required by the real mapOrder() function
// ---------------------------------------------------------------------------

function makeFakeOrder(paymentMethod: string, paymentStatus: string) {
  return {
    id: "fake-order-id-001",
    orderId: "PH-TEST-0001",
    customerName: "Test Customer",
    customerPhone: "01700000000",
    customerCity: "",
    customerAddress: "123 Test Road",
    subtotal: 250,
    deliveryFee: 120,
    total: 370,
    status: "pending",
    paymentMethod,
    paymentStatus,
    paymentProvider: null as null,
    paymentSenderNumber: null as null,
    paymentTrxId: null as null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
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
}

// ---------------------------------------------------------------------------
// Safety-observable state captured per test
// ---------------------------------------------------------------------------

type TestCapture = {
  transactionEntered: boolean;
  orderCreateCalled: boolean;
  productUpdateCalled: boolean;
  variantUpdateCalled: boolean;
  orderCreateData: Record<string, unknown> | null;
};

function freshCapture(): TestCapture {
  return {
    transactionEntered: false,
    orderCreateCalled: false,
    productUpdateCalled: false,
    variantUpdateCalled: false,
    orderCreateData: null,
  };
}

// ---------------------------------------------------------------------------
// Fake transaction factory — completely in-memory, never calls Prisma
// ---------------------------------------------------------------------------

function makeFakeTx(capture: TestCapture) {
  return {
    product: {
      findUnique: async () => {
        // Returns the synthetic product entirely in memory. Never calls Prisma.
        return FAKE_PRODUCT;
      },
      update: async () => {
        // Stock-decrement path after order.create. Return value is unused.
        capture.productUpdateCalled = true;
        return { id: SYNTHETIC_PRODUCT_ID, stock: 98 };
      },
    },
    order: {
      create: async (args: { data: Record<string, unknown>; include?: unknown }) => {
        // Capture the full data argument — primary assertion target.
        capture.orderCreateCalled = true;
        capture.orderCreateData = args.data;

        // Echo paymentMethod and paymentStatus so mapOrder() reflects what
        // the route tried to persist.
        return makeFakeOrder(
          String(args.data.paymentMethod ?? ""),
          String(args.data.paymentStatus ?? "")
        );
      },
    },
    productVariant: {
      update: async () => {
        // Non-variant path must never reach this. Throw explicitly so the
        // test fails with a clear infrastructure error, not a silent pass.
        capture.variantUpdateCalled = true;
        throw new Error(
          "productVariant.update called unexpectedly — " +
            "the test payload must not trigger the variant path."
        );
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Transaction stub — save/restore via direct property assignment.
// ---------------------------------------------------------------------------

type FakeTx = ReturnType<typeof makeFakeTx>;

function stubTransaction(capture: TestCapture, fakeTx: FakeTx): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = prisma as any;
  const original = p.$transaction as unknown;

  p.$transaction = async (
    callback: (tx: FakeTx) => Promise<unknown>
  ): Promise<unknown> => {
    capture.transactionEntered = true;
    return callback(fakeTx);
  };

  // Return a restore function — call in finally block.
  return () => {
    p.$transaction = original;
  };
}

// ---------------------------------------------------------------------------
// Synthetic request factory
// ---------------------------------------------------------------------------

function makeOrderRequest(opts: {
  paymentMethod: string;
  paymentStatus: string;
}): Request {
  return new Request("http://localhost:3000/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Customer fields — satisfies customer validation guards
      customerName: "Test Customer",
      customerPhone: "01700000000", // 11 digits — satisfies phone.length >= 11
      customerAddress: "123 Test Road",

      // Items — satisfies order items validation guards.
      // productId matches FAKE_PRODUCT.id returned by fake tx.product.findUnique.
      items: [{ productId: SYNTHETIC_PRODUCT_ID, quantity: 1 }],

      // Payment fields under test
      paymentMethod: opts.paymentMethod,
      paymentStatus: opts.paymentStatus,
    }),
  });
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

test("CASE 1 — COD cannot self-verify: stored paymentStatus must be 'pending'", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture);
  const restoreTransaction = stubTransaction(capture, fakeTx);

  try {
    const req = makeOrderRequest({
      paymentMethod: "Cash on Delivery",
      paymentStatus: "verified", // attacker-supplied: attempts to self-verify
    });

    const res = await POST(req as unknown as NextRequest);

    // Confirm the transaction was entered (route reached the DB layer)
    assert.ok(
      capture.transactionEntered,
      "Transaction was not entered — check fake tx installation or payload validity"
    );
    assert.ok(capture.orderCreateCalled, "tx.order.create was not called");

    // Primary trust-boundary assertion: what the route sent to order.create
    assert.strictEqual(
      capture.orderCreateData?.paymentStatus,
      "pending",
      `Trust-boundary check: route must persist server-authoritative "pending". ` +
        `Client-supplied "verified" must be ignored for Cash on Delivery orders.`
    );

    // Secondary: HTTP response should be 200 on the success path
    assert.strictEqual(res.status, 200, `Expected HTTP 200 but got ${res.status}`);
  } finally {
    restoreTransaction();
  }
});

test("CASE 2 — bKash cannot self-verify: stored paymentStatus must be 'verification_pending'", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture);
  const restoreTransaction = stubTransaction(capture, fakeTx);

  try {
    const req = makeOrderRequest({
      paymentMethod: "bKash",
      paymentStatus: "verified", // attacker-supplied: attempts to skip verification queue
    });

    const res = await POST(req as unknown as NextRequest);

    assert.ok(capture.transactionEntered, "Transaction was not entered");
    assert.ok(capture.orderCreateCalled, "tx.order.create was not called");

    assert.strictEqual(
      capture.orderCreateData?.paymentStatus,
      "verification_pending",
      `Trust-boundary check: route must persist server-authoritative "verification_pending". ` +
        `Client-supplied "verified" must be ignored for bKash orders.`
    );

    assert.strictEqual(res.status, 200, `Expected HTTP 200 but got ${res.status}`);
  } finally {
    restoreTransaction();
  }
});

test("CASE 3 — Nagad cannot self-select refunded: stored paymentStatus must be 'verification_pending'", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture);
  const restoreTransaction = stubTransaction(capture, fakeTx);

  try {
    const req = makeOrderRequest({
      paymentMethod: "Nagad",
      paymentStatus: "refunded", // attacker-supplied: attempts to claim refund at creation time
    });

    const res = await POST(req as unknown as NextRequest);

    assert.ok(capture.transactionEntered, "Transaction was not entered");
    assert.ok(capture.orderCreateCalled, "tx.order.create was not called");

    assert.strictEqual(
      capture.orderCreateData?.paymentStatus,
      "verification_pending",
      `Trust-boundary check: route must persist server-authoritative "verification_pending". ` +
        `Client-supplied "refunded" must be ignored for Nagad orders.`
    );

    assert.strictEqual(res.status, 200, `Expected HTTP 200 but got ${res.status}`);
  } finally {
    restoreTransaction();
  }
});

test("CASE 4 — Unknown payment method must be rejected with HTTP 400 before order.create", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture);
  // Install fake even though the route rejects before entering it.
  // If it unexpectedly reaches the transaction, the fake prevents any real DB op.
  const restoreTransaction = stubTransaction(capture, fakeTx);

  try {
    const req = makeOrderRequest({
      paymentMethod: "FREE_ORDER_EXPLOIT",
      paymentStatus: "verified",
    });

    const res = await POST(req as unknown as NextRequest);

    // Primary: unknown payment method must be rejected
    assert.strictEqual(
      res.status,
      400,
      `Expected HTTP 400 for unknown paymentMethod "FREE_ORDER_EXPLOIT" but got ${res.status}.`
    );

    // Secondary: prove the trusted order-create path was not reached
    assert.strictEqual(
      capture.orderCreateCalled,
      false,
      `tx.order.create was called despite invalid paymentMethod. ` +
        `Validation must fire BEFORE the transaction is entered.`
    );
  } finally {
    restoreTransaction();
  }
});
