import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CustomerMessageDTO = {
  id: string;
  name: string;
  phone: string;
  email: string;
  subject: string;
  message: string;
  reply: string;
  status: "new" | "seen" | "answered" | "closed";
  createdAt: string;
  updatedAt: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStatus(value: unknown): "new" | "seen" | "answered" | "closed" {
  return value === "seen" || value === "answered" || value === "closed" || value === "new"
    ? value
    : "new";
}

export async function GET(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const items = await prisma.customerMessage.findMany({
      orderBy: { createdAt: "desc" },
    });

    const messages: CustomerMessageDTO[] = items.map((m) => ({
      id: String(m.id),
      name: m.name,
      phone: m.phone || "",
      email: m.email || "",
      subject: "Customer Query",
      message: m.message,
      reply: "",
      status: cleanStatus(m.status),
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      messages,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to load messages." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const name = text(body.name);
    const phone = text(body.phone);
    const email = text(body.email);
    const message = text(body.message);

    if (!name || !phone || !message) {
      return NextResponse.json(
        { success: false, message: "Name, phone, and message are required." },
        { status: 400 }
      );
    }

    const created = await prisma.customerMessage.create({
      data: {
        name,
        phone,
        email: email || null,
        message,
        status: "new",
      },
    });

    const item: CustomerMessageDTO = {
      id: String(created.id),
      name: created.name,
      phone: created.phone || "",
      email: created.email || "",
      subject: text(body.subject) || "Customer Query",
      message: created.message,
      reply: "",
      status: "new",
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };

    return NextResponse.json({ success: true, message: "Message submitted.", item }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to submit message." },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();
    const rawId = text(body.id);
    const numericId = Number(rawId);

    if (!rawId) {
      return NextResponse.json(
        { success: false, message: "Message id is required." },
        { status: 400 }
      );
    }

    const existing = await prisma.customerMessage.findUnique({
      where: { id: numericId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Message not found." },
        { status: 404 }
      );
    }

    const updated = await prisma.customerMessage.update({
      where: { id: existing.id },
      data: {
        status: cleanStatus(body.status),
      },
    });

    const item: CustomerMessageDTO = {
      id: String(updated.id),
      name: updated.name,
      phone: updated.phone || "",
      email: updated.email || "",
      subject: "Customer Query",
      message: updated.message,
      reply: text(body.reply),
      status: cleanStatus(updated.status),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };

    return NextResponse.json({ success: true, message: item });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to update message." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const numericId = Number(id);

    if (!id || isNaN(numericId)) {
      return NextResponse.json({ success: false, message: "Valid message id is required." }, { status: 400 });
    }

    await prisma.customerMessage.delete({
      where: { id: numericId },
    }).catch(() => null);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to delete message." },
      { status: 500 }
    );
  }
}
