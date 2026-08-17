import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CustomerUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
};

const usersFile = path.join(process.cwd(), "data", "customer-users.json");
const customerCookieName = "pure_haven_customer_auth";

function sanitizePhone(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function readCookie(req: Request, name: string) {
  const cookieHeader = req.headers.get("cookie") || "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.split("=");

    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return "";
}

async function readUsers(): Promise<CustomerUser[]> {
  try {
    const raw = await readFile(usersFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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
    const customerId = readCookie(req, customerCookieName);

    if (!customerId) {
      return NextResponse.json(
        { success: false, authenticated: false, message: "Customer login required." },
        { status: 401 }
      );
    }

    const users = await readUsers();
    const user = users.find((item) => item.id === customerId);

    if (!user) {
      return NextResponse.json(
        { success: false, authenticated: false, message: "Customer not found." },
        { status: 401 }
      );
    }

    const phone = sanitizePhone(user.phone);

    const orders = await prisma.order.findMany({
      where: {
        customerPhone: phone,
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
        phone: user.phone,
        createdAt: user.createdAt,
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
