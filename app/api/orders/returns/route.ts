import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_DISPOSITIONS = [
  "PENDING_INSPECTION",
  "RESTOCKABLE",
  "NON_RESTOCKABLE",
  "DAMAGED",
] as const;

type ReturnItemInput = {
  orderItemId: number;
  quantity: number;
  disposition?: string;
  adminNote?: string;
};

export async function POST(req: Request) {
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
    if (!orderIdRaw) {
      return NextResponse.json(
        { success: false, message: "Order id is required." },
        { status: 400 }
      );
    }

    const rawItems = Array.isArray(body.items) ? (body.items as ReturnItemInput[]) : [];
    if (rawItems.length === 0) {
      return NextResponse.json(
        { success: false, message: "At least one return item is required." },
        { status: 400 }
      );
    }

    // Lookup order
    const order = await prisma.order.findFirst({
      where: {
        OR: [{ orderId: orderIdRaw }, { id: orderIdRaw }],
      },
      include: {
        items: {
          include: {
            returnItems: true,
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json(
        { success: false, message: "Order not found." },
        { status: 404 }
      );
    }

    const now = new Date();

    // Process return items in a single atomic transaction
    const createdReturnItems = await prisma.$transaction(async (tx) => {
      const results = [];

      for (const itemInput of rawItems) {
        const orderItemId = Number(itemInput.orderItemId);
        const quantity = Math.floor(Number(itemInput.quantity));

        if (!orderItemId || isNaN(orderItemId)) {
          throw new Error("VALIDATION: Invalid orderItemId.");
        }

        if (!quantity || isNaN(quantity) || quantity <= 0) {
          throw new Error("VALIDATION: Quantity must be a positive integer.");
        }

        // Validate disposition if provided
        let disposition = "PENDING_INSPECTION";
        if (itemInput.disposition) {
          const upperDisp = String(itemInput.disposition).trim().toUpperCase();
          if (!(VALID_DISPOSITIONS as readonly string[]).includes(upperDisp)) {
            throw new Error(`VALIDATION: Invalid disposition '${itemInput.disposition}'. Must be one of: ${VALID_DISPOSITIONS.join(", ")}.`);
          }
          disposition = upperDisp;
        }

        // Authoritative OrderItem lookup
        const orderItem = await tx.orderItem.findUnique({
          where: { id: orderItemId },
          include: { returnItems: true },
        });

        if (!orderItem || orderItem.orderId !== order.id) {
          throw new Error(`VALIDATION: OrderItem ${orderItemId} does not belong to order ${orderIdRaw}.`);
        }

        // Cumulative quantity check across all ReturnItem rows for this OrderItem
        const existingReturnedQty = orderItem.returnItems.reduce(
          (sum, r) => sum + r.quantity,
          0
        );

        if (existingReturnedQty + quantity > orderItem.quantity) {
          throw new Error(
            `VALIDATION: Cumulative returned quantity (${existingReturnedQty + quantity}) would exceed purchased quantity (${orderItem.quantity}) for OrderItem ${orderItemId}.`
          );
        }

        // Exact product & variant identity derived strictly server-side
        const returnItem = await tx.returnItem.create({
          data: {
            orderId: order.id,
            orderItemId: orderItem.id,
            productId: orderItem.productId,
            variantId: orderItem.variantId,
            quantity,
            disposition,
            physicalReturnAt: now,
            restockedAt: null, // Physical intake alone never increments sellable stock!
            adminNote: itemInput.adminNote ? String(itemInput.adminNote).trim() : null,
          },
        });

        results.push(returnItem);
      }

      return results;
    });

    return NextResponse.json({
      success: true,
      message: "Return intake recorded successfully.",
      returnItems: createdReturnItems,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) {
      const message = error.message.replace("VALIDATION:", "").trim();
      return NextResponse.json({ success: false, message }, { status: 400 });
    }

    console.error("POST /api/orders/returns error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to record return intake.",
      },
      { status: 500 }
    );
  }
}
