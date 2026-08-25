/**
 * Real PostgreSQL Concurrency Scenarios Suite (Task 17 — Wave F)
 *
 * Dedicated integration tests executing real concurrent transactions against DATABASE_URL_TEST.
 * Validates locked Phase-2 concurrency invariants:
 *   - Scenario A1: Final Unit Oversale (Non-variant)
 *   - Scenario A2: Final Unit Oversale (Variant + Parent Aggregate Mirror)
 *   - Scenario B: Submission Token Idempotency
 *   - Scenario D: Double Cancellation Idempotency
 *   - Scenario E: Cancel vs Ship Lifecycle Race
 *   - Scenario F: Evidence Submission vs Expiry Race
 *   - Scenario G: Same-Order Competing Evidence TrxIDs
 *   - Scenario H: Cross-Order Anti-Replay (Partial Unique Index)
 *   - Scenario I: Admin Accept vs Reject Winner Guard
 *   - Scenario J: Partial Return Quantity Serialization (SELECT FOR UPDATE)
 *   - Scenario K: Duplicate Restock Idempotency
 *   - Scenario L: Disposition vs Restock Race
 *
 * Hard Safety Rule:
 *   Requires dedicated DATABASE_URL_TEST. Aborts immediately if missing or matching DATABASE_URL.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateTestDatabaseSafety } from "./db-safety";
import {
  reserveOrderInventory,
  releaseOrderReservation,
  fulfillOrderReservation,
  restockReturnItem,
} from "@/lib/inventoryService";

const safety = validateTestDatabaseSafety();

describe(
  "Task 17 — Real PostgreSQL Concurrency Suite",
  {
    skip:
      !safety.safe &&
      "TEST_DATABASE_REQUIRED: Set DATABASE_URL_TEST to run real PostgreSQL concurrency tests",
  },
  () => {
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
    // Scenario A1: Final Unit Oversale (Non-variant)
    // -------------------------------------------------------------------------
    it("Scenario A1 — Final Unit Oversale (Non-variant): Exactly 1 of 2 concurrent checkouts claims last unit", async () => {
      if (!prismaTest) return;

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

        const updatedProduct = await prismaTest.product.findUnique({ where: { id: product.id } });
        assert.strictEqual(updatedProduct?.stock, 0, "Final product stock must be exactly 0 (no negative stock)");

        const reservations = await prismaTest.inventoryReservation.findMany({
          where: { productId: product.id, status: "RESERVED" },
        });
        assert.strictEqual(reservations.length, 1, "Exactly one RESERVED reservation exists in DB");
      } finally {
        await prismaTest.inventoryReservation.deleteMany({ where: { productId: product.id } });
        await prismaTest.orderItem.deleteMany({ where: { productId: product.id } });
        await prismaTest.order.deleteMany({
          where: { orderId: { in: [`PH-TEST-A1-${suffix}`, `PH-TEST-A2-${suffix}`] } },
        });
        await prismaTest.product.deleteMany({ where: { id: product.id } });
      }
    });

    // -------------------------------------------------------------------------
    // Scenario A2: Final Unit Oversale (Variant + Parent Aggregate Mirror)
    // -------------------------------------------------------------------------
    it("Scenario A2 — Final Unit Oversale (Variant): Variant and parent mirror decremented exactly once", async () => {
      if (!prismaTest) return;

      const suffix = Math.random().toString(36).substring(2, 8);
      const product = await prismaTest.product.create({
        data: {
          name: `Variant Oversale ${suffix}`,
          image: "/placeholder.png",
          category: "Test",
          price: 600,
          stock: 1,
        },
      });

      const variant = await prismaTest.productVariant.create({
        data: {
          productId: product.id,
          label: "Size M",
          price: 600,
          stock: 1,
        },
      });

      try {
        const order1 = await prismaTest.order.create({
          data: {
            orderId: `PH-VAR-A1-${suffix}`,
            status: "pending",
            customerName: "Buyer V1",
            customerPhone: "01711111111",
            customerCity: "Dhaka",
            customerAddress: "Test Rd",
            subtotal: 600,
            total: 660,
            deliveryFee: 60,
            paymentMethod: "COD",
          },
        });

        const order2 = await prismaTest.order.create({
          data: {
            orderId: `PH-VAR-A2-${suffix}`,
            status: "pending",
            customerName: "Buyer V2",
            customerPhone: "01722222222",
            customerCity: "Dhaka",
            customerAddress: "Test Rd",
            subtotal: 600,
            total: 660,
            deliveryFee: 60,
            paymentMethod: "COD",
          },
        });

        const item1 = await prismaTest.orderItem.create({
          data: {
            orderId: order1.id,
            productId: product.id,
            variantId: variant.id,
            name: product.name,
            image: product.image,
            category: product.category,
            quantity: 1,
            price: 600,
          },
        });

        const item2 = await prismaTest.orderItem.create({
          data: {
            orderId: order2.id,
            productId: product.id,
            variantId: variant.id,
            name: product.name,
            image: product.image,
            category: product.category,
            quantity: 1,
            price: 600,
          },
        });

        const [res1, res2] = await Promise.allSettled([
          prismaTest.$transaction(async (tx) => {
            return await reserveOrderInventory(tx, [
              { id: item1.id, orderId: order1.id, productId: product.id, variantId: variant.id, quantity: 1 },
            ]);
          }),
          prismaTest.$transaction(async (tx) => {
            return await reserveOrderInventory(tx, [
              { id: item2.id, orderId: order2.id, productId: product.id, variantId: variant.id, quantity: 1 },
            ]);
          }),
        ]);

        const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
        const rejected = [res1, res2].filter((r) => r.status === "rejected");

        assert.strictEqual(fulfilled.length, 1, "Exactly ONE variant reservation must succeed");
        assert.strictEqual(rejected.length, 1, "Competing variant reservation must be rejected");

        const updatedVariant = await prismaTest.productVariant.findUnique({ where: { id: variant.id } });
        const updatedProduct = await prismaTest.product.findUnique({ where: { id: product.id } });

        assert.strictEqual(updatedVariant?.stock, 0, "Variant stock must be exactly 0");
        assert.strictEqual(updatedProduct?.stock, 0, "Parent product aggregate mirror must be exactly 0");
      } finally {
        await prismaTest.inventoryReservation.deleteMany({ where: { productId: product.id } });
        await prismaTest.orderItem.deleteMany({ where: { productId: product.id } });
        await prismaTest.order.deleteMany({
          where: { orderId: { in: [`PH-VAR-A1-${suffix}`, `PH-VAR-A2-${suffix}`] } },
        });
        await prismaTest.productVariant.deleteMany({ where: { id: variant.id } });
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
    // Scenario E: Cancel vs Ship Lifecycle Race
    // -------------------------------------------------------------------------
    it("Scenario E — Cancel vs Ship: Exactly one lifecycle transition wins without mixed states", async () => {
      if (!prismaTest) return;

      const suffix = Math.random().toString(36).substring(2, 8);
      const product = await prismaTest.product.create({
        data: {
          name: `Ship Cancel Race ${suffix}`,
          image: "/placeholder.png",
          category: "Test",
          price: 300,
          stock: 0,
        },
      });

      const order = await prismaTest.order.create({
        data: {
          orderId: `PH-SHIP-CANCEL-${suffix}`,
          status: "processing",
          customerName: "Ship User",
          customerPhone: "01755555555",
          customerCity: "Dhaka",
          customerAddress: "Address",
          subtotal: 300,
          total: 360,
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
          quantity: 1,
          price: 300,
        },
      });

      await prismaTest.inventoryReservation.create({
        data: {
          orderId: order.id,
          orderItemId: orderItem.id,
          productId: product.id,
          quantity: 1,
          status: "RESERVED",
        },
      });

      // Competing cancel vs ship
      const [resCancel, resShip] = await Promise.allSettled([
        prismaTest.$transaction(async (tx) => {
          const claim = await tx.order.updateMany({
            where: { id: order.id, status: "processing" },
            data: { status: "cancelled" },
          });
          if (claim.count === 1) {
            await releaseOrderReservation(tx, order.id, { releaseReason: "ORDER_CANCELLED" });
            return { winner: "CANCEL" };
          }
          return { winner: "LOST" };
        }),
        prismaTest.$transaction(async (tx) => {
          const claim = await tx.order.updateMany({
            where: { id: order.id, status: "processing" },
            data: { status: "shipped" },
          });
          if (claim.count === 1) {
            await fulfillOrderReservation(tx, order.id);
            return { winner: "SHIP" };
          }
          return { winner: "LOST" };
        }),
      ]);

      const cancelResult = resCancel.status === "fulfilled" ? resCancel.value : null;
      const shipResult = resShip.status === "fulfilled" ? resShip.value : null;

      const finalOrder = await prismaTest.order.findUnique({ where: { id: order.id } });
      const finalRes = await prismaTest.inventoryReservation.findFirst({ where: { orderId: order.id } });
      const finalProduct = await prismaTest.product.findUnique({ where: { id: product.id } });

      if (finalOrder?.status === "cancelled") {
        assert.strictEqual(finalRes?.status, "RELEASED", "If cancelled, reservation must be RELEASED");
        assert.strictEqual(finalProduct?.stock, 1, "Stock restored once on cancellation");
      } else if (finalOrder?.status === "shipped") {
        assert.strictEqual(finalRes?.status, "FULFILLED", "If shipped, reservation must be FULFILLED");
        assert.strictEqual(finalProduct?.stock, 0, "Stock remains allocated on shipment");
      } else {
        assert.fail(`Invalid order final status: ${finalOrder?.status}`);
      }

      await prismaTest.inventoryReservation.deleteMany({ where: { orderId: order.id } });
      await prismaTest.orderItem.deleteMany({ where: { orderId: order.id } });
      await prismaTest.order.deleteMany({ where: { id: order.id } });
      await prismaTest.product.deleteMany({ where: { id: product.id } });
    });

    // -------------------------------------------------------------------------
    // Scenario F: Evidence vs Expiry Race
    // -------------------------------------------------------------------------
    it("Scenario F — Evidence vs Expiry: Conditional claim ensures consistent winner state", async () => {
      if (!prismaTest) return;

      const suffix = Math.random().toString(36).substring(2, 8);
      const product = await prismaTest.product.create({
        data: {
          name: `Expiry Evidence Race ${suffix}`,
          image: "/placeholder.png",
          category: "Test",
          price: 400,
          stock: 0,
        },
      });

      const order = await prismaTest.order.create({
        data: {
          orderId: `PH-EXP-RACE-${suffix}`,
          status: "pending",
          customerName: "Exp User",
          customerPhone: "01766666666",
          customerCity: "Dhaka",
          customerAddress: "Address",
          subtotal: 400,
          total: 460,
          deliveryFee: 60,
          paymentMethod: "bKash",
        },
      });

      const pr = await prismaTest.paymentRecord.create({
        data: {
          orderId: order.id,
          method: "bKash",
          state: "AWAITING_PAYMENT",
        },
      });

      const orderItem = await prismaTest.orderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          name: product.name,
          image: product.image,
          category: product.category,
          quantity: 1,
          price: 400,
        },
      });

      await prismaTest.inventoryReservation.create({
        data: {
          orderId: order.id,
          orderItemId: orderItem.id,
          productId: product.id,
          quantity: 1,
          status: "RESERVED",
          evidenceDeadlineAt: new Date(Date.now() - 60000), // Expired
        },
      });

      // Competing Evidence Submission vs Expiry Release
      const [resEvidence, resExpiry] = await Promise.allSettled([
        // Customer Evidence Submission
        prismaTest.$transaction(async (tx) => {
          const claim = await tx.paymentRecord.updateMany({
            where: { id: pr.id, state: "AWAITING_PAYMENT" },
            data: { state: "VERIFICATION_PENDING" },
          });
          if (claim.count === 1) {
            await tx.paymentEvidenceAttempt.create({
              data: {
                paymentRecordId: pr.id,
                normalizedProvider: "BKASH",
                senderNumber: "01711111111",
                trxId: `TRX-${suffix}`,
                normalizedTrxId: `TRX-${suffix}`,
                state: "PENDING_REVIEW",
              },
            });
            return { winner: "EVIDENCE" };
          }
          return { winner: "LOST" };
        }),
        // Expiry Engine
        prismaTest.$transaction(async (tx) => {
          const paymentClaim = await tx.paymentRecord.updateMany({
            where: { orderId: order.id, state: "AWAITING_PAYMENT" },
            data: { state: "FAILED" },
          });
          if (paymentClaim.count !== 1) {
            return { winner: "LOST" };
          }
          const orderClaim = await tx.order.updateMany({
            where: { id: order.id, status: { in: ["pending", "PENDING", "awaiting_payment"] } },
            data: { status: "cancelled", cancellationReason: "system_timeout" },
          });
          if (orderClaim.count !== 1) {
            throw new Error("ORDER_CLAIM_FAILED");
          }
          await releaseOrderReservation(tx, order.id, { releaseReason: "EVIDENCE_DEADLINE_EXPIRED" });
          return { winner: "EXPIRY" };
        }),
      ]);

      const finalPR = await prismaTest.paymentRecord.findUnique({ where: { id: pr.id } });
      const finalRes = await prismaTest.inventoryReservation.findFirst({ where: { orderId: order.id } });
      const finalProduct = await prismaTest.product.findUnique({ where: { id: product.id } });
      const finalOrder = await prismaTest.order.findUnique({ where: { id: order.id } });

      if (finalPR?.state === "VERIFICATION_PENDING") {
        assert.strictEqual(finalRes?.status, "RESERVED", "Evidence winner preserves RESERVED reservation");
        assert.strictEqual(finalProduct?.stock, 0, "Stock remains allocated");
        assert.strictEqual(finalOrder?.status, "pending", "Order remains active pending verification");
      } else if (finalPR?.state === "FAILED") {
        assert.strictEqual(finalRes?.status, "RELEASED", "Expiry winner releases reservation");
        assert.strictEqual(finalProduct?.stock, 1, "Stock restored once by expiry winner");
        assert.strictEqual(finalOrder?.status, "cancelled", "Order cancelled by expiry winner");
      } else {
        assert.fail(`Invalid payment record final state: ${finalPR?.state}`);
      }

      await prismaTest.paymentEvidenceAttempt.deleteMany({ where: { paymentRecordId: pr.id } });
      await prismaTest.paymentRecord.deleteMany({ where: { id: pr.id } });
      await prismaTest.inventoryReservation.deleteMany({ where: { orderId: order.id } });
      await prismaTest.orderItem.deleteMany({ where: { orderId: order.id } });
      await prismaTest.order.deleteMany({ where: { id: order.id } });
      await prismaTest.product.deleteMany({ where: { id: product.id } });
    });

    // -------------------------------------------------------------------------
    // Scenario G: Same-Order Competing Evidence TrxIDs
    // -------------------------------------------------------------------------
    it("Scenario G — Same-Order Competing Evidence: Conditional claim prevents competing TrxIDs for same order", async () => {
      if (!prismaTest) return;

      const suffix = Math.random().toString(36).substring(2, 8);
      const order = await prismaTest.order.create({
        data: {
          orderId: `PH-SAME-EV-${suffix}`,
          status: "pending",
          customerName: "Same Ev User",
          customerPhone: "01788888888",
          customerCity: "Dhaka",
          customerAddress: "Address",
          subtotal: 200,
          total: 260,
          deliveryFee: 60,
          paymentMethod: "bKash",
        },
      });

      const pr = await prismaTest.paymentRecord.create({
        data: {
          orderId: order.id,
          method: "bKash",
          state: "AWAITING_PAYMENT",
        },
      });

      const submitEvidence = async (trx: string) => {
        return await prismaTest.$transaction(async (tx) => {
          const claim = await tx.paymentRecord.updateMany({
            where: { id: pr.id, state: "AWAITING_PAYMENT" },
            data: { state: "VERIFICATION_PENDING" },
          });
          if (claim.count === 1) {
            const attempt = await tx.paymentEvidenceAttempt.create({
              data: {
                paymentRecordId: pr.id,
                normalizedProvider: "BKASH",
                senderNumber: "01711111111",
                trxId: trx,
                normalizedTrxId: trx,
                state: "PENDING_REVIEW",
              },
            });
            return { success: true, attemptId: attempt.id };
          }
          return { success: false, reason: "EVIDENCE_ALREADY_SUBMITTED" };
        });
      };

      const [r1, r2] = await Promise.all([
        submitEvidence(`TRX-A-${suffix}`),
        submitEvidence(`TRX-B-${suffix}`),
      ]);

      const successful = [r1, r2].filter((r) => r.success);
      assert.strictEqual(successful.length, 1, "Exactly ONE competing evidence submission claims the payment record");

      const attempts = await prismaTest.paymentEvidenceAttempt.findMany({ where: { paymentRecordId: pr.id } });
      assert.strictEqual(attempts.length, 1, "Exactly one evidence attempt exists in database");

      await prismaTest.paymentEvidenceAttempt.deleteMany({ where: { paymentRecordId: pr.id } });
      await prismaTest.paymentRecord.deleteMany({ where: { id: pr.id } });
      await prismaTest.order.deleteMany({ where: { id: order.id } });
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
    // Scenario I: Admin Accept vs Reject Winner Guard
    // -------------------------------------------------------------------------
    it("Scenario I — Admin Accept vs Reject: Mutually exclusive winner guard prevents split states", async () => {
      if (!prismaTest) return;

      const suffix = Math.random().toString(36).substring(2, 8);
      const order = await prismaTest.order.create({
        data: {
          orderId: `PH-ACC-REJ-${suffix}`,
          status: "pending",
          customerName: "Verify User",
          customerPhone: "01799999999",
          customerCity: "Dhaka",
          customerAddress: "Address",
          subtotal: 500,
          total: 560,
          deliveryFee: 60,
          paymentMethod: "bKash",
        },
      });

      const pr = await prismaTest.paymentRecord.create({
        data: {
          orderId: order.id,
          method: "bKash",
          state: "VERIFICATION_PENDING",
        },
      });

      const attempt = await prismaTest.paymentEvidenceAttempt.create({
        data: {
          paymentRecordId: pr.id,
          normalizedProvider: "BKASH",
          senderNumber: "01711111111",
          trxId: `TRX-${suffix}`,
          normalizedTrxId: `TRX-${suffix}`,
          state: "PENDING_REVIEW",
        },
      });

      // Admin A (Accept) vs Admin B (Reject)
      const [resAccept, resReject] = await Promise.allSettled([
        // Admin Accept
        prismaTest.$transaction(async (tx) => {
          const claimPR = await tx.paymentRecord.updateMany({
            where: { id: pr.id, state: "VERIFICATION_PENDING" },
            data: { state: "PAID", verifiedBy: "admin_a", verifiedAt: new Date() },
          });
          if (claimPR.count !== 1) return { winner: "LOST" };
          await tx.paymentEvidenceAttempt.updateMany({
            where: { id: attempt.id, state: "PENDING_REVIEW" },
            data: { state: "ACCEPTED" },
          });
          return { winner: "ACCEPT" };
        }),
        // Admin Reject
        prismaTest.$transaction(async (tx) => {
          const claimPR = await tx.paymentRecord.updateMany({
            where: { id: pr.id, state: "VERIFICATION_PENDING" },
            data: { state: "REJECTED", rejectionNote: "Invalid TrxID" },
          });
          if (claimPR.count !== 1) return { winner: "LOST" };
          await tx.paymentEvidenceAttempt.updateMany({
            where: { id: attempt.id, state: "PENDING_REVIEW" },
            data: { state: "REJECTED" },
          });
          return { winner: "REJECT" };
        }),
      ]);

      const finalPR = await prismaTest.paymentRecord.findUnique({ where: { id: pr.id } });
      const finalAttempt = await prismaTest.paymentEvidenceAttempt.findUnique({ where: { id: attempt.id } });

      if (finalPR?.state === "PAID") {
        assert.strictEqual(finalAttempt?.state, "ACCEPTED", "PAID state must match ACCEPTED attempt");
      } else if (finalPR?.state === "REJECTED") {
        assert.strictEqual(finalAttempt?.state, "REJECTED", "REJECTED state must match REJECTED attempt");
      } else {
        assert.fail(`Invalid final payment state: ${finalPR?.state}`);
      }

      await prismaTest.paymentEvidenceAttempt.deleteMany({ where: { paymentRecordId: pr.id } });
      await prismaTest.paymentRecord.deleteMany({ where: { id: pr.id } });
      await prismaTest.order.deleteMany({ where: { id: order.id } });
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
          return await restockReturnItem(tx, returnItem.id);
        });
      };

      const [r1, r2] = await Promise.all([performRestock(), performRestock()]);
      const restockedCount = [r1, r2].filter((r) => !r.idempotent).length;
      assert.strictEqual(restockedCount, 1, "Exactly one restock action increments stock");

      const updatedProduct = await prismaTest.product.findUnique({ where: { id: product.id } });
      assert.strictEqual(updatedProduct?.stock, 2, "Product stock incremented by exactly 2 (not 4)");

      await prismaTest.returnItem.deleteMany({ where: { orderId: order.id } });
      await prismaTest.orderItem.deleteMany({ where: { orderId: order.id } });
      await prismaTest.order.deleteMany({ where: { id: order.id } });
      await prismaTest.product.deleteMany({ where: { id: product.id } });
    });

    // -------------------------------------------------------------------------
    // Scenario L: Disposition vs Restock Race
    // -------------------------------------------------------------------------
    it("Scenario L — Disposition vs Restock: Conditional claim prevents DAMAGED + restockedAt state", async () => {
      if (!prismaTest) return;

      const suffix = Math.random().toString(36).substring(2, 8);
      const product = await prismaTest.product.create({
        data: {
          name: `Disp Race ${suffix}`,
          image: "/placeholder.png",
          category: "Test",
          price: 150,
          stock: 0,
        },
      });

      const order = await prismaTest.order.create({
        data: {
          orderId: `PH-DISP-${suffix}`,
          status: "delivered",
          customerName: "Disp User",
          customerPhone: "01799999999",
          customerCity: "Dhaka",
          customerAddress: "Address",
          subtotal: 150,
          total: 210,
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
          quantity: 1,
          price: 150,
        },
      });

      const returnItem = await prismaTest.returnItem.create({
        data: {
          orderId: order.id,
          orderItemId: orderItem.id,
          productId: product.id,
          quantity: 1,
          disposition: "RESTOCKABLE",
          physicalReturnAt: new Date(),
          restockedAt: null,
        },
      });

      // Competing Restock vs Mark DAMAGED
      const [resRestock, resDamaged] = await Promise.allSettled([
        prismaTest.$transaction(async (tx) => {
          return await restockReturnItem(tx, returnItem.id);
        }),
        prismaTest.$transaction(async (tx) => {
          const claim = await tx.returnItem.updateMany({
            where: { id: returnItem.id, restockedAt: null },
            data: { disposition: "DAMAGED" },
          });
          return { winner: claim.count === 1 ? "DAMAGED" : "LOST" };
        }),
      ]);

      const finalReturn = await prismaTest.returnItem.findUnique({ where: { id: returnItem.id } });
      const finalProduct = await prismaTest.product.findUnique({ where: { id: product.id } });

      if (finalReturn?.disposition === "RESTOCKABLE") {
        assert.ok(finalReturn?.restockedAt !== null, "If RESTOCKABLE, restockedAt must be populated");
        assert.strictEqual(finalProduct?.stock, 1, "Stock incremented by 1");
      } else if (finalReturn?.disposition === "DAMAGED") {
        assert.strictEqual(finalReturn?.restockedAt, null, "If DAMAGED, restockedAt must be null");
        assert.strictEqual(finalProduct?.stock, 0, "Stock unchanged for DAMAGED item");
      } else {
        assert.fail(`Invalid final return disposition: ${finalReturn?.disposition}`);
      }

      await prismaTest.returnItem.deleteMany({ where: { orderId: order.id } });
      await prismaTest.orderItem.deleteMany({ where: { orderId: order.id } });
      await prismaTest.order.deleteMany({ where: { id: order.id } });
      await prismaTest.product.deleteMany({ where: { id: product.id } });
    });
  }
);
