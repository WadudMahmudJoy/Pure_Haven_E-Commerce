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

import "dotenv/config";
import { describe, it, afterEach, test } from "node:test";
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

describe("Catalog Safety Suite", { concurrency: false }, () => {
it("Task 9 — DELETE /api/orders Fails Closed with HTTP 409 ORDER_DELETE_FORBIDDEN", async () => {
  const req = makeAdminRequest("http://localhost:3000/api/orders?id=order_1", "DELETE");
  const res = await DELETE_ORDER(req);
  const data = await res.json();

  assert.strictEqual(res.status, 409);
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.code, "ORDER_DELETE_FORBIDDEN");
  assert.match(data.message, /forbidden/i);
});

it("Task 9 — PUT /api/products Preserves Variant ID and Does Not Overwrite DB Stock", async () => {
  const updatedVariantsData: any[] = [];
  let updatedProductData: any = null;

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
    stock: 25,
    variants: [
      { id: 101, productId: 10, label: "Red", price: 500, stock: 15 },
      { id: 102, productId: 10, label: "Pink", price: 500, stock: 10 },
    ],
  });

  (prisma.$transaction as any) = async (callback: any) => {
    const mockTx: any = {
      category: {
        findFirst: async () => ({ id: 1, name: "Lips", slug: "lips" }),
        findUnique: async () => ({ id: 1, name: "Lips", slug: "lips" }),
      },
      productVariant: {
        findMany: async () => [
          { id: 101, productId: 10, label: "Red", price: 500, stock: 15 },
          { id: 102, productId: 10, label: "Pink", price: 500, stock: 10 },
        ],
        update: async (args: any) => {
          updatedVariantsData.push(args);
          return { id: args.where.id, ...args.data, stock: 15 };
        },
      },
      product: {
        update: async (args: any) => {
          updatedProductData = args;
          return { id: 10, ...args.data };
        },
      },
    };
    return await callback(mockTx);
  };

  const req = makeAdminRequest("http://localhost:3000/api/products", "PUT", {
    id: 10,
    name: "Updated Lipstick",
    price: 550,
    image: "/lip-updated.png",
    category: "Lips",
    stock: 999, // Stale client stock snapshot (should be ignored!)
    variants: [
      { id: 101, label: "Ruby Red", price: 550, stock: 999 }, // Stale client variant stock
      { id: 102, label: "Pink", price: 500, stock: 999 },
    ],
  });

  const res = await PUT_PRODUCT(req);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.success, true);
  // Variant ID 101 was updated in-place
  const variant101Update = updatedVariantsData.find((v) => v.where.id === 101);
  assert.ok(variant101Update, "Variant 101 must be updated");
  assert.strictEqual(variant101Update.data.label, "Ruby Red");
  assert.strictEqual(variant101Update.data.price, 550);
  // Live stock was NOT written from stale client payload
  assert.strictEqual(variant101Update.data.stock, undefined, "Variant update must not overwrite stock");
  assert.notStrictEqual(updatedProductData.data.stock, 999, "Client-supplied stock 999 must be ignored");
  assert.strictEqual(updatedProductData.data.stock, 25, "Product aggregate must match live DB variants sum (25)");
});

