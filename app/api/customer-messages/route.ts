import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminSession";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CustomerMessage = {
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

const filePath = path.join(process.cwd(), "data", "customer-messages.json");

async function ensureFile() {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, JSON.stringify([], null, 2), "utf8");
  }
}

async function readItems(): Promise<CustomerMessage[]> {
  await ensureFile();
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeItems(items: CustomerMessage[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(items, null, 2), "utf8");
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStatus(value: unknown): CustomerMessage["status"] {
  return value === "seen" || value === "answered" || value === "closed" || value === "new"
    ? value
    : "new";
}

export async function GET(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const items = await readItems();
  return NextResponse.json({
    success: true,
    messages: items.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const name = text(body.name);
    const phone = text(body.phone);
    const email = text(body.email);
    const subject = text(body.subject);
    const message = text(body.message);

    if (!name || !phone || !message) {
      return NextResponse.json(
        { success: false, message: "Name, phone, and message are required." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const item: CustomerMessage = {
      id: `msg-${Date.now()}`,
      name,
      phone,
      email,
      subject: subject || "Customer Query",
      message,
      reply: "",
      status: "new",
      createdAt: now,
      updatedAt: now,
    };

    const items = await readItems();
    items.push(item);
    await writeItems(items);

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
    const id = text(body.id);

    const items = await readItems();
    const index = items.findIndex((item) => item.id === id);

    if (index < 0) {
      return NextResponse.json(
        { success: false, message: "Message not found." },
        { status: 404 }
      );
    }

    items[index] = {
      ...items[index],
      reply: text(body.reply),
      status: cleanStatus(body.status),
      updatedAt: new Date().toISOString(),
    };

    await writeItems(items);

    return NextResponse.json({ success: true, message: items[index] });
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

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ success: false, message: "Message id is required." }, { status: 400 });
  }

  const items = await readItems();
  await writeItems(items.filter((item) => item.id !== id));

  return NextResponse.json({ success: true });
}
