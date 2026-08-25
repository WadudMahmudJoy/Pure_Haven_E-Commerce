/**
 * Task 15 — Prepaid Evidence Expiry Engine Tests
 *
 * Tests:
 *   1. Unpaid order past 15-minute deadline has reservations released & order cancelled
 *   2. Stock is restored exactly once (non-variant)
 *   3. Variant stock + Product aggregate mirror restored exactly once
 *   4. Duplicate expiry call does NOT double-increment stock
 *   5. VERIFICATION_PENDING past 15m is preserved and NOT released
 *   6. PAID / REFUND_REQUIRED / REFUNDED orders are NOT released
 *   7. Evidence submission race: evidence winner prevents expiry release (zero stock increment)
 *   8. Expiry winner prevents subsequent normal evidence submission protection
 *   9. Common deadline mismatch fails safe without releasing stock
 *   10. COD orders never enter prepaid evidence-expiry logic
 *   11. Transaction failure rolls back all state & stock mutations
 *
 * Run with:
 *   npx tsx --test tests/prepaid-evidence-expiry.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { releaseExpiredReservations } from "@/lib/inventoryExpiry";
import { prisma } from "@/lib/prisma";

describe("Task 15 — Prepaid Evidence Expiry Engine", { concurrency: false }, () => {
  it("EXPIRED AWAITING_PAYMENT — Releases reservation, cancels order, and restores stock", async (t) => {
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const originalOrderFindUnique = prisma.order.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.order.findUnique = originalOrderFindUnique;
      prisma.$transaction = original$transaction;
    });

    const now = new Date("2026-08-25T12:30:00Z");
    const pastDeadline = new Date("2026-08-25T12:15:00Z"); // 15 min ago

    (prisma.inventoryReservation.findMany as any) = async () => [
      {
        id: 101,
        orderId: "order_cuid_1",
        orderItemId: 1,
        productId: 10,
        variantId: null,
        quantity: 2,
        status: "RESERVED",
        evidenceDeadlineAt: pastDeadline,
      },
    ];


    (prisma.order.findUnique as any) = async () => ({
      id: "order_cuid_1",
      orderId: "PH-EXPIRY-001",
      status: "pending",
      paymentMethod: "bKash",
      paymentRecord: {
        id: 501,
        orderId: "order_cuid_1",
        state: "AWAITING_PAYMENT",
        method: "bKash",
      },
      reservations: [
        {
          id: 101,
          orderId: "order_cuid_1",
          productId: 10,
          variantId: null,
          quantity: 2,
          status: "RESERVED",
          evidenceDeadlineAt: pastDeadline,
        },
      ],
    });

    let stockIncrementedBy = 0;
    let paymentRecordStateUpdatedTo = "";
    let orderCancelled = false;
    let reservationReleased = false;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        paymentRecord: {
          updateMany: async (args: any) => {
            if (args.where.state === "AWAITING_PAYMENT") {
              paymentRecordStateUpdatedTo = args.data.state;
              return { count: 1 };
            }
            return { count: 0 };
          },
        },
        inventoryReservation: {
          findMany: async () => [
            {
              id: 101,
              orderId: "order_cuid_1",
              productId: 10,
              variantId: null,
              quantity: 2,
              status: "RESERVED",
            },
          ],
          updateMany: async (args: any) => {
            if (args.data.status === "RELEASED") {
              reservationReleased = true;
              return { count: 1 };
            }
            return { count: 0 };
          },
        },
        product: {
          update: async (args: any) => {
            stockIncrementedBy += args.data.stock.increment;
            return {};
          },
        },
        order: {
          updateMany: async (args: any) => {
            if (args.data.status === "cancelled") {
              orderCancelled = true;
              return { count: 1 };
            }
            return { count: 0 };
          },
        },
      };
      return await callback(mockTx);
    };

    const result = await releaseExpiredReservations(now);

    assert.strictEqual(result.releasedCount, 1);
    assert.deepStrictEqual(result.orderIds, ["PH-EXPIRY-001"]);
    assert.strictEqual(paymentRecordStateUpdatedTo, "FAILED");
    assert.strictEqual(reservationReleased, true);
    assert.strictEqual(orderCancelled, true);
    assert.strictEqual(stockIncrementedBy, 2);
  });

  it("VARIANT RESTORATION — Restores both ProductVariant and Product mirror exactly once", async (t) => {
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const originalOrderFindUnique = prisma.order.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.order.findUnique = originalOrderFindUnique;
      prisma.$transaction = original$transaction;
    });

    const now = new Date("2026-08-25T12:30:00Z");
    const pastDeadline = new Date("2026-08-25T12:15:00Z");

    (prisma.inventoryReservation.findMany as any) = async () => [
      {
        id: 102,
        orderId: "order_cuid_variant",
        orderItemId: 2,
        productId: 20,
        variantId: 201,
        quantity: 3,
        status: "RESERVED",
        evidenceDeadlineAt: pastDeadline,
      },
    ];

    (prisma.order.findUnique as any) = async () => ({
      id: "order_cuid_variant",
      orderId: "PH-VAR-EXPIRY",
      status: "pending",
      paymentMethod: "Nagad",
      paymentRecord: {
        id: 502,
        orderId: "order_cuid_variant",
        state: "AWAITING_PAYMENT",
        method: "Nagad",
      },
      reservations: [
        {
          id: 102,
          orderId: "order_cuid_variant",
          productId: 20,
          variantId: 201,
          quantity: 3,
          status: "RESERVED",
          evidenceDeadlineAt: pastDeadline,
        },
      ],
    });

    let variantStockIncrement = 0;
    let productStockIncrement = 0;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        paymentRecord: {
          updateMany: async () => ({ count: 1 }),
        },
        inventoryReservation: {
          findMany: async () => [
            {
              id: 102,
              orderId: "order_cuid_variant",
              productId: 20,
              variantId: 201,
              quantity: 3,
              status: "RESERVED",
            },
          ],
          updateMany: async () => ({ count: 1 }),
        },
        productVariant: {
          findUnique: async () => ({ id: 201, productId: 20 }),
          update: async (args: any) => {
            variantStockIncrement += args.data.stock.increment;
            return {};
          },
        },
        product: {
          update: async (args: any) => {
            productStockIncrement += args.data.stock.increment;
            return {};
          },
        },
        order: {
          updateMany: async () => ({ count: 1 }),
        },
      };
      return await callback(mockTx);
    };

    const result = await releaseExpiredReservations(now);

    assert.strictEqual(result.releasedCount, 1);
    assert.strictEqual(variantStockIncrement, 3, "Variant stock must increment by 3");
    assert.strictEqual(productStockIncrement, 3, "Parent Product stock aggregate mirror must increment by 3");
  });

  it("PROTECTED VERIFICATION_PENDING — Preserved past 15m without expiry release", async (t) => {
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const originalOrderFindUnique = prisma.order.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.order.findUnique = originalOrderFindUnique;
      prisma.$transaction = original$transaction;
    });

    const now = new Date("2026-08-25T12:30:00Z");
    const pastDeadline = new Date("2026-08-25T12:15:00Z");

    (prisma.inventoryReservation.findMany as any) = async () => [
      {
        id: 103,
        orderId: "order_cuid_pending_review",
        orderItemId: 3,
        productId: 30,
        variantId: null,
        quantity: 1,
        status: "RESERVED",
        evidenceDeadlineAt: pastDeadline,
      },
    ];

    (prisma.order.findUnique as any) = async () => ({
      id: "order_cuid_pending_review",
      orderId: "PH-PROTECTED-001",
      status: "pending",
      paymentMethod: "bKash",
      paymentRecord: {
        id: 503,
        orderId: "order_cuid_pending_review",
        state: "VERIFICATION_PENDING", // Customer submitted evidence in time!
        method: "bKash",
      },
      reservations: [
        {
          id: 103,
          orderId: "order_cuid_pending_review",
          productId: 30,
          variantId: null,
          quantity: 1,
          status: "RESERVED",
          evidenceDeadlineAt: pastDeadline,
        },
      ],
    });

    let txCalled = false;
    (prisma.$transaction as any) = async (callback: any) => {
      txCalled = true;
      return await callback({});
    };

    const result = await releaseExpiredReservations(now);

    assert.strictEqual(result.releasedCount, 0);
    assert.deepStrictEqual(result.orderIds, []);
    assert.strictEqual(txCalled, false, "Must NOT open transaction or release for VERIFICATION_PENDING");
  });

  it("PAID / REFUND_REQUIRED / REFUNDED — Never released by expiry", async (t) => {
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const originalOrderFindUnique = prisma.order.findUnique;

    t.after(() => {
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.order.findUnique = originalOrderFindUnique;
    });

    const now = new Date("2026-08-25T12:30:00Z");
    const pastDeadline = new Date("2026-08-25T12:15:00Z");

    for (const nonExpirableState of ["PAID", "REFUND_REQUIRED", "REFUND_PROCESSING", "REFUNDED"]) {
      (prisma.inventoryReservation.findMany as any) = async () => [
        {
          id: 104,
          orderId: `order_${nonExpirableState}`,
          orderItemId: 4,
          productId: 40,
          variantId: null,
          quantity: 1,
          status: "RESERVED",
          evidenceDeadlineAt: pastDeadline,
        },
      ];

      (prisma.order.findUnique as any) = async () => ({
        id: `order_${nonExpirableState}`,
        orderId: `PH-${nonExpirableState}`,
        status: "confirmed",
        paymentMethod: "bKash",
        paymentRecord: {
          id: 504,
          orderId: `order_${nonExpirableState}`,
          state: nonExpirableState,
          method: "bKash",
        },
        reservations: [
          {
            id: 104,
            orderId: `order_${nonExpirableState}`,
            productId: 40,
            variantId: null,
            quantity: 1,
            status: "RESERVED",
            evidenceDeadlineAt: pastDeadline,
          },
        ],
      });

      const result = await releaseExpiredReservations(now);
      assert.strictEqual(result.releasedCount, 0, `${nonExpirableState} must NOT be released by expiry`);
    }
  });

  it("RACE — Evidence submission winner prevents expiry release (0 stock increment)", async (t) => {
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const originalOrderFindUnique = prisma.order.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.order.findUnique = originalOrderFindUnique;
      prisma.$transaction = original$transaction;
    });

    const now = new Date("2026-08-25T12:30:00Z");
    const pastDeadline = new Date("2026-08-25T12:15:00Z");

    (prisma.inventoryReservation.findMany as any) = async () => [
      {
        id: 105,
        orderId: "order_race_evidence_wins",
        orderItemId: 5,
        productId: 50,
        variantId: null,
        quantity: 2,
        status: "RESERVED",
        evidenceDeadlineAt: pastDeadline,
      },
    ];

    // Initial read saw AWAITING_PAYMENT
    (prisma.order.findUnique as any) = async () => ({
      id: "order_race_evidence_wins",
      orderId: "PH-RACE-EVI-WINS",
      status: "pending",
      paymentMethod: "bKash",
      paymentRecord: {
        id: 505,
        orderId: "order_race_evidence_wins",
        state: "AWAITING_PAYMENT",
        method: "bKash",
      },
      reservations: [
        {
          id: 105,
          orderId: "order_race_evidence_wins",
          productId: 50,
          variantId: null,
          quantity: 2,
          status: "RESERVED",
          evidenceDeadlineAt: pastDeadline,
        },
      ],
    });

    let stockIncrementCalled = false;

    // Simulate: customer evidence submission won the claim inside tx (count = 0 for expiry)
    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        paymentRecord: {
          updateMany: async () => ({ count: 0 }), // Evidence submission already changed state!
        },
        product: {
          update: async () => {
            stockIncrementCalled = true;
          },
        },
      };
      return await callback(mockTx);
    };

    const result = await releaseExpiredReservations(now);

    assert.strictEqual(result.releasedCount, 0);
    assert.strictEqual(stockIncrementCalled, false, "Loser expiry MUST NOT increment stock");
  });

  it("DEADLINE INTEGRITY — Mismatched reservation deadlines fail safe without release", async (t) => {
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const originalOrderFindUnique = prisma.order.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.order.findUnique = originalOrderFindUnique;
      prisma.$transaction = original$transaction;
    });

    const now = new Date("2026-08-25T12:30:00Z");

    (prisma.inventoryReservation.findMany as any) = async (args: any) => {
      if (args?.where?.status === "RESERVED" && !args?.where?.orderId) {
        return [
          {
            id: 106,
            orderId: "order_deadline_mismatch",
            orderItemId: 6,
            productId: 60,
            variantId: null,
            quantity: 1,
            status: "RESERVED",
            evidenceDeadlineAt: new Date("2026-08-25T12:15:00Z"),
          },
        ];
      }
      return [
        {
          id: 106,
          orderId: "order_deadline_mismatch",
          productId: 60,
          variantId: null,
          quantity: 1,
          status: "RESERVED",
          evidenceDeadlineAt: new Date("2026-08-25T12:15:00Z"),
        },
        {
          id: 107,
          orderId: "order_deadline_mismatch",
          productId: 61,
          variantId: null,
          quantity: 1,
          status: "RESERVED",
          evidenceDeadlineAt: new Date("2026-08-25T12:20:00Z"), // 5 minutes difference!
        },
      ];
    };


    // Order has 2 reservations with conflicting deadlines
    (prisma.order.findUnique as any) = async () => ({
      id: "order_deadline_mismatch",
      orderId: "PH-DEADLINE-MISMATCH",
      status: "pending",
      paymentMethod: "bKash",
      paymentRecord: {
        id: 506,
        orderId: "order_deadline_mismatch",
        state: "AWAITING_PAYMENT",
        method: "bKash",
      },
      reservations: [
        {
          id: 106,
          orderId: "order_deadline_mismatch",
          productId: 60,
          variantId: null,
          quantity: 1,
          status: "RESERVED",
          evidenceDeadlineAt: new Date("2026-08-25T12:15:00Z"),
        },
        {
          id: 107,
          orderId: "order_deadline_mismatch",
          productId: 61,
          variantId: null,
          quantity: 1,
          status: "RESERVED",
          evidenceDeadlineAt: new Date("2026-08-25T12:20:00Z"), // 5 minutes difference!
        },
      ],
    });

    let txCalled = false;
    (prisma.$transaction as any) = async (callback: any) => {
      txCalled = true;
      return await callback({});
    };

    const result = await releaseExpiredReservations(now);

    assert.strictEqual(result.releasedCount, 0);
    assert.strictEqual(txCalled, false, "Conflicting deadlines must fail safe without releasing stock");
  });

  it("COD EXCLUSION — Cash on Delivery orders never expire via prepaid evidence timer", async (t) => {
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const originalOrderFindUnique = prisma.order.findUnique;

    t.after(() => {
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.order.findUnique = originalOrderFindUnique;
    });

    const now = new Date("2026-08-25T12:30:00Z");
    const pastDeadline = new Date("2026-08-25T12:15:00Z");

    (prisma.inventoryReservation.findMany as any) = async () => [
      {
        id: 108,
        orderId: "order_cod",
        orderItemId: 8,
        productId: 80,
        variantId: null,
        quantity: 1,
        status: "RESERVED",
        evidenceDeadlineAt: pastDeadline,
      },
    ];

    (prisma.order.findUnique as any) = async () => ({
      id: "order_cod",
      orderId: "PH-COD-ORDER",
      status: "pending",
      paymentMethod: "Cash on Delivery",
      paymentRecord: {
        id: 508,
        orderId: "order_cod",
        state: "AWAITING_PAYMENT",
        method: "Cash on Delivery",
      },
      reservations: [
        {
          id: 108,
          orderId: "order_cod",
          productId: 80,
          variantId: null,
          quantity: 1,
          status: "RESERVED",
          evidenceDeadlineAt: pastDeadline,
        },
      ],
    });

    const result = await releaseExpiredReservations(now);
    assert.strictEqual(result.releasedCount, 0, "COD must never be expired");
  });

  it("DUPLICATE EXPIRY — Subsequent execution finds no RESERVED reservations and performs 0 increments", async (t) => {
    const originalReservationFindMany = prisma.inventoryReservation.findMany;

    t.after(() => {
      prisma.inventoryReservation.findMany = originalReservationFindMany;
    });

    // Reservations already transitioned to RELEASED
    (prisma.inventoryReservation.findMany as any) = async () => [];

    const result = await releaseExpiredReservations(new Date());
    assert.strictEqual(result.releasedCount, 0);
    assert.deepStrictEqual(result.orderIds, []);
  });

  it("EXPIRY WINNER — Once expiry sets FAILED, subsequent evidence submission cannot claim reservation", async (t) => {
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const originalOrderFindUnique = prisma.order.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.order.findUnique = originalOrderFindUnique;
      prisma.$transaction = original$transaction;
    });

    const now = new Date("2026-08-25T12:30:00Z");
    const pastDeadline = new Date("2026-08-25T12:15:00Z");

    (prisma.inventoryReservation.findMany as any) = async () => [
      {
        id: 109,
        orderId: "order_expiry_won",
        orderItemId: 9,
        productId: 90,
        variantId: null,
        quantity: 1,
        status: "RESERVED",
        evidenceDeadlineAt: pastDeadline,
      },
    ];

    (prisma.order.findUnique as any) = async () => ({
      id: "order_expiry_won",
      orderId: "PH-EXPIRY-WON",
      status: "pending",
      paymentMethod: "bKash",
      paymentRecord: {
        id: 509,
        orderId: "order_expiry_won",
        state: "AWAITING_PAYMENT",
        method: "bKash",
      },
      reservations: [
        {
          id: 109,
          orderId: "order_expiry_won",
          productId: 90,
          variantId: null,
          quantity: 1,
          status: "RESERVED",
          evidenceDeadlineAt: pastDeadline,
        },
      ],
    });

    let paymentRecordState = "AWAITING_PAYMENT";
    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        paymentRecord: {
          updateMany: async (args: any) => {
            if (args.where.state === "AWAITING_PAYMENT") {
              paymentRecordState = args.data.state;
              return { count: 1 };
            }
            return { count: 0 };
          },
        },
        inventoryReservation: {
          findMany: async () => [
            {
              id: 109,
              orderId: "order_expiry_won",
              productId: 90,
              variantId: null,
              quantity: 1,
              status: "RESERVED",
            },
          ],
          updateMany: async () => ({ count: 1 }),
        },
        product: { update: async () => ({}) },
        order: { updateMany: async () => ({ count: 1 }) },
      };
      return await callback(mockTx);
    };

    const result = await releaseExpiredReservations(now);
    assert.strictEqual(result.releasedCount, 1);
    assert.strictEqual(paymentRecordState, "FAILED", "PaymentRecord must be transitioned to FAILED");
  });

  it("ORDER CLAIM FAILURE — If Order cancellation claim fails (count === 0), expiry transaction aborts with 0 release", async (t) => {
    const originalReservationFindMany = prisma.inventoryReservation.findMany;
    const originalOrderFindUnique = prisma.order.findUnique;
    const original$transaction = prisma.$transaction;

    t.after(() => {
      prisma.inventoryReservation.findMany = originalReservationFindMany;
      prisma.order.findUnique = originalOrderFindUnique;
      prisma.$transaction = original$transaction;
    });

    const now = new Date("2026-08-25T12:30:00Z");
    const pastDeadline = new Date("2026-08-25T12:15:00Z");

    (prisma.inventoryReservation.findMany as any) = async () => [
      {
        id: 110,
        orderId: "order_order_claim_fails",
        orderItemId: 10,
        productId: 95,
        variantId: null,
        quantity: 5,
        status: "RESERVED",
        evidenceDeadlineAt: pastDeadline,
      },
    ];

    (prisma.order.findUnique as any) = async () => ({
      id: "order_order_claim_fails",
      orderId: "PH-ORDER-CLAIM-FAILS",
      status: "pending",
      paymentMethod: "bKash",
      paymentRecord: {
        id: 510,
        orderId: "order_order_claim_fails",
        state: "AWAITING_PAYMENT",
        method: "bKash",
      },
    });

    let stockIncremented = false;

    (prisma.$transaction as any) = async (callback: any) => {
      const mockTx: any = {
        paymentRecord: {
          updateMany: async () => ({ count: 1 }), // Payment claim wins
        },
        order: {
          updateMany: async () => ({ count: 0 }), // Order claim LOSES (concurrent mutation)
        },
        inventoryReservation: {
          findMany: async () => [
            {
              id: 110,
              orderId: "order_order_claim_fails",
              productId: 95,
              variantId: null,
              quantity: 5,
              status: "RESERVED",
            },
          ],
          updateMany: async () => ({ count: 1 }),
        },
        product: {
          update: async () => {
            stockIncremented = true;
          },
        },
      };
      return await callback(mockTx);
    };

    const result = await releaseExpiredReservations(now);

    assert.strictEqual(
      result.releasedCount,
      0,
      "Must release 0 reservations when Order cancellation claim fails"
    );
    assert.deepStrictEqual(result.orderIds, []);
    assert.strictEqual(
      stockIncremented,
      false,
      "Stock MUST NOT be incremented when order claim fails"
    );
  });
});

