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

// ---------------------------------------------------------------------------
// Fix #4 — Refund amount validation helper
//
// Validates admin-supplied refundAmount:
//   - Must be a finite positive number (> 0)
//   - Must not exceed the authoritative order total (server-side upper bound)
//
// Returns the normalized amount on success or throws with a stable safe message.
// ---------------------------------------------------------------------------
function validateRefundAmount(
  rawAmount: unknown,
  authoritativeMax: number
): { valid: true; amount: number } | { valid: false; error: string } {
  // Reject non-finite / non-numeric values
  if (rawAmount === null || rawAmount === undefined || typeof rawAmount === "boolean") {
    return { valid: false, error: "Refund amount must be a positive finite number." };
  }

  const num = Number(rawAmount);

  if (!Number.isFinite(num)) {
    return { valid: false, error: "Refund amount must be a positive finite number." };
  }

  const rounded = Math.round(num * 100) / 100;

  // Fix #4 D — reject zero
  if (rounded <= 0) {
    return { valid: false, error: "Refund amount must be greater than zero." };
  }

  // Fix #4 E — reject amounts exceeding the authoritative server-side total
  const normalizedMax = Math.round(authoritativeMax * 100) / 100;
  if (rounded > normalizedMax) {
    return {
      valid: false,
      error: `Refund amount (${rounded}) exceeds the authoritative order total (${normalizedMax}).`,
    };
  }

  return { valid: true, amount: rounded };
}

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

      // Legacy safety: if there's no attempt at all and it's not a COD order,
      // prevent fabricating a review without real submitted evidence.
      if (!targetAttempt) {
        return NextResponse.json(
          {
            success: false,
            code: "NO_PENDING_ATTEMPT",
            message: "No pending payment evidence attempt found for this order.",
          },
          { status: 404 }
        );
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          // ------------------------------------------------------------------
          // Fix #2 — Attempt claim (count === 1 required)
          //
          // Both ACCEPT and REJECT must win the evidence attempt transition
          // exclusively before ANY PaymentRecord mutation occurs.
          // ------------------------------------------------------------------
          const targetAttemptState = actionRaw === "ACCEPT" ? "ACCEPTED" : "REJECTED";

          const attemptClaim = await tx.paymentEvidenceAttempt.updateMany({
            where: {
              id: targetAttempt.id,
              paymentRecordId: paymentRecord.id,
              state: "PENDING_REVIEW",
            },
            data: {
              state: targetAttemptState,
              verifiedAt: now,
              verifiedBy: verifier,
              ...(actionRaw === "REJECT" ? { rejectionNote } : {}),
            },
          });

          if (attemptClaim.count !== 1) {
            // ------------------------------------------------------------------
            // Loser path — another reviewer already claimed this attempt.
            // Re-read to determine if it's an idempotent replay or a conflict.
            // The loser MUST NOT mutate PaymentRecord, verifiedBy, rejectionNote,
            // or any inventory state.
            // ------------------------------------------------------------------
            const currentAttempt = await tx.paymentEvidenceAttempt.findUnique({
              where: { id: targetAttempt.id },
            });

            if (currentAttempt?.state === targetAttemptState) {
              // Idempotent replay for the exact same outcome
              throw new Error(`VERIFY_CONFLICT_IDEMPOTENT:${targetAttemptState}`);
            }

            // Conflicting outcome (ACCEPT vs REJECT divergence)
            throw new Error(`VERIFY_CONFLICT:${currentAttempt?.state ?? "UNKNOWN"}`);
          }

          // ------------------------------------------------------------------
          // Winner path — attempt claimed. Now act on ACCEPT vs REJECT.
          // ------------------------------------------------------------------
          if (actionRaw === "ACCEPT") {
            // ----------------------------------------------------------------
            // Fix #3 — Reservation entitlement decision
            //
            // Case A — ALL reservations are RESERVED or FULFILLED (no RELEASED)
            //          AND order is NOT cancelled → PaymentRecord = PAID
            //
            // Case B — Order is CANCELLED → REFUND_REQUIRED
            //
            // Case C — ANY reservation is RELEASED (including mixed sets) → REFUND_REQUIRED
            //
            // Case D — No reservations on a modern payment flow → fail closed
            // ----------------------------------------------------------------
            const reservations = await tx.inventoryReservation.findMany({
              where: { orderId: paymentRecord.orderId },
            });

            const isOrderCancelled = paymentRecord.order.status.toLowerCase() === "cancelled";

            // Fix #3 — ANY RELEASED reservation triggers refund, even in mixed sets.
            // The old code used `some(RESERVED|FULFILLED)` which incorrectly let
            // mixed RESERVED+RELEASED sets through as PAID.
            const hasAnyReleased = reservations.some((r) => r.status === "RELEASED");
            const allEntitlementBearing =
              reservations.length > 0 &&
              reservations.every(
                (r) => r.status === "RESERVED" || r.status === "FULFILLED"
              );

            const requiresRefund = isOrderCancelled || hasAnyReleased;

            if (requiresRefund || (!allEntitlementBearing && reservations.length > 0)) {
              // LATE GENUINE MONEY — Never revive inventory entitlement
              // Fix #12 — refundAmount derived from authoritative server-side total
              const authoritativeRefundAmount = normalizeMoney(
                paymentRecord.order.total ?? 0,
                "Authoritative refund amount"
              );

              // Fix #7 — PaymentRecord conditional claim (must succeed count=1)
              const paymentClaim = await tx.paymentRecord.updateMany({
                where: {
                  id: paymentRecord.id,
                  state: "VERIFICATION_PENDING",
                },
                data: {
                  state: "REFUND_REQUIRED",
                  verifiedAt: now,
                  verifiedBy: verifier,
                  refundAmount: authoritativeRefundAmount,
                  refundRequiredAt: now,
                  refundNote: "Genuine payment accepted after cancellation or reservation release",
                },
              });

              if (paymentClaim.count !== 1) {
                // PaymentRecord claim failed — roll back the attempt claim too
                throw new Error("PAYMENT_RECORD_CLAIM_FAILED");
              }

              await tx.order.update({
                where: { id: paymentRecord.orderId },
                data: { paymentStatus: "refunded" },
              });

              return { state: "REFUND_REQUIRED" as const, paymentRecordUpdate: { state: "REFUND_REQUIRED", verifiedAt: now, verifiedBy: verifier, refundAmount: authoritativeRefundAmount, refundRequiredAt: now } };
            }

            // Case D — Modern order with no reservations: fail closed
            if (reservations.length === 0) {
              throw new Error("RESERVATION_INTEGRITY_MISSING");
            }

            // Case A — All reservations are entitlement-bearing, order is active
            // Fix #7 — PaymentRecord conditional claim
            const paymentClaim = await tx.paymentRecord.updateMany({
              where: {
                id: paymentRecord.id,
                state: "VERIFICATION_PENDING",
              },
              data: {
                state: "PAID",
                verifiedAt: now,
                verifiedBy: verifier,
              },
            });

            if (paymentClaim.count !== 1) {
              throw new Error("PAYMENT_RECORD_CLAIM_FAILED");
            }

            await tx.order.update({
              where: { id: paymentRecord.orderId },
              data: { paymentStatus: "verified" },
            });

            return { state: "PAID" as const, paymentRecordUpdate: { state: "PAID", verifiedAt: now, verifiedBy: verifier } };
          } else {
            // REJECT
            // Fix #7 — PaymentRecord conditional claim
            const paymentClaim = await tx.paymentRecord.updateMany({
              where: {
                id: paymentRecord.id,
                state: "VERIFICATION_PENDING",
              },
              data: {
                state: "REJECTED",
                rejectionNote,
              },
            });

            if (paymentClaim.count !== 1) {
              throw new Error("PAYMENT_RECORD_CLAIM_FAILED");
            }

            await tx.order.update({
              where: { id: paymentRecord.orderId },
              data: { paymentStatus: "rejected" },
            });

            return { state: "REJECTED" as const, paymentRecordUpdate: { state: "REJECTED", rejectionNote } };
          }
        });

        return NextResponse.json({
          success: true,
          message: `Payment evidence ${actionRaw.toLowerCase()}ed successfully.`,
          paymentRecord: { ...paymentRecord, ...result.paymentRecordUpdate },
          state: result.state,
        });

      } catch (verifyError) {
        if (
          verifyError instanceof Error &&
          verifyError.message.startsWith("VERIFY_CONFLICT:")
        ) {
          return NextResponse.json(
            {
              success: false,
              code: "VERIFY_CONFLICT",
              message: "This payment evidence attempt was already reviewed by another administrator.",
            },
            { status: 409 }
          );
        }

        if (
          verifyError instanceof Error &&
          verifyError.message.startsWith("VERIFY_CONFLICT_IDEMPOTENT:")
        ) {
          // Same outcome already applied — idempotent success
          return NextResponse.json({
            success: true,
            idempotent: true,
            message: `Payment evidence ${actionRaw.toLowerCase()}ed successfully.`,
            paymentRecord: paymentRecord,
          });
        }

        if (
          verifyError instanceof Error &&
          (verifyError.message === "PAYMENT_RECORD_CLAIM_FAILED" ||
            verifyError.message === "RESERVATION_INTEGRITY_MISSING")
        ) {
          return NextResponse.json(
            {
              success: false,
              code: "VERIFICATION_INTEGRITY_ERROR",
              message: "Payment verification could not be completed due to a concurrent state change. Please retry.",
            },
            { status: 409 }
          );
        }

        throw verifyError;
      }
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
          // Fix #4 — validate admin-supplied refundAmount:
          //   >0, finite, not exceeding authoritative server-side order total
          const authoritativeTotal = normalizeMoney(paymentRecord.order.total ?? 0, "Order total");
          const validation = validateRefundAmount(body.refundAmount, authoritativeTotal);

          if (!validation.valid) {
            // Throw to be caught by outer handler and returned as 400
            throw new Error(`REFUND_AMOUNT_INVALID:${validation.error}`);
          }

          updateData.refundAmount = validation.amount;
        } else {
          // Server-authoritative default: use full order total
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
    // Fix #4 — Surface refund amount validation errors as 400
    if (error instanceof Error && error.message.startsWith("REFUND_AMOUNT_INVALID:")) {
      const userMessage = error.message.replace("REFUND_AMOUNT_INVALID:", "");
      return NextResponse.json(
        {
          success: false,
          code: "INVALID_REFUND_AMOUNT",
          message: userMessage,
        },
        { status: 400 }
      );
    }

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
