import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SlideBody = {
  id?: unknown;
  eyebrow?: unknown;
  title?: unknown;
  subtitle?: unknown;
  image?: unknown;
  href?: unknown;
  buttonText?: unknown;
  isActive?: unknown;
  sortOrder?: unknown;
};

const defaultSlides = [
  {
    eyebrow: "New Arrivals",
    title: "Fresh beauty collection",
    subtitle: "Discover premium beauty, skincare, and lifestyle essentials.",
    image: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1600&q=80",
    href: "/shop?category=cosmetics",
    buttonText: "Shop Now",
    sortOrder: 0,
  },
  {
    eyebrow: "Skincare",
    title: "Glow essentials",
    subtitle: "Hydrating and nourishing skincare picks for daily care.",
    image: "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1600&q=80",
    href: "/shop?category=skincare",
    buttonText: "Explore",
    sortOrder: 1,
  },
];

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function boolValue(value: unknown) {
  return value === true || value === "true";
}

async function seedSlidesIfEmpty() {
  const count = await prisma.homeSlide.count();
  if (count > 0) return;

  await prisma.homeSlide.createMany({
    data: defaultSlides,
  });
}

export async function GET(req: Request) {
  try {
    await seedSlidesIfEmpty();

    const { searchParams } = new URL(req.url);
    const includeInactive = searchParams.get("includeInactive") === "true";

    const slides = await prisma.homeSlide.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ success: true, slides });
  } catch (error) {
    console.error("GET /api/home-slides failed:", error);
    return NextResponse.json(
      { success: false, message: "Failed to load home slides." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = (await req.json()) as SlideBody;

    const title = text(body.title);
    const subtitle = text(body.subtitle);
    const image = text(body.image);

    if (!title || !subtitle || !image) {
      return NextResponse.json(
        { success: false, message: "Title, subtitle, and image are required." },
        { status: 400 }
      );
    }

    const slide = await prisma.homeSlide.create({
      data: {
        eyebrow: text(body.eyebrow) || "PURE HAVEN BD",
        title,
        subtitle,
        image,
        href: text(body.href) || "/shop",
        buttonText: text(body.buttonText) || "Shop Now",
        sortOrder: Number.isFinite(Number(body.sortOrder))
          ? Math.floor(Number(body.sortOrder))
          : 0,
        isActive: body.isActive === undefined ? true : boolValue(body.isActive),
      },
    });

    return NextResponse.json({ success: true, slide }, { status: 201 });
  } catch (error) {
    console.error("POST /api/home-slides failed:", error);
    return NextResponse.json(
      { success: false, message: "Failed to create home slide." },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = (await req.json()) as SlideBody;
    const id = positiveId(body.id);

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Valid slide id is required." },
        { status: 400 }
      );
    }

    const data: any = {};

    if (body.eyebrow !== undefined) data.eyebrow = text(body.eyebrow) || "PURE HAVEN BD";
    if (body.title !== undefined) data.title = text(body.title);
    if (body.subtitle !== undefined) data.subtitle = text(body.subtitle);
    if (body.image !== undefined) data.image = text(body.image);
    if (body.href !== undefined) data.href = text(body.href) || "/shop";
    if (body.buttonText !== undefined) data.buttonText = text(body.buttonText) || "Shop Now";
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;

    if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
      data.sortOrder = Math.floor(Number(body.sortOrder));
    }

    const slide = await prisma.homeSlide.update({
      where: { id },
      data,
    });

    return NextResponse.json({ success: true, slide });
  } catch (error: any) {
    console.error("PUT /api/home-slides failed:", error);

    if (error?.code === "P2025") {
      return NextResponse.json(
        { success: false, message: "Slide not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Failed to update home slide." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(req.url);
    const id = positiveId(searchParams.get("id"));

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Valid slide id is required." },
        { status: 400 }
      );
    }

    await prisma.homeSlide.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/home-slides failed:", error);

    if (error?.code === "P2025") {
      return NextResponse.json(
        { success: false, message: "Slide not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Failed to delete home slide." },
      { status: 500 }
    );
  }
}
