import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeProvider, normalizeTrxId, sanitizePhone } from "@/lib/paymentService";
import { consumeRateLimit } from "@/lib/rateLimit";
import {
  getRateLimitClientKey,
} from "@/lib/rateLimitPolicy";
import { PaymentState } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Fix #6 — Dedicated rate-limit policy for payment evidence endpoint
//
// 10 requests / client IP / 60-second window.
// This is a public financial mutation endpoint — must be conservative.
// Denial occurs BEFORE any order lookup, PaymentRecord read, or DB write.
// ---------------------------------------------------------------------------
const PAYMENT_EVIDENCE_MAX_REQUESTS_PER_CLIENT = 10;
const PAYMENT_EVIDENCE_WINDOW_SECONDS = 60;

export async function POST(req: Request) {
  try {
    // -----------------------------------------------------------------------
    // Fix #6 — Rate-limit check FIRST, before any DB work
    // -----------------------------------------------------------------------
    const clientKey = getRateLimitClientKey(req);
    const evidenceBucketKey = `payment_evidence:${clientKey}`;

    const rateLimitResult = consumeRateLimit(
      evidenceBucketKey,
      PAYMENT_EVIDENCE_MAX_REQUESTS_PER_CLIENT,
      PAYMENT_EVIDENCE_WINDOW_SECONDS * 1000
    );

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          success: false,
          message: "Too many payment evidence submissions. Please try again later.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfterSeconds),
          },
        }
      );
    }

    // -----------------------------------------------------------------------
    // Parse and validate request payload
    // -----------------------------------------------------------------------
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body) {
      return NextResponse.json(
        { success: false, message: "Invalid request payload." },
        { status: 400 }
      );
    }

    const orderIdRaw = String(body.orderId || body.id || "").trim();
    const customerPhoneRaw = String(body.customerPhone || body.phone || "").trim();
    const providerRaw = String(body.provider || body.paymentProvider || "").trim();
    const senderNumberRaw = String(body.senderNumber || "").trim();
    const trxIdRaw = String(body.trxId || body.transactionId || "").trim();

    if (!orderIdRaw || !customerPhoneRaw) {
      return NextResponse.json(
        { success: false, message: "Order identifier and customer phone number are required." },
        { status: 400 }
      );
    }

    if (!providerRaw || !senderNumberRaw || !trxIdRaw) {
      return NextResponse.json(
        { success: false, message: "Payment provider, sender number, and transaction ID are required." },
        { status: 400 }
      );
    }

    const normalizedProvider = normalizeProvider(providerRaw);
    if (!normalizedProvider) {
      return NextResponse.json(
        { success: false, message: "Invalid payment provider. Must be bKash or Nagad." },
        { status: 400 }
      );
    }

    const normalizedTrxId = normalizeTrxId(trxIdRaw);
    if (!normalizedTrxId) {
      return NextResponse.json(
        { success: false, message: "Transaction ID cannot be empty." },
        { status: 400 }
      );
    }

    const sanitizedPhone = sanitizePhone(customerPhoneRaw);
    const sanitizedSender = sanitizePhone(senderNumberRaw);

    if (!sanitizedSender) {
      return NextResponse.json(
        { success: false, message: "Invalid sender phone number." },
        { status: 400 }
      );
    }

    // -----------------------------------------------------------------------
    // Lookup order with PaymentRecord
    // Fix #19 — Use generic "not found" if customer authorization fails
    // to avoid leaking whether the orderId exists
    // -----------------------------------------------------------------------
    const order = await prisma.order.findFirst({
      where: {
        OR: [
          { orderId: orderIdRaw },
          { id: orderIdRaw },
        ],
      },
      include: {
        paymentRecord: true,
      },
    });

    // Authorization check — use same generic message for not-found vs phone mismatch
    const orderPhone = order ? sanitizePhone(order.customerPhone) : null;
    if (!order || orderPhone !== sanitizedPhone) {
      return NextResponse.json(
        { success: false, message: "Order not found or customer phone number does not match." },
        { status: 404 }
      );
    }

    // COD check
    const isCod =
      order.paymentMethod?.toLowerCase().includes("cash") ||
      order.paymentMethod?.toLowerCase().includes("delivery") ||
      order.paymentRecord?.method?.toLowerCase().includes("cash");

    if (isCod) {
      return NextResponse.json(
        { success: false, message: "Cash on Delivery orders do not accept manual payment evidence." },
        { status: 400 }
      );
    }

    // Authoritative deadline check from InventoryReservation
    const now = new Date();
    const reservations = await prisma.inventoryReservation.findMany({
      where: { orderId: order.id },
    });

    if (reservations.length > 0) {
      const deadlines = reservations
        .map((r) => r.evidenceDeadlineAt)
        .filter((d): d is Date => d !== null);

      if (deadlines.length > 0) {
        // Verify common deadline
        const firstTime = deadlines[0].getTime();
        const hasConflict = deadlines.some((d) => Math.abs(d.getTime() - firstTime) > 1000);

        if (hasConflict) {
          return NextResponse.json(
            { success: false, message: "Reservation deadline integrity conflict." },
            { status: 409 }
          );
        }

        if (now.getTime() > deadlines[0].getTime()) {
          return NextResponse.json(
            {
              success: false,
              code: "EVIDENCE_DEADLINE_EXPIRED",
              message: "The payment evidence window has expired for this reservation.",
            },
            { status: 409 }
          );
        }
      }
    }

    // Ensure PaymentRecord exists
    let paymentRecordId = order.paymentRecord?.id;
    if (!paymentRecordId) {
      const createdRecord = await prisma.paymentRecord.create({
        data: {
          orderId: order.id,
          method: normalizedProvider === "BKASH" ? "bKash" : "Nagad",
          provider: normalizedProvider,
          state: "AWAITING_PAYMENT",
          codSettlementState: "NOT_APPLICABLE",
        },
      });
      paymentRecordId = createdRecord.id;
    }

    // -----------------------------------------------------------------------
    // Fix #1 — PaymentRecord owns evidence submission via conditional claim
    //
    // Architecture:
    //   - First submission: expectedSourceState = AWAITING_PAYMENT
    //   - Resubmission after rejection: expectedSourceState = REJECTED
    //
    // Only the winner (claim.count === 1) creates the PaymentEvidenceAttempt.
    // Losers re-read the current state inside the SAME transaction and resolve:
    //   A. VERIFICATION_PENDING + same (provider, trxId) → idempotent 200
    //   B. VERIFICATION_PENDING + different trxId → 409 EVIDENCE_ALREADY_SUBMITTED
    //   C. Other incompatible state → payment-state conflict
    //
    // Cross-order partial unique index (normalizedProvider, normalizedTrxId)
    // WHERE state IN ('PENDING_REVIEW','ACCEPTED') remains final anti-replay
    // authority and is preserved below.
    // -----------------------------------------------------------------------
    const currentPrState = order.paymentRecord?.state ?? PaymentState.AWAITING_PAYMENT;
    const expectedSourceState: PaymentState =
      currentPrState === PaymentState.REJECTED ? PaymentState.REJECTED : PaymentState.AWAITING_PAYMENT;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Step 1 — Conditionally claim the PaymentRecord transition
        const claim = await tx.paymentRecord.updateMany({
          where: {
            id: paymentRecordId,
            state: expectedSourceState,
          },
          data: {
            state: "VERIFICATION_PENDING",
            provider: normalizedProvider,
          },
        });

        if (claim.count === 1) {
          // ----------------------------------------------------------------
          // Winner path — create exactly one new PENDING_REVIEW attempt
          // ----------------------------------------------------------------

          // Cross-order anti-replay: check partial unique index scope
          // (handled by DB constraint; if it throws P2002, caught below)
          const attempt = await tx.paymentEvidenceAttempt.create({
            data: {
              paymentRecordId: paymentRecordId!,
              normalizedProvider,
              senderNumber: sanitizedSender,
              trxId: trxIdRaw.trim(),
              normalizedTrxId,
              submittedAt: now,
              state: "PENDING_REVIEW",
            },
          });

          // Mirror legacy Order fields
          await tx.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: "verification_pending",
              paymentProvider: normalizedProvider,
              paymentSenderNumber: sanitizedSender,
              paymentTrxId: trxIdRaw.trim(),
            },
          });

          return { attempt, idempotent: false };
        }

        // ----------------------------------------------------------------
        // Loser path — claim.count === 0
        // Re-read current PaymentRecord + active evidence inside transaction
        // ----------------------------------------------------------------
        const currentPr = await tx.paymentRecord.findUnique({
          where: { id: paymentRecordId },
          include: {
            evidenceAttempts: {
              where: { state: { in: ["PENDING_REVIEW", "ACCEPTED"] } },
              orderBy: { submittedAt: "desc" },
              take: 1,
            },
          },
        });

        if (currentPr?.state === "VERIFICATION_PENDING") {
          const activeAttempt = currentPr.evidenceAttempts[0];

          if (
            activeAttempt &&
            activeAttempt.normalizedProvider === normalizedProvider &&
            activeAttempt.normalizedTrxId === normalizedTrxId
          ) {
            // Case A — Same (provider, trxId): idempotent success
            return { idempotent: true };
          }

          // Case B — Different (provider, trxId): conflict
          throw new Error("EVIDENCE_ALREADY_SUBMITTED");
        }

        // Case C — Incompatible state (e.g. already PAID, or FAILED)
        throw new Error(`PAYMENT_STATE_CONFLICT:${currentPr?.state ?? "UNKNOWN"}`);
      });

      if (result.idempotent) {
        return NextResponse.json({
          success: true,
          idempotent: true,
          message: "Payment evidence already submitted and pending review.",
        });
      }

      return NextResponse.json({
        success: true,
        message: "Payment evidence submitted successfully. Awaiting verification.",
        attempt: {
          id: result.attempt?.id,
          provider: normalizedProvider,
          trxId: trxIdRaw.trim(),
          submittedAt: now.toISOString(),
          state: "PENDING_REVIEW",
        },
      });
    } catch (txError) {
      if (txError instanceof Error && txError.message === "EVIDENCE_ALREADY_SUBMITTED") {
        return NextResponse.json(
          {
            success: false,
            code: "EVIDENCE_ALREADY_SUBMITTED",
            message: "This order already has a pending payment evidence submission.",
          },
          { status: 409 }
        );
      }

      if (
        txError instanceof Error &&
        txError.message.startsWith("PAYMENT_STATE_CONFLICT")
      ) {
        return NextResponse.json(
          {
            success: false,
            code: "PAYMENT_STATE_CONFLICT",
            message: "The payment is in a state that does not accept new evidence submissions.",
          },
          { status: 409 }
        );
      }

      // Handle cross-order partial unique constraint violation (P2002)
      // IMPORTANT: Use root prisma client (not failed tx client)
      if ((txError as { code?: string })?.code === "P2002") {
        const existingClaim = await prisma.paymentEvidenceAttempt.findFirst({
          where: {
            normalizedProvider,
            normalizedTrxId,
            state: { in: ["PENDING_REVIEW", "ACCEPTED"] },
          },
        });

        if (existingClaim && existingClaim.paymentRecordId === paymentRecordId) {
          return NextResponse.json({
            success: true,
            idempotent: true,
            message: "Payment evidence already submitted and pending review.",
          });
        }

        return NextResponse.json(
          {
            success: false,
            code: "PAYMENT_EVIDENCE_ALREADY_CLAIMED",
            message: "This transaction ID has already been submitted for another payment.",
          },
          { status: 409 }
        );
      }

      throw txError;
    }
  } catch (error) {
    console.error("POST /api/orders/payment-evidence failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to submit payment evidence.",
      },
      { status: 500 }
    );
  }
}
