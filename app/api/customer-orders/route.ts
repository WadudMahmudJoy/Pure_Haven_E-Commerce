/**
 * Customer Orders API Route (Phase 3 Wave B)
 *
 * Authenticates exclusively via PostgreSQL-backed CustomerSession (pure_haven_customer_session).
 * Insecure legacy credentials (pure_haven_customer_auth, customer-users.json) are fail-closed.
 *
 * NOTE: Full Order.userId checkout binding and foreign key ownership migration
 * will be completed in Wave C.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCustomerSessionTokenFromRequest,
  validateCustomerSession,
  clearCustomerSessionCookie,
} from "@/lib/customerSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapOrder(order: {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  paymentProvider: string | null;
  paymentSenderNumber: string | null;
  paymentTrxId: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: number;
    orderId: string;
    productId: number | null;
    variantId?: number | null;
    variantLabel?: string | null;
    name: string;
    price: number;
    compareAtPrice?: number | null;
    image: string;
    category: string;
    quantity: number;
  }>;
}) {
  return {
    id: order.id,
    orderId: order.orderId,
    customer: {
      name: order.customerName,
      phone: order.customerPhone,
      city: order.customerCity,
      address: order.customerAddress,
    },
    items: (order.items || []).map((item) => ({
      id: item.id,
      orderId: item.orderId,
      productId: item.productId ?? null,
      variantId: item.variantId ?? null,
      variantLabel: item.variantLabel ?? null,
      name: item.name,
      price: item.price,
      compareAtPrice: item.compareAtPrice ?? null,
      image: item.image,
      category: item.category,
      quantity: item.quantity,
    })),
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paymentDetails:
      order.paymentProvider ||
      order.paymentSenderNumber ||
      order.paymentTrxId
        ? {
            provider: order.paymentProvider || undefined,
            senderNumber: order.paymentSenderNumber || undefined,
            trxId: order.paymentTrxId || undefined,
          }
        : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export async function GET(req: Request) {
  try {
    const rawToken = getCustomerSessionTokenFromRequest(req);

    if (!rawToken) {
      const res = NextResponse.json(
        { success: false, authenticated: false, message: "Customer login required." },
        { status: 401 }
      );
      clearCustomerSessionCookie(res);
      return res;
    }

    const sessionResult = await validateCustomerSession(rawToken);

    if (!sessionResult.authenticated || !sessionResult.user) {
      const res = NextResponse.json(
        { success: false, authenticated: false, message: "Customer login required." },
        { status: 401 }
      );
      clearCustomerSessionCookie(res);
      return res;
    }

    const user = sessionResult.user;

    const orders = await prisma.order.findMany({
      where: {
        userId: user.id,
      },
      include: {
        items: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      success: true,
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.normalizedPhone,
        createdAt: user.createdAt.toISOString(),
      },
      orders: orders.map(mapOrder),
    });
  } catch (error) {
    console.error("GET /api/customer-orders failed:", error);

    return NextResponse.json(
      { success: false, message: "Failed to load customer orders." },
      { status: 500 }
    );
  }
}
