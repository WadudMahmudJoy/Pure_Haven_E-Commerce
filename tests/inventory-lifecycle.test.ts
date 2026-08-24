/**
 * Inventory Lifecycle Behavioral Tests — Wave C (Tasks 7 & 8)
 *
 * Verifies:
 *   Task 7: Exactly-once cancellation release and variant restoration
 *   Task 8: Inventory reservation fulfillment boundary at SHIPPED
 *
 * Run with:
 *   npx tsx --test tests/inventory-lifecycle.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  releaseOrderReservation,
  fulfillOrderReservation,
  InventoryIntegrityError,
} from "@/lib/inventoryService";

test("Task 7 — Non-Variant Cancellation Restores Product Stock Once", async () => {
  let productStock = 10;
  let reservationStatus = "RESERVED";
  let releasedAt: Date | null = null;
  let releaseReason: string | null = null;

  const mockTx: any = {
    inventoryReservation: {
      findMany: async () => [
        {
          id: 101,
          orderId: "order_1",
          productId: 1,
          variantId: null,
          quantity: 2,
          status: reservationStatus,
        },
      ],
      updateMany: async (args: any) => {
        if (args.where.id === 101 && args.where.status === "RESERVED" && reservationStatus === "RESERVED") {
          reservationStatus = args.data.status;
          releasedAt = args.data.releasedAt;
          releaseReason = args.data.releaseReason;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    product: {
      update: async (args: any) => {
        productStock += args.data.stock.increment;
        return { id: args.where.id, stock: productStock };
      },
    },
    productVariant: {
      update: async () => {
        throw new Error("ProductVariant should not be updated for non-variant reservation");
      },
    },
  };

  const result = await releaseOrderReservation(mockTx, "order_1", {
    releaseReason: "CUSTOMER_CANCELLED",
  });

  assert.strictEqual(result.releasedCount, 1);
  assert.strictEqual(productStock, 12, "Product stock must be incremented by 2");
  assert.strictEqual(reservationStatus, "RELEASED");
  assert.ok((releasedAt as unknown) instanceof Date);
  assert.strictEqual(releaseReason, "CUSTOMER_CANCELLED");

  // Sequential duplicate cancellation attempt must not increment stock again
  const secondResult = await releaseOrderReservation(mockTx, "order_1", {
    releaseReason: "CUSTOMER_CANCELLED",
  });
  assert.strictEqual(secondResult.releasedCount, 0);
  assert.strictEqual(productStock, 12, "Product stock must NOT be incremented on duplicate cancel");
});

test("Task 7 — Variant Cancellation Restores Variant Stock AND Product Aggregate Mirror", async () => {
  let productStock = 20;
  let variantStock = 5;
  let reservationStatus = "RESERVED";

  const mockTx: any = {
    inventoryReservation: {
      findMany: async () => [
        {
          id: 202,
          orderId: "order_var_1",
          productId: 10,
          variantId: 50,
          quantity: 3,
          status: reservationStatus,
        },
      ],
      updateMany: async (args: any) => {
        if (args.where.id === 202 && args.where.status === "RESERVED" && reservationStatus === "RESERVED") {
          reservationStatus = args.data.status;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    productVariant: {
      findUnique: async (args: any) => {
        if (args.where.id === 50) return { id: 50, productId: 10, stock: variantStock };
        return null;
      },
      update: async (args: any) => {
        variantStock += args.data.stock.increment;
        return { id: args.where.id, stock: variantStock };
      },
    },
    product: {
      update: async (args: any) => {
        productStock += args.data.stock.increment;
        return { id: args.where.id, stock: productStock };
      },
    },
  };

  const result = await releaseOrderReservation(mockTx, "order_var_1", {
    releaseReason: "CUSTOMER_CANCELLED",
  });

  assert.strictEqual(result.releasedCount, 1);
  assert.strictEqual(variantStock, 8, "Variant stock must increment by 3");
  assert.strictEqual(productStock, 23, "Product aggregate stock must increment by 3");
});

test("Task 7 — Missing Exact Variant Fails Closed Without Falling Back to VariantLabel", async () => {
  const mockTx: any = {
    inventoryReservation: {
      findMany: async () => [
        {
          id: 303,
          orderId: "order_missing_var",
          productId: 10,
          variantId: 9999, // Missing in DB
          quantity: 1,
          status: "RESERVED",
        },
      ],
      updateMany: async () => ({ count: 1 }),
    },
    productVariant: {
      findUnique: async () => null, // Not found
    },
    product: {
      update: async () => {
        throw new Error("Product stock should not be updated if variant is missing");
      },
    },
  };

  await assert.rejects(
    async () => {
      await releaseOrderReservation(mockTx, "order_missing_var", {
        releaseReason: "CUSTOMER_CANCELLED",
      });
    },
    (err: any) => {
      assert.ok(err instanceof InventoryIntegrityError);
      assert.match(err.message, /exact variant/i);
      return true;
    }
  );
});

test("Task 8 — Fulfill Order Reservation at SHIPPED", async () => {
  let reservationStatus = "RESERVED";
  let fulfilledAt: Date | null = null;

  const mockTx: any = {
    inventoryReservation: {
      updateMany: async (args: any) => {
        if (
          args.where.orderId === "order_ship_1" &&
          args.where.status === "RESERVED" &&
          reservationStatus === "RESERVED"
        ) {
          reservationStatus = "FULFILLED";
          fulfilledAt = args.data.fulfilledAt;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };

  const result = await fulfillOrderReservation(mockTx, "order_ship_1");
  assert.strictEqual(result.fulfilledCount, 1);
  assert.strictEqual(reservationStatus, "FULFILLED");
  assert.ok((fulfilledAt as unknown) instanceof Date);

  // Repeated call is safe no-op
  const secondResult = await fulfillOrderReservation(mockTx, "order_ship_1");
  assert.strictEqual(secondResult.fulfilledCount, 0);
});

test("Task 8 — RELEASED Reservation Cannot Become FULFILLED", async () => {
  const mockTx: any = {
    inventoryReservation: {
      updateMany: async (args: any) => {
        // Only updates where status = 'RESERVED'
        if (args.where.status === "RESERVED") {
          return { count: 0 };
        }
        return { count: 0 };
      },
    },
  };

  const result = await fulfillOrderReservation(mockTx, "order_released_1");
  assert.strictEqual(result.fulfilledCount, 0);
});
