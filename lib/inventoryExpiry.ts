/**
 * Prepaid Inventory Expiry Service (Task 15)
 *
 * Implements server-authoritative, race-safe automated release of inventory reservations
 * for prepaid orders where the customer failed to submit timely payment evidence within the
 * authoritative 15-minute evidence window (InventoryReservation.evidenceDeadlineAt).
 *
 * Invariants:
 *   - Only manual prepaid orders in `AWAITING_PAYMENT` can be expired.
 *   - `VERIFICATION_PENDING`, `PAID`, `REFUND_REQUIRED`, `REFUND_PROCESSING`, `REFUNDED`
 *     are protected indefinitely from evidence deadline expiry.
 *   - Evidence submission vs Expiry race is resolved via atomic DB claim on `PaymentRecord.state`.
 *   - Winner of claim transitions PaymentRecord from `AWAITING_PAYMENT` -> `FAILED` and
 *     releases reservations with `releaseReason = 'EVIDENCE_DEADLINE_EXPIRED'`.
 *   - Loser (count === 0) performs ZERO stock release.
 *   - Common deadline across all reservations for an order is verified before release.
 *   - Cash on Delivery orders never enter prepaid evidence expiry.
 */

import { prisma } from "@/lib/prisma";
import { releaseOrderReservation } from "@/lib/inventoryService";

export type ExpiryReleaseResult = {
  releasedCount: number;
  orderIds: string[];
};

export async function releaseExpiredReservations(
  now: Date = new Date()
): Promise<ExpiryReleaseResult> {
  // 1. Query all active reservations whose evidence deadline has elapsed
  const expiredReservations = await prisma.inventoryReservation.findMany({
    where: {
      status: "RESERVED",
      evidenceDeadlineAt: {
        lt: now,
      },
    },
  });

  if (!expiredReservations || expiredReservations.length === 0) {
    return { releasedCount: 0, orderIds: [] };
  }

  // 2. Identify candidate order IDs
  const candidateOrderIds = Array.from(
    new Set(expiredReservations.map((r) => r.orderId))
  );

  const releasedOrderIds: string[] = [];
  let totalReleasedCount = 0;

  for (const orderId of candidateOrderIds) {
    // Lookup order with its paymentRecord
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        paymentRecord: true,
      },
    });

    if (!order) continue;

    // COD Exclusion: Cash on Delivery orders never undergo prepaid evidence expiry
    const isCod =
      order.paymentMethod.toLowerCase().includes("cash") ||
      order.paymentMethod.toLowerCase().includes("delivery") ||
      order.paymentRecord?.method?.toLowerCase().includes("cash");

    if (isCod) continue;

    // Invariant: ONLY orders in AWAITING_PAYMENT are eligible for automated expiry release.
    // VERIFICATION_PENDING (evidence submitted) is protected from expiry.
    // PAID, REFUND_REQUIRED, REFUND_PROCESSING, REFUNDED are likewise protected.
    const prState = order.paymentRecord?.state;
    if (prState !== "AWAITING_PAYMENT") {
      continue;
    }

    // Common Deadline Integrity Check:
    // Query all reservations for this order
    const reservations = await prisma.inventoryReservation.findMany({
      where: { orderId: order.id },
    });

    if (reservations.length === 0) continue;

    const deadlines = reservations
      .map((r) => r.evidenceDeadlineAt)
      .filter((d): d is Date => d !== null);

    if (deadlines.length !== reservations.length || deadlines.length === 0) {
      // Incomplete deadline coverage on a modern order -> fail safe
      console.warn(`[InventoryExpiry] Order ${order.orderId || order.id} has reservations with missing deadlines; skipping.`);
      continue;
    }

    const firstTime = deadlines[0].getTime();
    const hasDeadlineConflict = deadlines.some(
      (d) => Math.abs(d.getTime() - firstTime) > 1000
    );

    if (hasDeadlineConflict) {
      // Reservations have divergent deadlines -> integrity violation, fail safe
      console.warn(`[InventoryExpiry] Order ${order.orderId || order.id} has conflicting reservation deadlines; skipping.`);
      continue;
    }

    if (now.getTime() <= firstTime) {
      // Deadline has not actually elapsed
      continue;
    }

    // 3. Race-safe atomic expiry release inside transaction
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Step A: Conditionally claim PaymentRecord transition AWAITING_PAYMENT -> FAILED
        // This is the atomic arbitration point against concurrent payment evidence submission!
        const paymentClaim = await tx.paymentRecord.updateMany({
          where: {
            orderId: order.id,
            state: "AWAITING_PAYMENT",
          },
          data: {
            state: "FAILED",
          },
        });

        if (paymentClaim.count !== 1) {
          // Concurrent evidence submission won (PaymentRecord is now VERIFICATION_PENDING)
          // or another processor claimed it -> Expiry processor loses, performs ZERO release!
          return { released: false, count: 0 };
        }

        // Step B: Atomically release reservations and restore stock
        const releaseResult = await releaseOrderReservation(tx, order.id, {
          releaseReason: "EVIDENCE_DEADLINE_EXPIRED",
          releasedAt: now,
        });

        // Step C: Atomically cancel order
        await tx.order.updateMany({
          where: {
            id: order.id,
            status: { in: ["pending", "PENDING", "awaiting_payment"] },
          },
          data: {
            status: "cancelled",
            cancellationReason: "system_timeout",
            cancellationNote: "Payment evidence window expired without submission",
            cancelledBy: "system",
            cancelledAt: now,
          },
        });

        return { released: true, count: releaseResult.releasedCount };
      });

      if (result.released) {
        releasedOrderIds.push(order.orderId || order.id);
        totalReleasedCount += result.count;
      }
    } catch (err) {
      console.error(`[InventoryExpiry] Failed to execute expiry release for order ${order.id}:`, err);
    }
  }

  return {
    releasedCount: totalReleasedCount,
    orderIds: releasedOrderIds,
  };
}
