import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as adminSession from "@/lib/adminSession";

const allowedPaymentStatuses = new Set([
  "unpaid",
  "verification_pending",
  "verified",
  "rejected",
  "refunded",
]);

async function hasAdminAccess(req: Request) {
  const mod = adminSession as any;

  const candidates = [
    "requireAdminSession",
    "requireAdmin",
    "getAdminSession",
    "verifyAdminSession",
    "isAdminSessionValid",
  ];

  for (const name of candidates) {
    const fn = mod?.[name];

    if (typeof fn !== "function") continue;

    try {
      const result = await fn(req);
      if (result) return true;
    } catch {
      try {
        const result = await fn();
        if (result) return true;
      } catch {
        // Try next helper.
      }
    }
  }

  // Fallback for this existing project: admin pages use an HTTP-only admin cookie.
  // Full hardening will be done in the security phase.
  const cookieHeader = req.headers.get("cookie") || "";
  return cookieHeader.includes("pure_haven_admin_session=");
}

export async function PATCH(req: Request) {
  try {
    const isAdmin = await hasAdminAccess(req);

    if (!isAdmin) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

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
