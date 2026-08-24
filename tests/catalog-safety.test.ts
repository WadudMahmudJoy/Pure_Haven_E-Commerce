/**
 * Catalog Safety & Explicit Stock Adjustment Behavioral Tests — Wave C (Task 9)
 *
 * Verifies:
 *   1. DELETE /api/orders fails closed with HTTP 409 ORDER_DELETE_FORBIDDEN
 *   2. PUT /api/products preserves variant IDs (no deleteMany) and preserves live stock
 *   3. PUT /api/products blocks deletion of variants with active RESERVED inventory
 *   4. PATCH /api/products performs explicit stock adjustment and synchronizes aggregate mirror
 *   5. DELETE /api/products blocks deletion of products with active RESERVED inventory
 *   6. POST /api/products normalizes financial prices via money helpers
 *
 * Run with:
 *   npx tsx --test tests/catalog-safety.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { DELETE as DELETE_ORDER } from "@/app/api/orders/route";
import { POST as POST_PRODUCT, PUT as PUT_PRODUCT, PATCH as PATCH_PRODUCT, DELETE as DELETE_PRODUCT } from "@/app/api/products/route";
import { createAdminSessionToken, ADMIN_SESSION_COOKIE } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";

process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString("hex");

function makeAdminCookie(): string {
  const token = createAdminSessionToken("admin@purehaven.test");
  return `${ADMIN_SESSION_COOKIE}=${token}`;
}

function makeAdminRequest(url: string, method: string, body?: unknown): NextRequest {
  const req = new NextRequest(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie: makeAdminCookie(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return req;
}

test("Task 9 — DELETE /api/orders Fails Closed with HTTP 409 ORDER_DELETE_FORBIDDEN", async () => {
  const req = makeAdminRequest("http://localhost:3000/api/orders?id=order_1", "DELETE");
  const res = await DELETE_ORDER(req);
  const data = await res.json();

  assert.strictEqual(res.status, 409);
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.code, "ORDER_DELETE_FORBIDDEN");
  assert.match(data.message, /forbidden/i);
});

test("Task 9 — PUT /api/products Preserves Variant ID and Does Not Overwrite DB Stock", async () => {
  let updatedProductData: any = null;
  let updatedVariantData: any = null;

  const originalProductFindUnique = prisma.product.findUnique;
  const original$transaction = prisma.$transaction;

  test.after(() => {
    prisma.product.findUnique = originalProductFindUnique;
    prisma.$transaction = original$transaction;
  });

  (prisma.product.findUnique as any) = async () => ({
    id: 10,
    name: "Original Lipstick",
    price: 500,
    compareAtPrice: 600,
    image: "/original.png",
    category: "Lips",
    stock: 25, // Current live DB stock
    variants: [
      {
        id: 101,
        productId: 10,
        label: "Ruby Red",
        price: 500,
        stock: 25, // Current live DB stock
        image: "/ruby.png",
      },
    ],
  });

  (prisma.$transaction as any) = async (callback: any) => {
    const mockTx: any = {
      productVariant: {
        findMany: async () => [{ id: 101, productId: 10, label: "Ruby Red", stock: 25 }],
        update: async (args: any) => {
          updatedVariantData = args;
          return { id: args.where.id, ...args.data, stock: 25 };
        },
        create: async (args: any) => ({ id: 102, ...args.data }),
      },
      inventoryReservation: {
        count: async () => 0,
      },
      product: {
        update: async (args: any) => {
          updatedProductData = args;
          return {
            id: 10,
            ...args.data,
            stock: 25,
            variants: [{ id: 101, productId: 10, label: "Ruby Red V2", price: 550, stock: 25 }],
          };
        },
      },
    };
    return await callback(mockTx);
  };

  const req = makeAdminRequest("http://localhost:3000/api/products", "PUT", {
    id: 10,
    name: "Updated Lipstick",
    price: 550,
    image: "/updated.png",
    category: "Lips",
    stock: 999, // Stale client value: MUST BE IGNORED
    variants: [
      {
        id: 101, // Existing variant ID preserved
        label: "Ruby Red V2",
        price: 550,
        stock: 888, // Stale client value: MUST BE IGNORED
        image: "/ruby2.png",
      },
    ],
  });

  const res = await PUT_PRODUCT(req);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.success, true);

  // Verify variant was updated, NOT deleted/recreated with deleteMany
  assert.ok(updatedVariantData, "Existing variant must be updated");
  assert.strictEqual(updatedVariantData.where.id, 101);
  assert.strictEqual(updatedVariantData.data.label, "Ruby Red V2");
  assert.strictEqual(updatedVariantData.data.price, 550);
  // Live stock was NOT written from stale client payload
  assert.strictEqual(updatedVariantData.data.stock, undefined, "Variant update must not overwrite stock");
  assert.notStrictEqual(updatedProductData.data.stock, 999, "Client-supplied stock 999 must be ignored");
  assert.strictEqual(updatedProductData.data.stock, 25, "Product aggregate must match live DB variants sum (25)");
});

test("Task 9 — PUT /api/products Blocks Deletion of Variant with Active Reservation", async () => {
  const originalProductFindUnique = prisma.product.findUnique;
  const original$transaction = prisma.$transaction;

  test.after(() => {
    prisma.product.findUnique = originalProductFindUnique;
    prisma.$transaction = original$transaction;
  });

  (prisma.product.findUnique as any) = async () => ({
    id: 10,
    name: "Lipstick",
    price: 500,
    image: "/lip.png",
    category: "Lips",
    stock: 10,
    variants: [
      { id: 101, productId: 10, label: "Red", price: 500, stock: 5 },
      { id: 102, productId: 10, label: "Pink", price: 500, stock: 5 },
    ],
  });

  (prisma.$transaction as any) = async (callback: any) => {
    const mockTx: any = {
      productVariant: {
        findMany: async () => [
          { id: 101, productId: 10, label: "Red", stock: 5 },
          { id: 102, productId: 10, label: "Pink", stock: 5 },
        ],
      },
      inventoryReservation: {
        count: async (args: any) => {
          // Variant 102 has active reservation
          if (args.where.variantId === 102 && args.where.status === "RESERVED") {
            return 1;
          }
          return 0;
        },
      },
    };
    return await callback(mockTx);
  };

  // Request omits variant 102 (attempting to delete it)
  const req = makeAdminRequest("http://localhost:3000/api/products", "PUT", {
    id: 10,
    name: "Lipstick",
    price: 500,
    image: "/lip.png",
    category: "Lips",
    variants: [
      { id: 101, label: "Red", price: 500 },
      // 102 omitted
    ],
  });

  const res = await PUT_PRODUCT(req);
  const data = await res.json();

  assert.strictEqual(res.status, 409);
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.code, "VARIANT_RESERVED_ACTIVE");
});

test("Task 9 — PATCH /api/products Performs Explicit Stock Adjustment and Adjusts Aggregate", async () => {
  let updatedVariantStock: number | null = null;
  let aggregateIncrement: number | null = null;

  const originalProductFindUnique = prisma.product.findUnique;
  const original$transaction = prisma.$transaction;

  test.after(() => {
    prisma.product.findUnique = originalProductFindUnique;
    prisma.$transaction = original$transaction;
  });

  (prisma.product.findUnique as any) = async () => ({
    id: 10,
    name: "Lipstick",
    stock: 20,
    variants: [
      { id: 101, productId: 10, label: "Red", stock: 5 },
    ],
  });

  (prisma.$transaction as any) = async (callback: any) => {
    const mockTx: any = {
      productVariant: {
        findUnique: async () => ({ id: 101, productId: 10, stock: 5 }),
        update: async (args: any) => {
          updatedVariantStock = args.data.stock;
          return { id: 101, productId: 10, stock: args.data.stock };
        },
      },
      product: {
        update: async (args: any) => {
          aggregateIncrement = args.data.stock.increment;
          return { id: 10, stock: 20 + aggregateIncrement! };
        },
      },
    };
    return await callback(mockTx);
  };

  // Adjust variant 101 stock from 5 to 8 (delta +3)
  const req = makeAdminRequest("http://localhost:3000/api/products", "PATCH", {
    id: 10,
    variantId: 101,
    stock: 8,
  });

  const res = await PATCH_PRODUCT(req);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.success, true);
  assert.strictEqual(updatedVariantStock, 8);
  assert.strictEqual(aggregateIncrement, 3, "Product aggregate must increment by delta (+3)");
});

test("Task 9 — DELETE /api/products Blocks Deletion of Product with Active Reservation", async () => {
  const originalProductFindUnique = prisma.product.findUnique;
  const originalReservationCount = prisma.inventoryReservation.count;

  test.after(() => {
    prisma.product.findUnique = originalProductFindUnique;
    prisma.inventoryReservation.count = originalReservationCount;
  });

  (prisma.product.findUnique as any) = async () => ({
    id: 10,
    name: "Lipstick",
  });

  (prisma.inventoryReservation.count as any) = async (args: any) => {
    if (args.where.productId === 10 && args.where.status === "RESERVED") {
      return 2; // 2 active reservations
    }
    return 0;
  };

  const req = makeAdminRequest("http://localhost:3000/api/products?id=10", "DELETE");
  const res = await DELETE_PRODUCT(req);
  const data = await res.json();

  assert.strictEqual(res.status, 409);
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.code, "PRODUCT_RESERVED_ACTIVE");
});

test("Task 9 — POST /api/products Normalizes Prices and Rejects Non-Finite Prices", async () => {
  const originalProductCreate = prisma.product.create;
  test.after(() => {
    prisma.product.create = originalProductCreate;
  });

  let createdProductData: any = null;
  (prisma.product.create as any) = async (args: any) => {
    createdProductData = args.data;
    return { id: 1, ...args.data };
  };

  // Case A: Valid prices normalized
  const reqValid = makeAdminRequest("http://localhost:3000/api/products", "POST", {
    name: "Moisturizer",
    image: "/moist.png",
    category: "Skincare",
    price: 499.994,
    compareAtPrice: 599.999,
    variants: [
      { label: "50ml", price: 499.994, stock: 10 },
    ],
  });

  const resValid = await POST_PRODUCT(reqValid);
  const dataValid = await resValid.json();

  assert.strictEqual(resValid.status, 201);
  assert.strictEqual(dataValid.success, true);
  assert.strictEqual(createdProductData.price, 499.99);
  assert.strictEqual(createdProductData.compareAtPrice, 600);

  // Case B: Non-finite price rejected with 400
  const reqInvalid = makeAdminRequest("http://localhost:3000/api/products", "POST", {
    name: "Moisturizer",
    image: "/moist.png",
    category: "Skincare",
    price: "invalid_nan",
  });

  const resInvalid = await POST_PRODUCT(reqInvalid);
  assert.strictEqual(resInvalid.status, 400);
});
