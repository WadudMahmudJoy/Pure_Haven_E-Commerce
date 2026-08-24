import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminSession";
import {
  mapLegacyPaymentStatus,
  mapCanonicalToLegacyStatus,
  normalizePaymentState,
  normalizeCodSettlementState,
  validatePaymentTransition,
  validateCodSettlementTransition,
} from "@/lib/paymentService";
import { normalizeMoney, requireNonNegativeMoney } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json(
        { success: false, message: "Invalid request payload." },
        { status: 400 }
      );
    }

    const orderIdRaw = String(body.orderId || body.id || "").trim();
    const attemptIdRaw = body.attemptId ? Number(body.attemptId) : null;
    const actionRaw = body.action ? String(body.action).trim().toUpperCase() : null;
    const paymentStatusRaw = body.paymentStatus ? String(body.paymentStatus).trim() : null;
    const targetStateRaw = body.targetState ? String(body.targetState).trim() : null;
    const codSettlementStateRaw = body.codSettlementState ? String(body.codSettlementState).trim() : null;
    const refundNote = body.refundNote ? String(body.refundNote).trim() : null;
    const rejectionNote = body.rejectionNote ? String(body.rejectionNote).trim() : null;
    const codSettlementNote = body.codSettlementNote ? String(body.codSettlementNote).trim() : null;

    if (!orderIdRaw) {
      return NextResponse.json(
        { success: false, message: "Order id is required." },
        { status: 400 }
      );
    }

    // Lookup PaymentRecord with Order and EvidenceAttempts
    let paymentRecord = await prisma.paymentRecord.findFirst({
      where: {
        OR: [
          { orderId: orderIdRaw },
          { order: { orderId: orderIdRaw } },
        ],
      },
      include: {
        order: true,
        evidenceAttempts: {
          orderBy: { submittedAt: "desc" },
        },
      },
    });

    // Legacy fallback: if order exists without PaymentRecord, create one
    if (!paymentRecord) {
      const order = await prisma.order.findFirst({
        where: {
          OR: [
            { orderId: orderIdRaw },
            { id: orderIdRaw },
          ],
        },
      });

      if (!order) {
        return NextResponse.json(
          { success: false, message: "Order not found." },
          { status: 404 }
        );
      }

      const initialCanonical = mapLegacyPaymentStatus(order.paymentStatus);
      const isCod = order.paymentMethod.toLowerCase().includes("cash");

      paymentRecord = await prisma.paymentRecord.create({
        data: {
          orderId: order.id,
          method: order.paymentMethod,
          state: initialCanonical,
          provider: order.paymentProvider,
          codSettlementState: isCod ? "PENDING" : "NOT_APPLICABLE",
        },
        include: {
          order: true,
          evidenceAttempts: true,
        },
      });
    }

    const now = new Date();
    const verifier = "admin";

    // -------------------------------------------------------------------------
    // BRANCH A: COD SETTLEMENT UPDATE
    // -------------------------------------------------------------------------
    if (codSettlementStateRaw) {
      const normalizedTarget = normalizeCodSettlementState(codSettlementStateRaw);
      if (!normalizedTarget) {
        return NextResponse.json(
          { success: false, message: `Invalid COD settlement state: ${codSettlementStateRaw}` },
          { status: 400 }
        );
      }

      const currentSettlement = paymentRecord.codSettlementState || "NOT_APPLICABLE";
      const transitionValidation = validateCodSettlementTransition(currentSettlement, normalizedTarget);

      if (!transitionValidation.allowed) {
        return NextResponse.json(
          { success: false, code: "INVALID_SETTLEMENT_TRANSITION", message: transitionValidation.reason },
          { status: 409 }
        );
      }

      const updatedRecord = await prisma.$transaction(async (tx) => {
        const updateData: Record<string, unknown> = {
          codSettlementState: normalizedTarget,
        };

        if (normalizedTarget === "SETTLED") {
          updateData.codSettledAt = now;
        }
        if (codSettlementNote !== null) {
          updateData.codSettlementNote = codSettlementNote;
        }

        return await tx.paymentRecord.update({
          where: { id: paymentRecord.id },
          data: updateData,
        });
      });

      return NextResponse.json({
        success: true,
        message: "COD settlement state updated successfully.",
        paymentRecord: updatedRecord,
      });
    }

    // -------------------------------------------------------------------------
    // BRANCH B: EVIDENCE ATTEMPT ACTION (ACCEPT / REJECT)
    // -------------------------------------------------------------------------
    if (actionRaw === "ACCEPT" || actionRaw === "REJECT") {
      const targetAttempt = attemptIdRaw
        ? paymentRecord.evidenceAttempts.find((a) => a.id === attemptIdRaw)
        : paymentRecord.evidenceAttempts[0];

      if (!targetAttempt && paymentRecord.method.toLowerCase().includes("cash")) {
        return NextResponse.json(
          { success: false, message: "COD orders do not have payment evidence attempts." },
          { status: 400 }
        );
      }

      const result = await prisma.$transaction(async (tx) => {
        if (actionRaw === "ACCEPT") {
          // Check if order reservations are still active (RESERVED/FULFILLED) vs RELEASED
          const reservations = await tx.inventoryReservation.findMany({
            where: { orderId: paymentRecord.orderId },
          });

          const hasActiveReservations =
            reservations.length > 0 &&
            reservations.some((r) => r.status === "RESERVED" || r.status === "FULFILLED");

          const isOrderCancelled = paymentRecord.order.status.toLowerCase() === "cancelled";

          if (!hasActiveReservations || isOrderCancelled) {
            // LATE GENUINE MONEY NEVER REVIVES INVENTORY ENTITLEMENT
            // Evidence attempt becomes ACCEPTED, but PaymentRecord becomes REFUND_REQUIRED!
            if (targetAttempt) {
              await tx.paymentEvidenceAttempt.updateMany({
                where: { id: targetAttempt.id, state: "PENDING_REVIEW" },
                data: {
                  state: "ACCEPTED",
                  verifiedAt: now,
                  verifiedBy: verifier,
                },
              });
            }

            const refundAmount = paymentRecord.order.total ?? 0;
            const updatedPr = await tx.paymentRecord.update({
              where: { id: paymentRecord.id },
              data: {
                state: "REFUND_REQUIRED",
                verifiedAt: now,
                verifiedBy: verifier,
                refundAmount,
                refundRequiredAt: now,
                refundNote: "Genuine payment accepted after order cancellation/reservation release",
              },
            });

            await tx.order.update({
              where: { id: paymentRecord.orderId },
              data: {
                paymentStatus: "refunded",
              },
            });

            return { paymentRecord: updatedPr, state: "REFUND_REQUIRED" };
          }

          // Active normal acceptance
          if (targetAttempt) {
            await tx.paymentEvidenceAttempt.updateMany({
              where: { id: targetAttempt.id, state: "PENDING_REVIEW" },
              data: {
                state: "ACCEPTED",
                verifiedAt: now,
                verifiedBy: verifier,
              },
            });
          }

          const updatedPr = await tx.paymentRecord.update({
            where: { id: paymentRecord.id },
            data: {
              state: "PAID",
              verifiedAt: now,
              verifiedBy: verifier,
            },
          });

          await tx.order.update({
            where: { id: paymentRecord.orderId },
            data: {
              paymentStatus: "verified",
            },
          });

          return { paymentRecord: updatedPr, state: "PAID" };
        } else {
          // REJECT
          if (targetAttempt) {
            await tx.paymentEvidenceAttempt.updateMany({
              where: { id: targetAttempt.id, state: "PENDING_REVIEW" },
              data: {
                state: "REJECTED",
                verifiedAt: now,
                verifiedBy: verifier,
                rejectionNote,
              },
            });
          }

          const updatedPr = await tx.paymentRecord.update({
            where: { id: paymentRecord.id },
            data: {
              state: "REJECTED",
              rejectionNote,
            },
          });

          await tx.order.update({
            where: { id: paymentRecord.orderId },
            data: {
              paymentStatus: "rejected",
            },
          });

          return { paymentRecord: updatedPr, state: "REJECTED" };
        }
      });

      return NextResponse.json({
        success: true,
        message: `Payment evidence ${actionRaw.toLowerCase()}ed successfully.`,
        paymentRecord: result.paymentRecord,
      });
    }

    // -------------------------------------------------------------------------
    // BRANCH C: GENERAL PAYMENT STATE / REFUND TRANSITIONS
    // -------------------------------------------------------------------------
    const rawTarget = targetStateRaw || (paymentStatusRaw ? mapLegacyPaymentStatus(paymentStatusRaw) : null);
    const normalizedTarget = rawTarget ? normalizePaymentState(rawTarget) : null;

    if (!normalizedTarget) {
      return NextResponse.json(
        { success: false, message: "Invalid payment status or target state." },
        { status: 400 }
      );
    }

    const currentPaymentState = normalizePaymentState(paymentRecord.state) || "AWAITING_PAYMENT";
    const transitionValidation = validatePaymentTransition(currentPaymentState, normalizedTarget);

    if (!transitionValidation.allowed) {
      return NextResponse.json(
        { success: false, code: "INVALID_PAYMENT_TRANSITION", message: transitionValidation.reason },
        { status: 409 }
      );
    }

    const updatedRecord = await prisma.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {
        state: normalizedTarget,
      };

      if (normalizedTarget === "PAID") {
        updateData.verifiedAt = now;
        updateData.verifiedBy = verifier;
      } else if (normalizedTarget === "REJECTED") {
        if (rejectionNote !== null) updateData.rejectionNote = rejectionNote;
      } else if (normalizedTarget === "REFUND_REQUIRED") {
        updateData.refundRequiredAt = now;
        if (body.refundAmount !== undefined && body.refundAmount !== null) {
          updateData.refundAmount = requireNonNegativeMoney(body.refundAmount, "Refund amount");
        } else {
          updateData.refundAmount = normalizeMoney(paymentRecord.order.total ?? 0, "Refund amount");
        }
        if (refundNote !== null) updateData.refundNote = refundNote;
      } else if (normalizedTarget === "REFUND_PROCESSING") {
        updateData.refundProcessingAt = now;
        if (refundNote !== null) updateData.refundNote = refundNote;
      } else if (normalizedTarget === "REFUNDED") {
        updateData.refundedAt = now;
        if (refundNote !== null) updateData.refundNote = refundNote;
      }

      const pr = await tx.paymentRecord.update({
        where: { id: paymentRecord.id },
        data: updateData,
      });

      // Update legacy Order mirror
      const legacyStatus = mapCanonicalToLegacyStatus(normalizedTarget);
      await tx.order.update({
        where: { id: paymentRecord.orderId },
        data: {
          paymentStatus: legacyStatus,
        },
      });

      return pr;
    });

    return NextResponse.json({
      success: true,
      message: "Payment status updated successfully.",
      paymentRecord: updatedRecord,
      order: {
        id: paymentRecord.orderId,
        paymentStatus: mapCanonicalToLegacyStatus(normalizedTarget),
      },
    });
  } catch (error) {
    console.error("Payment status update failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to update payment status.",
      },
      { status: 500 }
    );
  }
}
