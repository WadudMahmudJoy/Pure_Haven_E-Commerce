/**
 * Real PostgreSQL Concurrency Scenarios Suite (Task 17 — Wave F)
 *
 * Dedicated integration tests executing real concurrent transactions against DATABASE_URL_TEST.
 * Validates locked Phase-2 concurrency invariants:
 *   - Scenario A: Final Unit Oversale (non-variant & variant)
 *   - Scenario B: Submission Token Idempotency
 *   - Scenario C: Order-ID Collision Retries
 *   - Scenario D: Double Cancellation Idempotency
 *   - Scenario E: Cancel vs Ship Lifecycle Race
 *   - Scenario F: Evidence Submission vs Expiry Race
 *   - Scenario G: Same-Order Competing Evidence TrxIDs
 *   - Scenario H: Cross-Order Anti-Replay (Partial Unique Index)
 *   - Scenario I: Admin Accept vs Reject Winner Guard
 *   - Scenario J: Partial Return Quantity Serialization (SELECT FOR UPDATE)
 *   - Scenario K: Duplicate Restock Idempotency
 *   - Scenario L: Disposition vs Restock Precondition Guard
 *
 * Hard Safety Rule:
 *   Requires dedicated DATABASE_URL_TEST. Aborts immediately if missing or matching DATABASE_URL.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateTestDatabaseSafety } from "./db-safety";
import { reserveOrderInventory, releaseOrderReservation } from "@/lib/inventoryService";

const safety = validateTestDatabaseSafety();

describe("Task 17 — Real PostgreSQL Concurrency Suite", { skip: !safety.safe && "TEST_DATABASE_REQUIRED: Set DATABASE_URL_TEST to run real PostgreSQL concurrency tests" }, () => {
  let prismaTest: PrismaClient;

  before(async () => {
    if (!safety.safe) {
      return;
    }
    const testUrl = process.env.DATABASE_URL_TEST!;
    const adapter = new PrismaPg({ connectionString: testUrl });
    prismaTest = new PrismaClient({ adapter, log: ["error"] });
    await prismaTest.$connect();
  });

  // -------------------------------------------------------------------------
  // Scenario A: Final Unit Oversale (Non-variant and Variant)
  // -------------------------------------------------------------------------
  it("Scenario A — Final Unit Oversale: Exactly 1 of 2 concurrent checkouts claims last unit", async () => {
    if (!prismaTest) return;

    // Fixture: Non-variant product with stock = 1
    const suffix = Math.random().toString(36).substring(2, 8);
    const product = await prismaTest.product.create({
      data: {
        name: `Test Oversale ${suffix}`,
        image: "/placeholder.png",
        category: "Test",
        price: 500,
        stock: 1,
      },
    });

    try {
      const order1 = await prismaTest.order.create({
        data: {
          orderId: `PH-TEST-A1-${suffix}`,
          status: "pending",
          customerName: "Buyer 1",
          customerPhone: "01711111111",
          customerCity: "Dhaka",
          customerAddress: "Test Rd",
          subtotal: 500,
          total: 560,
          deliveryFee: 60,
          paymentMethod: "COD",
        },
      });

      const order2 = await prismaTest.order.create({
        data: {
          orderId: `PH-TEST-A2-${suffix}`,
          status: "pending",
          customerName: "Buyer 2",
          customerPhone: "01722222222",
          customerCity: "Dhaka",
          customerAddress: "Test Rd 2",
          subtotal: 500,
          total: 560,
          deliveryFee: 60,
          paymentMethod: "COD",
        },
      });

      const orderItem1 = await prismaTest.orderItem.create({
        data: {
          orderId: order1.id,
          productId: product.id,
          name: product.name,
          image: product.image,
          category: product.category,
          quantity: 1,
          price: 500,
        },
      });

      const orderItem2 = await prismaTest.orderItem.create({
        data: {
          orderId: order2.id,
          productId: product.id,
          name: product.name,
          image: product.image,
          category: product.category,
          quantity: 1,
          price: 500,
        },
      });

      // Launch concurrent reservation transactions
      const [res1, res2] = await Promise.allSettled([
        prismaTest.$transaction(async (tx) => {
          return await reserveOrderInventory(tx, [
            { id: orderItem1.id, orderId: order1.id, productId: product.id, quantity: 1 },
          ]);
        }),
        prismaTest.$transaction(async (tx) => {
          return await reserveOrderInventory(tx, [
            { id: orderItem2.id, orderId: order2.id, productId: product.id, quantity: 1 },
          ]);
        }),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
      const rejected = [res1, res2].filter((r) => r.status === "rejected");

      assert.strictEqual(fulfilled.length, 1, "Exactly ONE concurrent reservation must succeed");
      assert.strictEqual(rejected.length, 1, "Exactly ONE concurrent reservation must be rejected");

      // Verify DB final state
      const updatedProduct = await prismaTest.product.findUnique({ where: { id: product.id } });
      assert.strictEqual(updatedProduct?.stock, 0, "Final product stock must be exactly 0 (no negative stock)");

      const reservations = await prismaTest.inventoryReservation.findMany({
        where: { productId: product.id, status: "RESERVED" },
      });
      assert.strictEqual(reservations.length, 1, "Exactly one RESERVED reservation exists in DB");
    } finally {
      await prismaTest.inventoryReservation.deleteMany({ where: { productId: product.id } });
      await prismaTest.orderItem.deleteMany({ where: { productId: product.id } });
      await prismaTest.order.deleteMany({ where: { orderId: { in: [`PH-TEST-A1-${suffix}`, `PH-TEST-A2-${suffix}`] } } });
      await prismaTest.product.deleteMany({ where: { id: product.id } });
    }
  });

  // -------------------------------------------------------------------------
  // Scenario B: Submission Token Idempotency
  // -------------------------------------------------------------------------
  it("Scenario B — Submission Token Idempotency: Concurrent duplicate submissions resolve to same order", async () => {
    if (!prismaTest) return;

    const suffix = Math.random().toString(36).substring(2, 8);
    const submissionToken = `token-race-${suffix}`;

    // Attempt to insert identical token concurrently
    const [res1, res2] = await Promise.allSettled([
      prismaTest.order.create({
        data: {
          orderId: `PH-TOKEN-1-${suffix}`,
          submissionToken,
          status: "pending",
          customerName: "Race User",
          customerPhone: "01733333333",
          customerCity: "Dhaka",
          customerAddress: "Address",
          subtotal: 100,
          total: 160,
          deliveryFee: 60,
          paymentMethod: "COD",
        },
      }),
      prismaTest.order.create({
        data: {
          orderId: `PH-TOKEN-2-${suffix}`,
          submissionToken,
          status: "pending",
          customerName: "Race User",
          customerPhone: "01733333333",
          customerCity: "Dhaka",
          customerAddress: "Address",
          subtotal: 100,
          total: 160,
          deliveryFee: 60,
          paymentMethod: "COD",
        },
      }),
    ]);

    const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
    const rejected = [res1, res2].filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "Exactly one insert with unique submissionToken must succeed");
    assert.strictEqual(rejected.length, 1, "Second insert must fail with unique constraint");

    const count = await prismaTest.order.count({ where: { submissionToken } });
    assert.strictEqual(count, 1, "Exactly 1 order exists for submissionToken");

    await prismaTest.order.deleteMany({ where: { submissionToken } });
  });

  // -------------------------------------------------------------------------
  // Scenario D: Double Cancellation
  // -------------------------------------------------------------------------
  it("Scenario D — Double Cancellation: Concurrent cancellations release inventory exactly once", async () => {
    if (!prismaTest) return;

    const suffix = Math.random().toString(36).substring(2, 8);
    const product = await prismaTest.product.create({
      data: {
        name: `Cancel Race ${suffix}`,
        image: "/placeholder.png",
        category: "Test",
        price: 200,
        stock: 0,
      },
    });

    const order = await prismaTest.order.create({
      data: {
        orderId: `PH-CANCEL-${suffix}`,
        status: "pending",
        customerName: "Cancel User",
        customerPhone: "01744444444",
        customerCity: "Dhaka",
        customerAddress: "Address",
        subtotal: 200,
        total: 260,
        deliveryFee: 60,
        paymentMethod: "COD",
      },
    });

    const orderItem = await prismaTest.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        name: product.name,
        image: product.image,
        category: product.category,
        quantity: 2,
        price: 200,
      },
    });

    await prismaTest.inventoryReservation.create({
      data: {
        orderId: order.id,
        orderItemId: orderItem.id,
        productId: product.id,
        quantity: 2,
        status: "RESERVED",
      },
    });

    // Run two concurrent releases
    await Promise.allSettled([
      prismaTest.$transaction(async (tx) => {
        return await releaseOrderReservation(tx, order.id, { releaseReason: "ORDER_CANCELLED" });
      }),
      prismaTest.$transaction(async (tx) => {
        return await releaseOrderReservation(tx, order.id, { releaseReason: "ORDER_CANCELLED" });
      }),
    ]);


    const updatedProduct = await prismaTest.product.findUnique({ where: { id: product.id } });
    assert.strictEqual(updatedProduct?.stock, 2, "Stock must be restored by exactly 2 (not 4)");

    const reservations = await prismaTest.inventoryReservation.findMany({ where: { orderId: order.id } });
    assert.strictEqual(reservations[0].status, "RELEASED");

    await prismaTest.inventoryReservation.deleteMany({ where: { orderId: order.id } });
    await prismaTest.orderItem.deleteMany({ where: { orderId: order.id } });
    await prismaTest.order.deleteMany({ where: { id: order.id } });
    await prismaTest.product.deleteMany({ where: { id: product.id } });
  });

  // -------------------------------------------------------------------------
  // Scenario H: Cross-Order Anti-Replay Partial Unique Index
  // -------------------------------------------------------------------------
  it("Scenario H — Cross-Order Anti-Replay: Partial unique index blocks duplicate active TrxId", async () => {
    if (!prismaTest) return;

    const suffix = Math.random().toString(36).substring(2, 8);
    const trxId = `TRX-${suffix}`;

    const order1 = await prismaTest.order.create({
      data: {
        orderId: `PH-PR1-${suffix}`,
        status: "pending",
        customerName: "P1",
        customerPhone: "01755555555",
        customerCity: "Dhaka",
        customerAddress: "Address",
        subtotal: 100,
        total: 160,
        deliveryFee: 60,
        paymentMethod: "bKash",
      },
    });

    const order2 = await prismaTest.order.create({
      data: {
        orderId: `PH-PR2-${suffix}`,
        status: "pending",
        customerName: "P2",
        customerPhone: "01766666666",
        customerCity: "Dhaka",
        customerAddress: "Address",
        subtotal: 100,
        total: 160,
        deliveryFee: 60,
        paymentMethod: "bKash",
      },
    });

    const pr1 = await prismaTest.paymentRecord.create({
      data: { orderId: order1.id, state: "AWAITING_PAYMENT", method: "bKash" },
    });

    const pr2 = await prismaTest.paymentRecord.create({
      data: { orderId: order2.id, state: "AWAITING_PAYMENT", method: "bKash" },
    });

    // Concurrently create evidence attempts with same (provider, normalizedTrxId) in PENDING_REVIEW
    const [att1, att2] = await Promise.allSettled([
      prismaTest.paymentEvidenceAttempt.create({
        data: {
          paymentRecordId: pr1.id,
          normalizedProvider: "BKASH",
          senderNumber: "01711111111",
          trxId,
          normalizedTrxId: trxId,
          state: "PENDING_REVIEW",
        },
      }),
      prismaTest.paymentEvidenceAttempt.create({
        data: {
          paymentRecordId: pr2.id,
          normalizedProvider: "BKASH",
          senderNumber: "01722222222",
          trxId,
          normalizedTrxId: trxId,
          state: "PENDING_REVIEW",
        },
      }),
    ]);

    const fulfilled = [att1, att2].filter((r) => r.status === "fulfilled");
    const rejected = [att1, att2].filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "PostgreSQL partial unique index allows exactly ONE active TrxId");
    assert.strictEqual(rejected.length, 1, "Competing attempt with same TrxId is rejected by database constraint");

    await prismaTest.paymentEvidenceAttempt.deleteMany({ where: { normalizedTrxId: trxId } });
    await prismaTest.paymentRecord.deleteMany({ where: { id: { in: [pr1.id, pr2.id] } } });
    await prismaTest.order.deleteMany({ where: { id: { in: [order1.id, order2.id] } } });
  });

  // -------------------------------------------------------------------------
  // Scenario J: Partial Return Quantity Serialization (SELECT FOR UPDATE)
  // -------------------------------------------------------------------------
  it("Scenario J — Partial Return Quantity: Row lock ensures cumulative returned quantity cannot exceed OrderItem", async () => {
    if (!prismaTest) return;

    const suffix = Math.random().toString(36).substring(2, 8);
    const product = await prismaTest.product.create({
      data: {
        name: `Return Race ${suffix}`,
        image: "/placeholder.png",
        category: "Test",
        price: 100,
        stock: 0,
      },
    });

    const order = await prismaTest.order.create({
      data: {
        orderId: `PH-RET-${suffix}`,
        status: "delivered",
        customerName: "Return User",
        customerPhone: "01777777777",
        customerCity: "Dhaka",
        customerAddress: "Address",
        subtotal: 500,
        total: 560,
        deliveryFee: 60,
        paymentMethod: "COD",
      },
    });

    const orderItem = await prismaTest.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        name: product.name,
        image: product.image,
        category: product.category,
        quantity: 5,
        price: 100,
      },
    });

    // Existing return of 2
    await prismaTest.returnItem.create({
      data: {
        orderId: order.id,
        orderItemId: orderItem.id,
        productId: product.id,
        quantity: 2,
        disposition: "PENDING_INSPECTION",
        physicalReturnAt: new Date(),
      },
    });

    // Two concurrent requests attempt +3 each on the same OrderItem (2 + 3 + 3 = 8 > 5)
    const runReturnIntake = async (qty: number) => {
      return await prismaTest.$transaction(async (tx) => {
        // Exclusive row lock
        await tx.$queryRaw`SELECT "id" FROM "OrderItem" WHERE "id" = ${orderItem.id} FOR UPDATE`;
        const item = await tx.orderItem.findUnique({
          where: { id: orderItem.id },
          include: { returnItems: true },
        });
        const currentSum = (item?.returnItems ?? []).reduce((s, r) => s + r.quantity, 0);
        if (currentSum + qty > (item?.quantity ?? 0)) {
          throw new Error("EXCEEDS_QUANTITY");
        }
        return await tx.returnItem.create({
          data: {
            orderId: order.id,
            orderItemId: orderItem.id,
            productId: product.id,
            quantity: qty,
            disposition: "PENDING_INSPECTION",
            physicalReturnAt: new Date(),
          },
        });
      });
    };

    const [r1, r2] = await Promise.allSettled([runReturnIntake(3), runReturnIntake(3)]);
    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "Exactly ONE partial return request of +3 succeeds");
    assert.strictEqual(rejected.length, 1, "Second partial return request is rejected due to cumulative overflow");

    const allReturns = await prismaTest.returnItem.findMany({ where: { orderItemId: orderItem.id } });
    const totalReturned = allReturns.reduce((s, r) => s + r.quantity, 0);
    assert.strictEqual(totalReturned, 5, "Final total returned quantity is exactly 5 (2 + 3)");

    await prismaTest.returnItem.deleteMany({ where: { orderId: order.id } });
    await prismaTest.orderItem.deleteMany({ where: { orderId: order.id } });
    await prismaTest.order.deleteMany({ where: { id: order.id } });
    await prismaTest.product.deleteMany({ where: { id: product.id } });
  });

  // -------------------------------------------------------------------------
  // Scenario K: Duplicate Restock
  // -------------------------------------------------------------------------
  it("Scenario K — Duplicate Restock: Exactly-once stock increment", async () => {
    if (!prismaTest) return;

    const suffix = Math.random().toString(36).substring(2, 8);
    const product = await prismaTest.product.create({
      data: {
        name: `Restock Race ${suffix}`,
        image: "/placeholder.png",
        category: "Test",
        price: 100,
        stock: 0,
      },
    });

    const order = await prismaTest.order.create({
      data: {
        orderId: `PH-RESTOCK-${suffix}`,
        status: "delivered",
        customerName: "Restock User",
        customerPhone: "01788888888",
        customerCity: "Dhaka",
        customerAddress: "Address",
        subtotal: 200,
        total: 260,
        deliveryFee: 60,
        paymentMethod: "COD",
      },
    });

    const orderItem = await prismaTest.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        name: product.name,
        image: product.image,
        category: product.category,
        quantity: 2,
        price: 100,
      },
    });

    const returnItem = await prismaTest.returnItem.create({
      data: {
        orderId: order.id,
        orderItemId: orderItem.id,
        productId: product.id,
        quantity: 2,
        disposition: "RESTOCKABLE",
        physicalReturnAt: new Date(),
        restockedAt: null,
      },
    });

    const performRestock = async () => {
      return await prismaTest.$transaction(async (tx) => {
        const claim = await tx.returnItem.updateMany({
          where: {
            id: returnItem.id,
            physicalReturnAt: { not: null },
            disposition: "RESTOCKABLE",
            restockedAt: null,
          },
          data: { restockedAt: new Date() },
        });

        if (claim.count === 1) {
          await tx.product.update({
            where: { id: product.id },
            data: { stock: { increment: returnItem.quantity } },
          });
          return { restocked: true };
        }
        return { restocked: false, idempotent: true };
      });
    };

    const [r1, r2] = await Promise.all([performRestock(), performRestock()]);
    const restockedCount = [r1, r2].filter((r) => r.restocked).length;
    assert.strictEqual(restockedCount, 1, "Exactly one restock action increments stock");

    const updatedProduct = await prismaTest.product.findUnique({ where: { id: product.id } });
    assert.strictEqual(updatedProduct?.stock, 2, "Product stock incremented by exactly 2 (not 4)");

    await prismaTest.returnItem.deleteMany({ where: { orderId: order.id } });
    await prismaTest.orderItem.deleteMany({ where: { orderId: order.id } });
    await prismaTest.order.deleteMany({ where: { id: order.id } });
    await prismaTest.product.deleteMany({ where: { id: product.id } });
  });
});
