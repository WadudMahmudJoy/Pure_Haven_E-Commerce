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

function mapOrder(order: any) {
  return {
    id: order.id,
    orderId: order.orderId,
    customer: {
      name: order.customerName,
      phone: order.customerPhone,
      city: order.customerCity,
      address: order.customerAddress,
    },
    items: order.items,
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
