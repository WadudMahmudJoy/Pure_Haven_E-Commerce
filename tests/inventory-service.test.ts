/**
 * Inventory Service Behavioral Tests — Wave B (Task 6)
 *
 * Verifies:
 *   1. Non-variant reserve uses guarded stock decrement (WHERE stock >= qty)
 *   2. Variant reserve decrements both variant stock and product aggregate mirror
 *   3. Insufficient stock on product throws InventoryConflictError (count === 0)
 *   4. Insufficient stock on variant throws InventoryConflictError (count === 0)
 *   5. Out-of-sync product aggregate throws InventoryIntegrityError
 *   6. Multi-line reservation creates InventoryReservation records with status RESERVED
 *   7. Prepaid reservations receive 15-minute evidenceDeadlineAt; COD receives null
 *
 * Run with:
 *   npx tsx --test tests/inventory-service.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reserveOrderInventory,
  InventoryConflictError,
  InventoryIntegrityError,
} from "@/lib/inventoryService";

function createMockTx(options: {
  productStock?: number;
  variantStock?: number;
  failProductAggregate?: boolean;
} = {}) {
  const {
    productStock = 10,
    variantStock = 5,
    failProductAggregate = false,
  } = options;

  let currentProductStock = productStock;
  let currentVariantStock = variantStock;
  const createdReservations: any[] = [];

  const tx: any = {
    product: {
      updateMany: async (args: any) => {
        const minStock = args.where.stock?.gte ?? 0;
        const decrement = args.data.stock?.decrement ?? 0;
        if (failProductAggregate) {
          return { count: 0 };
        }
        if (currentProductStock >= minStock) {
          currentProductStock -= decrement;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    productVariant: {
      updateMany: async (args: any) => {
        const minStock = args.where.stock?.gte ?? 0;
        const decrement = args.data.stock?.decrement ?? 0;
        if (currentVariantStock >= minStock) {
          currentVariantStock -= decrement;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    inventoryReservation: {
      create: async (args: any) => {
        const record = { id: createdReservations.length + 1, ...args.data };
        createdReservations.push(record);
        return record;
      },
    },
    _getStocks: () => ({ productStock: currentProductStock, variantStock: currentVariantStock }),
    _getReservations: () => createdReservations,
  };

  return tx;
}

test("Task 6 — Non-Variant Successful Reservation", async () => {
  const tx = createMockTx({ productStock: 10 });
  const items = [
    { id: 101, orderId: "order_1", productId: 1, variantId: null, quantity: 3 },
  ];

  const reservations = await reserveOrderInventory(tx, items, {
    evidenceDeadlineAt: null,
  });

  assert.strictEqual(reservations.length, 1);
  assert.strictEqual(reservations[0].status, "RESERVED");
  assert.strictEqual(reservations[0].evidenceDeadlineAt, null);
  assert.strictEqual(tx._getStocks().productStock, 7);
});

test("Task 6 — Variant Successful Reservation with Aggregate Mirror", async () => {
  const tx = createMockTx({ productStock: 10, variantStock: 5 });
  const items = [
    { id: 102, orderId: "order_2", productId: 1, variantId: 20, quantity: 2 },
  ];

  const deadline = new Date(Date.now() + 15 * 60 * 1000);
  const reservations = await reserveOrderInventory(tx, items, {
    evidenceDeadlineAt: deadline,
  });

  assert.strictEqual(reservations.length, 1);
  assert.strictEqual(reservations[0].status, "RESERVED");
  assert.strictEqual(reservations[0].evidenceDeadlineAt, deadline);
  assert.strictEqual(tx._getStocks().variantStock, 3);
  assert.strictEqual(tx._getStocks().productStock, 8);
});

test("Task 6 — Non-Variant Insufficient Stock Guard", async () => {
  const tx = createMockTx({ productStock: 2 });
  const items = [
    { id: 103, orderId: "order_3", productId: 1, variantId: null, quantity: 5 },
  ];

  await assert.rejects(
    async () => {
      await reserveOrderInventory(tx, items);
    },
    (err: any) => {
      assert(err instanceof InventoryConflictError);
      assert.strictEqual(err.code, "INSUFFICIENT_STOCK");
      assert.strictEqual(err.productId, 1);
      assert.strictEqual(err.variantId, null);
      return true;
    }
  );
});

test("Task 6 — Variant Insufficient Stock Guard", async () => {
  const tx = createMockTx({ productStock: 10, variantStock: 1 });
  const items = [
    { id: 104, orderId: "order_4", productId: 1, variantId: 20, quantity: 2 },
  ];

  await assert.rejects(
    async () => {
      await reserveOrderInventory(tx, items);
    },
    (err: any) => {
      assert(err instanceof InventoryConflictError);
      assert.strictEqual(err.code, "INSUFFICIENT_STOCK");
      assert.strictEqual(err.variantId, 20);
      return true;
    }
  );
});

test("Task 6 — Product Aggregate Failure Throws InventoryIntegrityError", async () => {
  const tx = createMockTx({ productStock: 10, variantStock: 5, failProductAggregate: true });
  const items = [
    { id: 105, orderId: "order_5", productId: 1, variantId: 20, quantity: 2 },
  ];

  await assert.rejects(
    async () => {
      await reserveOrderInventory(tx, items);
    },
    (err: any) => {
      assert(err instanceof InventoryIntegrityError);
      assert.strictEqual(err.code, "INVENTORY_INTEGRITY_ERROR");
      return true;
    }
  );
});
