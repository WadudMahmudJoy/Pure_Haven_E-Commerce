import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminSession";
import { restockReturnItem } from "@/lib/inventoryService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_DISPOSITIONS = [
  "PENDING_INSPECTION",
  "RESTOCKABLE",
  "NON_RESTOCKABLE",
  "DAMAGED",
] as const;

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

    const returnItemId = Number(body.returnItemId || body.id);
    if (!returnItemId || isNaN(returnItemId)) {
      return NextResponse.json(
        { success: false, message: "Valid returnItemId is required." },
        { status: 400 }
      );
    }

    const rawDisposition = body.disposition ? String(body.disposition).trim().toUpperCase() : null;
    if (rawDisposition && !(VALID_DISPOSITIONS as readonly string[]).includes(rawDisposition)) {
      return NextResponse.json(
        {
          success: false,
          message: `Invalid disposition '${body.disposition}'. Must be one of: ${VALID_DISPOSITIONS.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    const adminNote = body.adminNote ? String(body.adminNote).trim() : undefined;

    const result = await prisma.$transaction(async (tx) => {
      const returnItem = await tx.returnItem.findUnique({
        where: { id: returnItemId },
      });

      if (!returnItem) {
        throw new Error("NOT_FOUND: ReturnItem not found.");
      }

      // If disposition update requested, update it first
      if (rawDisposition && rawDisposition !== returnItem.disposition) {
        await tx.returnItem.update({
          where: { id: returnItemId },
          data: {
            disposition: rawDisposition,
            ...(adminNote ? { adminNote } : {}),
          },
        });
        returnItem.disposition = rawDisposition;
      }

      // Precondition checks for restock execution
      if (!returnItem.physicalReturnAt) {
        throw new Error("VALIDATION: Cannot restock item that has not been physically received.");
      }

      if (returnItem.disposition !== "RESTOCKABLE") {
        throw new Error(`VALIDATION: Cannot restock item with disposition '${returnItem.disposition}'. Must be 'RESTOCKABLE'.`);
      }

      // Execute exactly-once restock
      return await restockReturnItem(tx, returnItemId, { adminNote });
    });

    return NextResponse.json({
      success: true,
      message: result.idempotent
        ? "Return item was already restocked."
        : "Return item restocked successfully.",
      idempotent: result.idempotent ?? false,
      restockedCount: result.restockedCount,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NOT_FOUND:")) {
      return NextResponse.json(
        { success: false, message: error.message.replace("NOT_FOUND:", "").trim() },
        { status: 404 }
      );
    }

    if (error instanceof Error && error.message.startsWith("VALIDATION:")) {
      return NextResponse.json(
        { success: false, message: error.message.replace("VALIDATION:", "").trim() },
        { status: 400 }
      );
    }

    console.error("POST /api/orders/restock error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to execute restock.",
      },
      { status: 500 }
    );
  }
}
