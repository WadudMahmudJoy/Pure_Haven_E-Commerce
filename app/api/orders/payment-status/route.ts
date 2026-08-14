import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminSession";

const allowedPaymentStatuses = new Set([
  "unpaid",
  "verification_pending",
  "verified",
  "rejected",
  "refunded",
]);

export async function PATCH(req: Request) {
  const unauthorized = requireAdmin(req);

  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = await req.json().catch(() => null);

    const orderId = String(body?.orderId || "").trim();
    const id = String(body?.id || "").trim();
    const paymentStatus = String(body?.paymentStatus || "").trim();

    if (!orderId && !id) {
      return NextResponse.json(
        { success: false, message: "Order id is required." },
        { status: 400 }
      );
    }

    if (!allowedPaymentStatuses.has(paymentStatus)) {
      return NextResponse.json(
        { success: false, message: "Invalid payment status." },
        { status: 400 }
      );
    }

    const lookup = [
      ...(orderId ? [{ orderId }] : []),
      ...(id ? [{ id }] : []),
    ];

    const order = await prisma.order.findFirst({
      where: {
        OR: lookup,
      },
      select: {
        id: true,
        orderId: true,
      },
    });

    if (!order) {
      return NextResponse.json(
        { success: false, message: "Order not found." },
        { status: 404 }
      );
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus },
    });

    return NextResponse.json({
      success: true,
      order: updated,
      message: "Payment status updated.",
    });
  } catch (error) {
    console.error("Payment status update failed:", error);

    return NextResponse.json(
      { success: false, message: "Failed to update payment status." },
      { status: 500 }
    );
  }
}
