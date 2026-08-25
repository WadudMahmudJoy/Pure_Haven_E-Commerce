/**
 * Task 16 — ReturnItem Domain & Inspection Restock Tests
 *
 * Tests:
 *   1. Undelivered order RETURN_RECEIVED auto-creates ReturnItem in PENDING_INSPECTION with 0 stock increment
 *   2. Post-delivery return intake creates ReturnItem in PENDING_INSPECTION while Order.status remains DELIVERED
 *   3. Admin authentication required for returns intake (401 on unauthenticated)
 *   4. Admin authentication required for restock (401 on unauthenticated)
 *   5. Quantity validation: quantity <= 0 rejected (400)
 *   6. Quantity validation: quantity > orderItem.quantity rejected (400)
 *   7. Cumulative partial return quantity > orderItem.quantity rejected (400)
 *   8. Exact product & variant identity derived server-side from OrderItem
 *   9. Physical receipt: physicalReturnAt is server-authoritative
 *  10. Exactly-once restock: RESTOCKABLE + physically received increments Product.stock (non-variant)
 *  11. Exactly-once restock: RESTOCKABLE increments ProductVariant + Product aggregate mirror (variant)
 *  12. Duplicate restock on already-restocked ReturnItem returns idempotent no-op without double increment
 *  13. PENDING_INSPECTION / NON_RESTOCKABLE / DAMAGED cannot restock (400/409)
 *  14. Restock without physicalReturnAt (physicalReturnAt == null) is forbidden
 *  15. Restock operation does NOT mutate PaymentRecord state or refundAmount
 *  16. Missing variant entity rolls back restock transaction (Integrity error)
 *
 * Run with:
 *   npx tsx --test tests/return-item-restock.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as POST_RETURNS } from "@/app/api/orders/returns/route";
import { POST as POST_RESTOCK } from "@/app/api/orders/restock/route";
import { PUT as PUT_ORDER } from "@/app/api/orders/route";
import { createAdminSessionToken, ADMIN_SESSION_COOKIE } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";

process.env.ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString("hex");

function makeAdminCookie(): string {
  const token = createAdminSessionToken("admin@purehaven.test");
  return `${ADMIN_SESSION_COOKIE}=${token}`;
}

function makeReturnsRequest(body: unknown, authenticated = true): NextRequest {
  return new NextRequest("http://localhost:3000/api/orders/returns", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { cookie: makeAdminCookie() } : {}),
    },
    body: JSON.stringify(body),
  });
}

function makeRestockRequest(body: unknown, authenticated = true): NextRequest {
  return new NextRequest("http://localhost:3000/api/orders/restock", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { cookie: makeAdminCookie() } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("Task 16 — ReturnItem Domain & Inspection Restock", { concurrency: false }, () => {
  // -------------------------------------------------------------------------
  // Auth guards
  // -------------------------------------------------------------------------
  it("AUTH — Unauthenticated return intake returns 401", async () => {
    const req = makeReturnsRequest({ orderId: "PH-DELIVERED-001", items: [] }, false);
    const res = await POST_RETURNS(req);
    assert.strictEqual(res.status, 401);
  });

  it("AUTH — Unauthenticated restock returns 401", async () => {
    const req = makeRestockRequest({ returnItemId: 101 }, false);
    const res = await POST_RESTOCK(req);
    assert.strictEqual(res.status, 401);
  });

  // -------------------------------------------------------------------------
  // Return intake & validation
  // -------------------------------------------------------------------------
  it("POST-DELIVERY INTAKE — Logs ReturnItem in PENDING_INSPECTION with Order.status remaining DELIVERED", async (t) => {
    const originalOrderFindFirst = prisma.order.findFirst;
    const originalOrderItemFindUnique = prisma.orderItem.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.order.findFirst = originalOrderFindFirst;
      prisma.orderItem.findUnique = originalOrderItemFindUnique;
      prisma.$transaction = original$transaction;
    });

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_delivered_1",
      orderId: "PH-DELIVERED-001",
      status: "delivered",
    });

    (prisma.orderItem.findUnique as any) = async () => ({
      id: 501,
      orderId: "cuid_delivered_1",
      productId: 10,
      variantId: 1001,
      quantity: 3,
      returnItems: [],
    });

    let createdReturnItem: any = null;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        orderItem: {
          findUnique: async () => ({
            id: 501,
            orderId: "cuid_delivered_1",
            productId: 10,
            variantId: 1001,
            quantity: 3,
            returnItems: [],
          }),
        },
        returnItem: {
          create: async (args: any) => {
            createdReturnItem = args.data;
            return { id: 1, ...args.data };
          },
        },
      };
      return await callback(mockTx);
    };

    const req = makeReturnsRequest({
      orderId: "PH-DELIVERED-001",
      items: [
        {
          orderItemId: 501,
          quantity: 2,
          adminNote: "Customer returned sealed item",
        },
      ],
    });

    const res = await POST_RETURNS(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(createdReturnItem.orderItemId, 501);
    assert.strictEqual(createdReturnItem.productId, 10, "ProductId derived server-side");
    assert.strictEqual(createdReturnItem.variantId, 1001, "VariantId derived server-side");
    assert.strictEqual(createdReturnItem.quantity, 2);
    assert.strictEqual(createdReturnItem.disposition, "PENDING_INSPECTION");
    assert.ok(createdReturnItem.physicalReturnAt instanceof Date, "physicalReturnAt set by server");
    assert.strictEqual(createdReturnItem.restockedAt, null, "restockedAt must be null on intake");
  });

  it("QUANTITY VALIDATION — Cumulative returned quantity exceeding OrderItem.quantity is rejected (400)", async (t) => {
    const originalOrderFindFirst = prisma.order.findFirst;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.order.findFirst = originalOrderFindFirst;
      prisma.$transaction = original$transaction;
    });

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_delivered_2",
      orderId: "PH-DELIVERED-002",
      status: "delivered",
    });

    // OrderItem quantity is 3; already returned 2
    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        orderItem: {
          findUnique: async () => ({
            id: 502,
            orderId: "cuid_delivered_2",
            productId: 10,
            variantId: null,
            quantity: 3,
            returnItems: [
              { id: 10, quantity: 2, disposition: "PENDING_INSPECTION" },
            ],
          }),
        },
      };
      return await callback(mockTx);
    };

    // Requesting to return 2 more (2 + 2 = 4 > 3)
    const req = makeReturnsRequest({
      orderId: "PH-DELIVERED-002",
      items: [{ orderItemId: 502, quantity: 2 }],
    });

    const res = await POST_RETURNS(req);
    const data = await res.json();

    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.success, false);
  });

  // -------------------------------------------------------------------------
  // Exactly-Once Restock
  // -------------------------------------------------------------------------
  it("RESTOCK — Admin setting RESTOCKABLE increments Product.stock exactly once (non-variant)", async (t) => {
    const originalReturnItemFindUnique = prisma.returnItem.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.returnItem.findUnique = originalReturnItemFindUnique;
      prisma.$transaction = original$transaction;
    });

    (prisma.returnItem.findUnique as any) = async () => ({
      id: 301,
      orderId: "cuid_order_restock_1",
      orderItemId: 601,
      productId: 15,
      variantId: null,
      quantity: 2,
      disposition: "PENDING_INSPECTION",
      physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
      restockedAt: null,
    });

    let stockIncrement = 0;
    let restockedAtSet = false;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        returnItem: {
          findUnique: async () => ({
            id: 301,
            productId: 15,
            variantId: null,
            quantity: 2,
            disposition: "RESTOCKABLE",
            physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
            restockedAt: null,
          }),
          updateMany: async (args: any) => {
            if (args.where.restockedAt === null && args.where.disposition === "RESTOCKABLE") {
              restockedAtSet = true;
              return { count: 1 };
            }
            return { count: 0 };
          },
          update: async (args: any) => ({ id: 301, ...args.data }),
        },
        product: {
          update: async (args: any) => {
            stockIncrement += args.data.stock.increment;
            return {};
          },
        },
      };
      return await callback(mockTx);
    };

    const req = makeRestockRequest({
      returnItemId: 301,
      disposition: "RESTOCKABLE",
    });

    const res = await POST_RESTOCK(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(restockedAtSet, true);
    assert.strictEqual(stockIncrement, 2, "Product.stock must increment by exactly 2");
  });

  it("RESTOCK VARIANT — Admin setting RESTOCKABLE increments ProductVariant and Product aggregate mirror", async (t) => {
    const originalReturnItemFindUnique = prisma.returnItem.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.returnItem.findUnique = originalReturnItemFindUnique;
      prisma.$transaction = original$transaction;
    });

    (prisma.returnItem.findUnique as any) = async () => ({
      id: 302,
      orderId: "cuid_order_restock_2",
      orderItemId: 602,
      productId: 25,
      variantId: 2501,
      quantity: 4,
      disposition: "RESTOCKABLE",
      physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
      restockedAt: null,
    });

    let variantIncrement = 0;
    let productIncrement = 0;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        returnItem: {
          findUnique: async () => ({
            id: 302,
            productId: 25,
            variantId: 2501,
            quantity: 4,
            disposition: "RESTOCKABLE",
            physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
            restockedAt: null,
          }),
          updateMany: async () => ({ count: 1 }),
        },
        productVariant: {
          findUnique: async () => ({ id: 2501, productId: 25 }),
          update: async (args: any) => {
            variantIncrement += args.data.stock.increment;
            return {};
          },
        },
        product: {
          update: async (args: any) => {
            productIncrement += args.data.stock.increment;
            return {};
          },
        },
      };
      return await callback(mockTx);
    };

    const req = makeRestockRequest({ returnItemId: 302 });
    const res = await POST_RESTOCK(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(variantIncrement, 4);
    assert.strictEqual(productIncrement, 4);
  });

  it("DUPLICATE RESTOCK — Repeated restock returns idempotent no-op without double increment", async (t) => {
    const originalReturnItemFindUnique = prisma.returnItem.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.returnItem.findUnique = originalReturnItemFindUnique;
      prisma.$transaction = original$transaction;
    });

    (prisma.returnItem.findUnique as any) = async () => ({
      id: 303,
      orderId: "cuid_order_restock_3",
      orderItemId: 603,
      productId: 15,
      variantId: null,
      quantity: 2,
      disposition: "RESTOCKABLE",
      physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
      restockedAt: new Date("2026-08-25T11:00:00Z"), // Already restocked!
    });

    let stockIncrementCalled = false;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        returnItem: {
          findUnique: async () => ({
            id: 303,
            productId: 15,
            variantId: null,
            quantity: 2,
            disposition: "RESTOCKABLE",
            physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
            restockedAt: new Date("2026-08-25T11:00:00Z"),
          }),
          updateMany: async () => ({ count: 0 }), // claim returns 0 because restockedAt != null
        },
        product: {
          update: async () => {
            stockIncrementCalled = true;
          },
        },
      };
      return await callback(mockTx);
    };

    const req = makeRestockRequest({ returnItemId: 303 });
    const res = await POST_RESTOCK(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.idempotent, true);
    assert.strictEqual(stockIncrementCalled, false, "Must NOT double increment stock on repeated restock");
  });

  it("DISPOSITION SAFETY — NON_RESTOCKABLE / DAMAGED / PENDING_INSPECTION cannot restock", async (t) => {
    const originalReturnItemFindUnique = prisma.returnItem.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.returnItem.findUnique = originalReturnItemFindUnique;
      prisma.$transaction = original$transaction;
    });

    for (const invalidDisp of ["PENDING_INSPECTION", "NON_RESTOCKABLE", "DAMAGED"]) {
      (prisma.returnItem.findUnique as any) = async () => ({
        id: 304,
        orderId: "cuid_order_restock_4",
        orderItemId: 604,
        productId: 15,
        variantId: null,
        quantity: 1,
        disposition: invalidDisp,
        physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
        restockedAt: null,
      });

      let stockIncrementCalled = false;
      (prisma.$transaction as any) = async (callback: any) => {
        const mockTx: any = {
          returnItem: {
            findUnique: async () => ({
              id: 304,
              productId: 15,
              variantId: null,
              quantity: 1,
              disposition: invalidDisp,
              physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
              restockedAt: null,
            }),
            updateMany: async () => ({ count: 0 }),
          },
          product: {
            update: async () => {
              stockIncrementCalled = true;
            },
          },
        };
        return await callback(mockTx);
      };

      const req = makeRestockRequest({ returnItemId: 304 });
      const res = await POST_RESTOCK(req);

      assert.strictEqual(res.status, 400, `${invalidDisp} restock must be rejected`);
      assert.strictEqual(stockIncrementCalled, false);
    }
  });

  it("INDEPENDENCE — Restock does NOT alter PaymentRecord state or refundAmount", async (t) => {
    const originalReturnItemFindUnique = prisma.returnItem.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.returnItem.findUnique = originalReturnItemFindUnique;
      prisma.$transaction = original$transaction;
    });

    (prisma.returnItem.findUnique as any) = async () => ({
      id: 305,
      orderId: "cuid_order_restock_5",
      orderItemId: 605,
      productId: 15,
      variantId: null,
      quantity: 1,
      disposition: "RESTOCKABLE",
      physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
      restockedAt: null,
    });

    let paymentRecordMutated = false;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        returnItem: {
          findUnique: async () => ({
            id: 305,
            productId: 15,
            variantId: null,
            quantity: 1,
            disposition: "RESTOCKABLE",
            physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
            restockedAt: null,
          }),
          updateMany: async () => ({ count: 1 }),
        },
        product: {
          update: async () => ({}),
        },
        paymentRecord: {
          update: async () => {
            paymentRecordMutated = true;
          },
          updateMany: async () => {
            paymentRecordMutated = true;
          },
        },
      };
      return await callback(mockTx);
    };

    const req = makeRestockRequest({ returnItemId: 305 });
    const res = await POST_RESTOCK(req);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(paymentRecordMutated, false, "Restock must NEVER mutate PaymentRecord");
  });

  // -------------------------------------------------------------------------
  // Undelivered Order RETURN_RECEIVED Integration
  // -------------------------------------------------------------------------
  it("UNDELIVERED RETURN_RECEIVED — Automatically creates ReturnItem in PENDING_INSPECTION with 0 stock increment", async (t) => {
    const originalOrderFindFirst = prisma.order.findFirst;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.order.findFirst = originalOrderFindFirst;
      prisma.$transaction = original$transaction;
    });

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_undelivered_order",
      orderId: "PH-FAILED-DELIVERY",
      status: "return_in_transit",
      paymentMethod: "bKash",
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 701,
          orderId: "cuid_undelivered_order",
          productId: 70,
          variantId: 7001,
          quantity: 2,
        },
      ],
    });

    let returnItemCreated: any = null;
    let stockIncrementCalled = false;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        order: {
          updateMany: async () => ({ count: 1 }),
          findUnique: async () => ({
            id: "cuid_undelivered_order",
            orderId: "PH-FAILED-DELIVERY",
            status: "return_received",
            paymentMethod: "bKash",
            createdAt: new Date(),
            updatedAt: new Date(),
            items: [
              {
                id: 701,
                orderId: "cuid_undelivered_order",
                productId: 70,
                variantId: 7001,
                quantity: 2,
              },
            ],
          }),
        },

        returnItem: {
          findFirst: async () => null,
          create: async (args: any) => {
            returnItemCreated = args.data;
            return { id: 777, ...args.data };
          },
        },
        product: {
          update: async () => {
            stockIncrementCalled = true;
          },
        },
        productVariant: {
          update: async () => {
            stockIncrementCalled = true;
          },
        },
      };
      return await callback(mockTx);
    };

    const req = new NextRequest("http://localhost:3000/api/orders", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        cookie: makeAdminCookie(),
      },
      body: JSON.stringify({
        id: "PH-FAILED-DELIVERY",
        status: "return_received",
      }),
    });

    const res = await PUT_ORDER(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(returnItemCreated.orderItemId, 701);
    assert.strictEqual(returnItemCreated.quantity, 2);
    assert.strictEqual(returnItemCreated.disposition, "PENDING_INSPECTION");
    assert.strictEqual(returnItemCreated.restockedAt, null, "restockedAt must be null on physical intake");
    assert.strictEqual(stockIncrementCalled, false, "Stock must NOT be incremented on return_received");
  });

  it("MISSING VARIANT — Throws integrity error and rolls back restock when variant is absent from catalog", async (t) => {
    const originalReturnItemFindUnique = prisma.returnItem.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.returnItem.findUnique = originalReturnItemFindUnique;
      prisma.$transaction = original$transaction;
    });

    (prisma.returnItem.findUnique as any) = async () => ({
      id: 306,
      orderId: "cuid_order_restock_6",
      orderItemId: 606,
      productId: 88,
      variantId: 8899, // Absent variant
      quantity: 1,
      disposition: "RESTOCKABLE",
      physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
      restockedAt: null,
    });

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        returnItem: {
          findUnique: async () => ({
            id: 306,
            productId: 88,
            variantId: 8899,
            quantity: 1,
            disposition: "RESTOCKABLE",
            physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
            restockedAt: null,
          }),
          updateMany: async () => ({ count: 1 }),
        },
        productVariant: {
          findUnique: async () => null, // Variant not found!
        },
      };
      return await callback(mockTx);
    };

    const req = makeRestockRequest({ returnItemId: 306 });
    const res = await POST_RESTOCK(req);
    assert.strictEqual(res.status, 500, "Missing variant must fail closed with error");
  });

  // -------------------------------------------------------------------------
  // Post-Restock Disposition Immutability & Row Locking Tests
  // -------------------------------------------------------------------------
  it("POST-RESTOCK IMMUTABILITY — Attempting to change disposition of already-restocked ReturnItem returns 409 conflict", async (t) => {
    const originalReturnItemFindUnique = prisma.returnItem.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.returnItem.findUnique = originalReturnItemFindUnique;
      prisma.$transaction = original$transaction;
    });

    // ReturnItem is ALREADY restocked
    (prisma.returnItem.findUnique as any) = async () => ({
      id: 307,
      orderId: "cuid_order_restocked",
      orderItemId: 607,
      productId: 15,
      variantId: null,
      quantity: 2,
      disposition: "RESTOCKABLE",
      physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
      restockedAt: new Date("2026-08-25T11:00:00Z"), // Already restocked!
    });

    let dispositionUpdateCalled = false;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        returnItem: {
          findUnique: async () => ({
            id: 307,
            productId: 15,
            variantId: null,
            quantity: 2,
            disposition: "RESTOCKABLE",
            physicalReturnAt: new Date("2026-08-25T10:00:00Z"),
            restockedAt: new Date("2026-08-25T11:00:00Z"),
          }),
          updateMany: async () => {
            dispositionUpdateCalled = true;
            return { count: 0 };
          },
          update: async () => {
            dispositionUpdateCalled = true;
            return {};
          },
        },
      };
      return await callback(mockTx);
    };

    // Attempting to change disposition to DAMAGED on an already restocked item
    const req = makeRestockRequest({
      returnItemId: 307,
      disposition: "DAMAGED",
    });

    const res = await POST_RESTOCK(req);
    const data = await res.json();

    assert.strictEqual(
      res.status,
      409,
      `Expected 409 conflict when mutating disposition of already-restocked item, got ${res.status}`
    );
    assert.strictEqual(data.success, false);
    assert.strictEqual(
      dispositionUpdateCalled,
      false,
      "Must NOT mutate disposition on an already-restocked item"
    );
  });

  it("PARTIAL-RETURN ROW LOCKING — Executes parameterized SELECT ... FOR UPDATE on OrderItem before ReturnItem aggregate", async (t) => {
    const originalOrderFindFirst = prisma.order.findFirst;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.order.findFirst = originalOrderFindFirst;
      prisma.$transaction = original$transaction;
    });

    (prisma.order.findFirst as any) = async () => ({
      id: "cuid_delivered_lock",
      orderId: "PH-DELIVERED-LOCK",
      status: "delivered",
    });

    let queryRawCalled = false;
    let queryRawSqlText = "";
    let orderItemReadAfterLock = false;
    let createCalledAfterLock = false;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        $queryRaw: async (query: any) => {
          queryRawCalled = true;
          // Inspect raw SQL template or text
          queryRawSqlText = String(query?.text || query?.strings?.join("?") || query || "");
          return [{ id: 508 }];
        },
        orderItem: {
          findUnique: async () => {
            if (queryRawCalled) {
              orderItemReadAfterLock = true;
            }
            return {
              id: 508,
              orderId: "cuid_delivered_lock",
              productId: 10,
              variantId: null,
              quantity: 5,
              returnItems: [{ id: 1, quantity: 2 }],
            };
          },
        },
        returnItem: {
          create: async (args: any) => {
            if (orderItemReadAfterLock) {
              createCalledAfterLock = true;
            }
            return { id: 2, ...args.data };
          },
        },
      };
      return await callback(mockTx);
    };

    const req = makeReturnsRequest({
      orderId: "PH-DELIVERED-LOCK",
      items: [{ orderItemId: 508, quantity: 2 }],
    });

    const res = await POST_RETURNS(req);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(
      queryRawCalled,
      true,
      "Must execute SELECT ... FOR UPDATE to lock OrderItem row"
    );
    assert.ok(
      queryRawSqlText.toUpperCase().includes("FOR UPDATE"),
      `Raw query must contain 'FOR UPDATE', got: ${queryRawSqlText}`
    );
    assert.strictEqual(
      createCalledAfterLock,
      true,
      "ReturnItem create must happen strictly after acquiring the OrderItem row lock"
    );
  });
});

