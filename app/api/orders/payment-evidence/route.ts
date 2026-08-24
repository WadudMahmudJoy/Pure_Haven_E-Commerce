import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeProvider, normalizeTrxId, sanitizePhone } from "@/lib/paymentService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
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

    // Lookup order with PaymentRecord
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

    if (!order) {
      return NextResponse.json(
        { success: false, message: "Order not found." },
        { status: 404 }
      );
    }

    // Customer authorization check
    const orderPhone = sanitizePhone(order.customerPhone);
    if (orderPhone !== sanitizedPhone) {
      return NextResponse.json(
        { success: false, message: "Customer phone number does not match this order." },
        { status: 403 }
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

    // Execute submission in transaction with anti-replay and idempotency
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Check for active claim on this (provider, trxId)
        const activeClaim = await tx.paymentEvidenceAttempt.findFirst({
          where: {
            normalizedProvider,
            normalizedTrxId,
            state: { in: ["PENDING_REVIEW", "ACCEPTED"] },
          },
        });

        if (activeClaim) {
          if (activeClaim.paymentRecordId === paymentRecordId) {
            // Idempotent retry for the same order
            return { idempotent: true };
          }

          throw new Error(`PAYMENT_EVIDENCE_ALREADY_CLAIMED:${normalizedProvider}:${normalizedTrxId}`);
        }

        // Create new attempt
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

        // Transition PaymentRecord
        await tx.paymentRecord.update({
          where: { id: paymentRecordId },
          data: {
            state: "VERIFICATION_PENDING",
            provider: normalizedProvider,
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
      if (
        txError instanceof Error &&
        txError.message.startsWith("PAYMENT_EVIDENCE_ALREADY_CLAIMED")
      ) {
        return NextResponse.json(
          {
            success: false,
            code: "PAYMENT_EVIDENCE_ALREADY_CLAIMED",
            message: "This transaction ID has already been submitted for another payment.",
          },
          { status: 409 }
        );
      }

      // Handle partial unique constraint violation (P2002)
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
        message: error instanceof Error ? error.message : "Failed to submit payment evidence.",
      },
      { status: 500 }
    );
  }
}
