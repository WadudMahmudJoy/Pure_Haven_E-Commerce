/**
 * Order Item Variant Identity Persistence & Serialization Regression Tests
 *
 * Exercises POST /api/orders, GET /api/customer-orders, and order serializers to guarantee:
 *   1. Exact server-resolved variantId is persisted to OrderItem
 *   2. Server-authoritative variantLabel is persisted as snapshot
 *   3. Non-variant orders persist variantId: null and variantLabel: null
 *   4. Client prices/labels are ignored in favor of server product/variant data
 *   5. Admin/API order serialization in app/api/orders/route.ts returns the full OrderItem DTO
 *      including orderId, compareAtPrice, variantId, and variantLabel
 *   6. Customer order serialization in app/api/customer-orders/route.ts tests actual production
 *      route GET handler, returning full OrderItem DTO (orderId, compareAtPrice, variantId, variantLabel)
 *      and safely handling legacy records where variant fields are null/absent without heuristic backfills.
 *      Uses an isolated synthetic test user environment without reading local data/customer-users.json.
 *
 * DATABASE & FILESYSTEM SAFETY:
 *   Prisma is intercepted with in-memory transaction and query stubs.
 *   Customer auth user store is isolated to a temporary directory during CASE 6.
 *   No database mutations and no modifications to real data/customer-users.json occur.
 *
 * Run with:
 *   npx tsx --test tests/order-item-variant-persistence.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { type NextRequest } from "next/server";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { POST } from "../app/api/orders/route";
import { prisma } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Synthetic Test Entities (In-Memory Only)
// ---------------------------------------------------------------------------

const SYNTHETIC_PRODUCT_ID = 88001;
const SYNTHETIC_VARIANT_ID = 99002;

const FAKE_VARIANT = {
  id: SYNTHETIC_VARIANT_ID,
  productId: SYNTHETIC_PRODUCT_ID,
  label: "Shade 02",
  price: 650,
  stock: 10,
  image: "/uploads/shade-02.png",
  isHotDeal: false,
  isUpcoming: false,
  badgeTone: null,
  sortOrder: 0,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const FAKE_PRODUCT_WITH_VARIANTS = {
  id: SYNTHETIC_PRODUCT_ID,
  name: "Velvet Matte Lipstick",
  price: 600,
  compareAtPrice: 750,
  image: "/uploads/lipstick-main.png",
  category: "Lips",
  subcategory: "Matte Lipstick",
  description: "Long lasting matte lipstick",
  stock: 25,
  isHotDeal: false,
  isUpcoming: false,
  badgeText: null,
  badgeTone: "sale",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  variants: [FAKE_VARIANT],
};

const FAKE_PRODUCT_NO_VARIANTS = {
  id: 88003,
  name: "Hydrating Facial Cleanser",
  price: 450,
  compareAtPrice: null,
  image: "/uploads/cleanser.png",
  category: "Skincare",
  subcategory: "Cleanser",
  description: "Gentle daily cleanser",
  stock: 30,
  isHotDeal: false,
  isUpcoming: false,
  badgeText: null,
  badgeTone: "sale",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  variants: [],
};

// ---------------------------------------------------------------------------
// Test Observation Spies
// ---------------------------------------------------------------------------

type TestCapture = {
  transactionEntered: boolean;
  orderCreateData: Record<string, unknown> | null;
  productUpdates: Array<{ id: number; decrement: number }>;
  variantUpdates: Array<{ id: number; decrement: number }>;
};

function freshCapture(): TestCapture {
  return {
    transactionEntered: false,
    orderCreateData: null,
    productUpdates: [],
    variantUpdates: [],
  };
}

function makeFakeTx(
  capture: TestCapture,
  productToReturn: typeof FAKE_PRODUCT_WITH_VARIANTS | typeof FAKE_PRODUCT_NO_VARIANTS
) {
  return {
    product: {
      findUnique: async () => productToReturn,
      update: async (args: { where: { id: number }; data: { stock: { decrement: number } } }) => {
        capture.productUpdates.push({
          id: args.where.id,
          decrement: args.data.stock.decrement,
        });
        return { id: args.where.id, stock: 99 };
      },
    },
    productVariant: {
      update: async (args: { where: { id: number }; data: { stock: { decrement: number } } }) => {
        capture.variantUpdates.push({
          id: args.where.id,
          decrement: args.data.stock.decrement,
        });
        return { id: args.where.id, stock: 9 };
      },
    },
    order: {
      create: async (args: { data: Record<string, unknown>; include?: unknown }) => {
        capture.orderCreateData = args.data;
        const createdItems = Array.isArray((args.data.items as { create: unknown[] })?.create)
          ? (args.data.items as { create: Array<Record<string, unknown>> }).create.map(
              (item, idx) => ({
                id: idx + 1,
                orderId: "fake-order-cuid-001",
                productId: item.productId ?? null,
                variantId: item.variantId ?? null,
                variantLabel: item.variantLabel ?? null,
                name: item.name,
                price: item.price,
                compareAtPrice: (item.compareAtPrice as number | null) ?? 799,
                image: item.image,
                category: item.category,
                quantity: item.quantity,
              })
            )
          : [];

        return {
          id: "fake-order-cuid-001",
          orderId: String(args.data.orderId || "PH-TEST-001"),
          customerName: String(args.data.customerName || ""),
          customerPhone: String(args.data.customerPhone || ""),
          customerCity: String(args.data.customerCity || ""),
          customerAddress: String(args.data.customerAddress || ""),
          subtotal: Number(args.data.subtotal || 0),
          deliveryFee: Number(args.data.deliveryFee || 120),
          total: Number(args.data.total || 0),
          status: String(args.data.status || "pending"),
          paymentMethod: String(args.data.paymentMethod || "Cash on Delivery"),
          paymentStatus: String(args.data.paymentStatus || "pending"),
          paymentProvider: (args.data.paymentProvider as string | null) ?? null,
          paymentSenderNumber: (args.data.paymentSenderNumber as string | null) ?? null,
          paymentTrxId: (args.data.paymentTrxId as string | null) ?? null,
          createdAt: new Date("2026-08-18T00:00:00.000Z"),
          updatedAt: new Date("2026-08-18T00:00:00.000Z"),
          items: createdItems,
        };
      },
    },
  };
}

function stubTransaction(capture: TestCapture, fakeTx: ReturnType<typeof makeFakeTx>): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaAny = prisma as any;
  const original = prismaAny.$transaction;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaAny.$transaction = async (fn: (tx: any) => Promise<any>) => {
    capture.transactionEntered = true;
    return fn(fakeTx);
  };

  return () => {
    prismaAny.$transaction = original;
  };
}

function makePostRequest(body: unknown, clientIp = "127.0.0.1"): NextRequest {
  return new Request("http://localhost:3000/api/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------

test("CASE 1 — Variant order persists exact server-resolved variant ID", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture, FAKE_PRODUCT_WITH_VARIANTS);
  const restoreTx = stubTransaction(capture, fakeTx);

  try {
    const req = makePostRequest(
      {
        customerName: "Ayesha Rahman",
        customerPhone: "01711223344",
        customerAddress: "Dhanmondi 27, Dhaka",
        paymentMethod: "Cash on Delivery",
        items: [
          {
            productId: SYNTHETIC_PRODUCT_ID,
            variantId: SYNTHETIC_VARIANT_ID,
            quantity: 2,
          },
        ],
      },
      "10.0.1.1"
    );

    const res = await POST(req);
    assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);

    assert.ok(capture.transactionEntered, "Expected transaction to be entered");
    assert.ok(capture.orderCreateData, "Expected order.create to be called");

    const itemsCreate = (capture.orderCreateData?.items as { create: Array<Record<string, unknown>> })?.create;
    assert.ok(Array.isArray(itemsCreate), "Expected items.create array");
    assert.strictEqual(itemsCreate.length, 1, "Expected exactly 1 order item create payload");

    const createdItem = itemsCreate[0];
    assert.strictEqual(
      createdItem.variantId,
      SYNTHETIC_VARIANT_ID,
      `Expected OrderItem.create to persist variantId=${SYNTHETIC_VARIANT_ID}, but got: ${JSON.stringify(createdItem.variantId)}`
    );
  } finally {
    restoreTx();
  }
});

test("CASE 2 — Variant label is server authoritative snapshot", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture, FAKE_PRODUCT_WITH_VARIANTS);
  const restoreTx = stubTransaction(capture, fakeTx);

  try {
    const req = makePostRequest(
      {
        customerName: "Ayesha Rahman",
        customerPhone: "01711223344",
        customerAddress: "Dhanmondi 27, Dhaka",
        paymentMethod: "Cash on Delivery",
        items: [
          {
            productId: SYNTHETIC_PRODUCT_ID,
            variantId: SYNTHETIC_VARIANT_ID,
            // Attacker attempts to spoof variantLabel and client price
            variantLabel: "Spoofed Free Sample",
            price: 1,
            quantity: 1,
          },
        ],
      },
      "10.0.1.2"
    );

    const res = await POST(req);
    assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);

    const itemsCreate = (capture.orderCreateData?.items as { create: Array<Record<string, unknown>> })?.create;
    assert.ok(Array.isArray(itemsCreate));
    const createdItem = itemsCreate[0];

    assert.strictEqual(
      createdItem.variantLabel,
      "Shade 02",
      `Expected OrderItem.create to persist server variant label "Shade 02", but got: ${JSON.stringify(createdItem.variantLabel)}`
    );
  } finally {
    restoreTx();
  }
});

test("CASE 3 — Existing server-authoritative item snapshots remain intact", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture, FAKE_PRODUCT_WITH_VARIANTS);
  const restoreTx = stubTransaction(capture, fakeTx);

  try {
    const req = makePostRequest(
      {
        customerName: "Ayesha Rahman",
        customerPhone: "01711223344",
        customerAddress: "Dhanmondi 27, Dhaka",
        paymentMethod: "Cash on Delivery",
        items: [
          {
            productId: SYNTHETIC_PRODUCT_ID,
            variantId: SYNTHETIC_VARIANT_ID,
            price: 5, // Untrusted client price
            name: "Hacked Name", // Untrusted client name
            quantity: 3,
          },
        ],
      },
      "10.0.1.3"
    );

    const res = await POST(req);
    assert.strictEqual(res.status, 200);

    const itemsCreate = (capture.orderCreateData?.items as { create: Array<Record<string, unknown>> })?.create;
    assert.ok(Array.isArray(itemsCreate));
    const createdItem = itemsCreate[0];

    assert.strictEqual(createdItem.productId, SYNTHETIC_PRODUCT_ID);
    assert.strictEqual(createdItem.name, "Velvet Matte Lipstick (Shade 02)");
    assert.strictEqual(createdItem.price, 650); // Server-authoritative variant price
    assert.strictEqual(createdItem.image, "/uploads/shade-02.png");
    assert.strictEqual(createdItem.category, "Lips");
    assert.strictEqual(createdItem.quantity, 3);
  } finally {
    restoreTx();
  }
});

test("CASE 4 — Non-variant item remains valid with null variant fields", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture, FAKE_PRODUCT_NO_VARIANTS);
  const restoreTx = stubTransaction(capture, fakeTx);

  try {
    const req = makePostRequest(
      {
        customerName: "Karim Uddin",
        customerPhone: "01811223344",
        customerAddress: "Chittagong",
        paymentMethod: "Cash on Delivery",
        items: [
          {
            productId: 88003,
            quantity: 1,
          },
        ],
      },
      "10.0.1.4"
    );

    const res = await POST(req);
    assert.strictEqual(res.status, 200);

    const itemsCreate = (capture.orderCreateData?.items as { create: Array<Record<string, unknown>> })?.create;
    assert.ok(Array.isArray(itemsCreate));
    const createdItem = itemsCreate[0];

    assert.strictEqual(createdItem.productId, 88003);
    assert.strictEqual(createdItem.variantId, null, "Expected variantId to be null for non-variant product");
    assert.strictEqual(createdItem.variantLabel, null, "Expected variantLabel to be null for non-variant product");
    assert.strictEqual(createdItem.name, "Hydrating Facial Cleanser");
    assert.strictEqual(createdItem.price, 450);
  } finally {
    restoreTx();
  }
});

test("CASE 5 — Admin/API order serialization exposes full OrderItem DTO without dropping fields", async () => {
  const capture = freshCapture();
  const fakeTx = makeFakeTx(capture, FAKE_PRODUCT_WITH_VARIANTS);
  const restoreTx = stubTransaction(capture, fakeTx);

  try {
    const req = makePostRequest(
      {
        customerName: "Ayesha Rahman",
        customerPhone: "01711223344",
        customerAddress: "Dhanmondi 27, Dhaka",
        paymentMethod: "Cash on Delivery",
        items: [
          {
            productId: SYNTHETIC_PRODUCT_ID,
            variantId: SYNTHETIC_VARIANT_ID,
            quantity: 1,
          },
        ],
      },
      "10.0.1.5"
    );

    const res = await POST(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.order, "Expected body.order to exist");
    assert.ok(Array.isArray(body.order.items), "Expected body.order.items array");
    assert.strictEqual(body.order.items.length, 1);

    const serializedItem = body.order.items[0];
    // Variant identity
    assert.strictEqual(serializedItem.variantId, SYNTHETIC_VARIANT_ID);
    assert.strictEqual(serializedItem.variantLabel, "Shade 02");
    // Required historical OrderItem fields that must NOT be dropped:
    assert.strictEqual(
      serializedItem.orderId,
      "fake-order-cuid-001",
      `Expected serialized item.orderId="fake-order-cuid-001", but got: ${JSON.stringify(serializedItem.orderId)}`
    );
    assert.strictEqual(
      serializedItem.compareAtPrice,
      799,
      `Expected serialized item.compareAtPrice=799, but got: ${JSON.stringify(serializedItem.compareAtPrice)}`
    );
  } finally {
    restoreTx();
  }
});

test("CASE 6 — Customer order serialization tests production route GET handler and preserves full OrderItem DTO in isolated environment", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaAny = prisma as any;
  const originalFindMany = prismaAny.order.findMany;

  // Set up temporary isolated filesystem root containing synthetic customer-users.json
  const originalCwd = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pure-haven-cust-test-"));
  const tempDataDir = path.join(tempRoot, "data");
  await mkdir(tempDataDir, { recursive: true });

  const syntheticUser = {
    id: "user_task21_test",
    name: "Task 21 Test User",
    email: "task21@example.invalid",
    phone: "01700000000",
    createdAt: "2026-08-18T00:00:00.000Z",
  };

  await writeFile(
    path.join(tempDataDir, "customer-users.json"),
    JSON.stringify([syntheticUser], null, 2),
    "utf8"
  );

  // Controlled synthetic test orders returned by findMany:
  const FAKE_CUSTOMER_ORDERS = [
    {
      id: "fake-order-cuid-001",
      orderId: "PH-20260818-1001",
      customerName: "Task 21 Test User",
      customerPhone: "01700000000",
      customerCity: "Dhaka",
      customerAddress: "Dhanmondi",
      subtotal: 650,
      deliveryFee: 120,
      total: 770,
      status: "pending",
      paymentMethod: "Cash on Delivery",
      paymentStatus: "pending",
      paymentProvider: null,
      paymentSenderNumber: null,
      paymentTrxId: null,
      createdAt: new Date("2026-08-18T00:00:00.000Z"),
      updatedAt: new Date("2026-08-18T00:00:00.000Z"),
      items: [
        {
          id: 201,
          orderId: "fake-order-cuid-001",
          productId: SYNTHETIC_PRODUCT_ID,
          variantId: SYNTHETIC_VARIANT_ID,
          variantLabel: "Shade 02",
          name: "Velvet Matte Lipstick (Shade 02)",
          price: 650,
          compareAtPrice: 799,
          image: "/uploads/shade-02.png",
          category: "Lips",
          quantity: 1,
        },
      ],
    },
    {
      id: "fake-order-cuid-002",
      orderId: "PH-20260818-1002",
      customerName: "Task 21 Test User",
      customerPhone: "01700000000",
      customerCity: "Dhaka",
      customerAddress: "Dhanmondi",
      subtotal: 350,
      deliveryFee: 120,
      total: 470,
      status: "delivered",
      paymentMethod: "bKash",
      paymentStatus: "paid",
      paymentProvider: "bKash",
      paymentSenderNumber: "01700000000",
      paymentTrxId: "TRX998877",
      createdAt: new Date("2026-06-21T12:00:00.000Z"),
      updatedAt: new Date("2026-06-21T12:00:00.000Z"),
      items: [
        {
          id: 101,
          orderId: "fake-order-cuid-002",
          productId: 12,
          variantId: null,
          variantLabel: null,
          name: "Classic Cream (50ml)",
          price: 350,
          compareAtPrice: null,
          image: "/uploads/cream.png",
          category: "Skincare",
          quantity: 1,
        },
      ],
    },
  ];

  prismaAny.order.findMany = async () => {
    return FAKE_CUSTOMER_ORDERS;
  };

  try {
    // Switch to temp root so route evaluates usersFile against synthetic temp directory
    process.chdir(tempRoot);

    const routePath = path.resolve(originalCwd, "app/api/customer-orders/route.ts");
    const routeUrl = pathToFileURL(routePath).href + `?cacheBust=${Date.now()}`;
    const { GET: isolatedCustomerOrdersGET } = await import(routeUrl);

    // Request with valid customer auth cookie pointing to synthetic user in temp directory
    const req = new Request("http://localhost:3000/api/customer-orders", {
      method: "GET",
      headers: {
        cookie: `pure_haven_customer_auth=${syntheticUser.id}`,
      },
    });

    const res = await isolatedCustomerOrdersGET(req);
    assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);

    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.authenticated, true);
    assert.strictEqual(body.user.id, "user_task21_test");
    assert.ok(Array.isArray(body.orders), "Expected body.orders to be an array");
    assert.strictEqual(body.orders.length, 2);

    // Order 1: New variant item
    const order1Item = body.orders[0].items[0];
    assert.strictEqual(order1Item.id, 201);
    assert.strictEqual(order1Item.productId, SYNTHETIC_PRODUCT_ID);
    assert.strictEqual(order1Item.variantId, SYNTHETIC_VARIANT_ID);
    assert.strictEqual(order1Item.variantLabel, "Shade 02");
    assert.strictEqual(
      order1Item.orderId,
      "fake-order-cuid-001",
      `Expected customer item.orderId="fake-order-cuid-001", but got: ${JSON.stringify(order1Item.orderId)}`
    );
    assert.strictEqual(
      order1Item.compareAtPrice,
      799,
      `Expected customer item.compareAtPrice=799, but got: ${JSON.stringify(order1Item.compareAtPrice)}`
    );

    // Order 2: Legacy historical item (variant fields null/absent)
    const order2Item = body.orders[1].items[0];
    assert.strictEqual(order2Item.id, 101);
    assert.strictEqual(order2Item.productId, 12);
    assert.strictEqual(order2Item.variantId, null, "Legacy item must return variantId: null");
    assert.strictEqual(order2Item.variantLabel, null, "Legacy item must return variantLabel: null");
    assert.strictEqual(order2Item.name, "Classic Cream (50ml)", "Legacy name must remain untampered");
    assert.strictEqual(
      order2Item.orderId,
      "fake-order-cuid-002",
      `Expected legacy item.orderId="fake-order-cuid-002", but got: ${JSON.stringify(order2Item.orderId)}`
    );
    assert.strictEqual(order2Item.compareAtPrice, null);
  } finally {
    process.chdir(originalCwd);
    prismaAny.order.findMany = originalFindMany;
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
});