it("Task 9 — PUT /api/products Blocks Deletion of Variant with Active Reservation", async () => {
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
          if (
            args.where.variantId === 102 &&
            (args.where.status === "RESERVED" || args.where.status?.in?.includes("RESERVED"))
          ) {
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

it("Task 9 — PATCH /api/products Performs Explicit Stock Adjustment and Adjusts Aggregate", async () => {
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

it("Task 9 — DELETE /api/products Blocks Deletion of Product with Active Reservation", async () => {
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
    if (
      args.where.productId === 10 &&
      (args.where.status === "RESERVED" || args.where.status?.in?.includes("RESERVED"))
    ) {
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

it("Task 9 — DELETE /api/products Blocks Deletion of Product with FULFILLED Reservation", async () => {
  const originalProductFindUnique = prisma.product.findUnique;
  const originalReservationCount = prisma.inventoryReservation.count;

  test.after(() => {
    prisma.product.findUnique = originalProductFindUnique;
    prisma.inventoryReservation.count = originalReservationCount;
  });

  (prisma.product.findUnique as any) = async () => ({
    id: 20,
    name: "Toner",
  });

  (prisma.inventoryReservation.count as any) = async (args: any) => {
    // Has FULFILLED reservation
    if (
      args.where.productId === 20 &&
      args.where.status?.in &&
      args.where.status.in.includes("FULFILLED")
    ) {
      return 1;
    }
    return 0;
  };

  const req = makeAdminRequest("http://localhost:3000/api/products?id=20", "DELETE");
  const res = await DELETE_PRODUCT(req);
  const data = await res.json();

  assert.strictEqual(res.status, 409, "Product with FULFILLED reservations must block deletion");
  assert.strictEqual(data.success, false);
});

it("Task 9 — PUT /api/products Blocks Deletion of Variant with FULFILLED Reservation", async () => {
  const originalProductFindUnique = prisma.product.findUnique;
  const original$transaction = prisma.$transaction;

  test.after(() => {
    prisma.product.findUnique = originalProductFindUnique;
    prisma.$transaction = original$transaction;
  });

  (prisma.product.findUnique as any) = async () => ({
    id: 30,
    name: "Serum",
    price: 600,
    image: "/serum.png",
    category: "Skincare",
    stock: 10,
    variants: [
      { id: 301, productId: 30, label: "30ml", price: 600, stock: 5 },
      { id: 302, productId: 30, label: "50ml", price: 900, stock: 5 },
    ],
  });

  (prisma.$transaction as any) = async (callback: any) => {
    const mockTx: any = {
      productVariant: {
        findMany: async () => [
          { id: 301, productId: 30, label: "30ml", stock: 5 },
          { id: 302, productId: 30, label: "50ml", stock: 5 },
        ],
      },
      inventoryReservation: {
        count: async (args: any) => {
          // Variant 302 has FULFILLED reservation
          if (
            args.where.variantId === 302 &&
            args.where.status?.in &&
            args.where.status.in.includes("FULFILLED")
          ) {
            return 1;
          }
          return 0;
        },
      },
    };
    return await callback(mockTx);
  };

  // Omits variant 302
  const req = makeAdminRequest("http://localhost:3000/api/products", "PUT", {
    id: 30,
    name: "Serum",
    price: 600,
    image: "/serum.png",
    category: "Skincare",
    variants: [
      { id: 301, label: "30ml", price: 600 },
    ],
  });

  const res = await PUT_PRODUCT(req);
  const data = await res.json();

  assert.strictEqual(res.status, 409, "Variant with FULFILLED reservations must block deletion");
  assert.strictEqual(data.success, false);
});

it("Task 9 — DELETE /api/products Permits Deletion When Only RELEASED Reservations Exist", async () => {
  const originalProductFindUnique = prisma.product.findUnique;
  const originalReservationCount = prisma.inventoryReservation.count;
  const originalProductDelete = prisma.product.delete;

  test.after(() => {
    prisma.product.findUnique = originalProductFindUnique;
    prisma.inventoryReservation.count = originalReservationCount;
    prisma.product.delete = originalProductDelete;
  });

  let deleteCalled = false;
  (prisma.product.findUnique as any) = async () => ({
    id: 40,
    name: "Archived Cleanser",
  });

  (prisma.inventoryReservation.count as any) = async (args: any) => {
    // No RESERVED or FULFILLED reservations
    if (
      args.where.productId === 40 &&
      args.where.status?.in &&
      (args.where.status.in.includes("RESERVED") || args.where.status.in.includes("FULFILLED"))
    ) {
      return 0;
    }
    return 5; // Has RELEASED reservations
  };

  (prisma.product.delete as any) = async () => {
    deleteCalled = true;
    return { id: 40 };
  };

  const req = makeAdminRequest("http://localhost:3000/api/products?id=40", "DELETE");
  const res = await DELETE_PRODUCT(req);
  const data = await res.json();

  assert.strictEqual(res.status, 200, "Product with ONLY RELEASED reservations should be deletable");
  assert.strictEqual(data.success, true);
  assert.strictEqual(deleteCalled, true);
});

it("Task 9 — POST /api/products Normalizes Prices and Rejects Non-Finite Prices", async () => {
  const originalProductCreate = prisma.product.create;
  const originalCategoryFindFirst = prisma.category.findFirst;
  test.after(() => {
    prisma.product.create = originalProductCreate;
    prisma.category.findFirst = originalCategoryFindFirst;
  });

  prisma.category.findFirst = (async () => ({ id: 1, name: "Skincare", slug: "skincare" })) as unknown as typeof prisma.category.findFirst;

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
});
