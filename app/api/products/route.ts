import { NextResponse } from "next/server";

function publicCacheHeaders(seconds = 60) {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`,
  };
}
import { requireAdmin } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";
import {
  getCachedProductListRows,
  getCachedProductRow,
  getCachedProductRows,
  peekCachedProductRowFromList,
} from "@/lib/catalogRead";
import { invalidateProductReadCache } from "@/lib/serverReadCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown) {
  const clean = text(value);
  return clean ? clean : null;
}

function numberValue(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optionalNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function safeStock(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function boolValue(value: unknown) {
  return value === true || value === "true";
}

function validId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function badgeToneValue(value: unknown) {
  const tone = text(value).toLowerCase();
  return ["sale", "new", "offer", "hot", "festival"].includes(tone)
    ? tone
    : "sale";
}

function cleanVariants(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item: any) => ({
      label: text(item?.label),
      price: numberValue(item?.price),
      stock: safeStock(item?.stock),
      image: optionalText(item?.image),
    }))
    .filter((item) => item.label && item.price > 0);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = validId(searchParams.get("id"));
    const view = text(searchParams.get("view")).toLowerCase();

    if (id) {
      const product =
        peekCachedProductRowFromList(id) ?? (await getCachedProductRow(id));

      if (!product) {
        return NextResponse.json(
          { success: false, message: "Product not found." },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, product }, { headers: publicCacheHeaders() });
    }

    const products =
      view === "admin" || view === "full"
        ? await getCachedProductRows()
        : await getCachedProductListRows();

    return NextResponse.json({ success: true, products }, { headers: publicCacheHeaders() });
  } catch (error) {
    console.error("GET /api/products failed:", error);

    return NextResponse.json(
      { success: false, message: "Failed to load products." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();

    const name = text(body.name);
    const image = text(body.image);
    const category = text(body.category);
    const variants = cleanVariants(body.variants);

    if (!name || !image || !category) {
      return NextResponse.json(
        { success: false, message: "Name, image, and category are required." },
        { status: 400 }
      );
    }

    const product = await prisma.product.create({
      data: {
        name,
        price: numberValue(body.price),
        compareAtPrice: optionalNumber(body.compareAtPrice),
        image,
        category,
        subcategory: optionalText(body.subcategory),
        description: optionalText(body.description),
        stock:
          variants.length > 0
            ? variants.reduce((sum, item) => sum + item.stock, 0)
            : safeStock(body.stock),
        isHotDeal: boolValue(body.isHotDeal),
        isUpcoming: boolValue(body.isUpcoming),
        badgeText: optionalText(body.badgeText),
        badgeTone: badgeToneValue(body.badgeTone),
        variants: variants.length > 0 ? { create: variants } : undefined,
      },
      include: { variants: { orderBy: { id: "asc" } } },
    });

    invalidateProductReadCache();

    return NextResponse.json({ success: true, product }, { status: 201 });
  } catch (error) {
    console.error("POST /api/products failed:", error);

    return NextResponse.json(
      { success: false, message: "Failed to create product." },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();
    const id = validId(body.id);

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Valid product id is required." },
        { status: 400 }
      );
    }

    const variants = cleanVariants(body.variants);

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: text(body.name),
        price: numberValue(body.price),
        compareAtPrice: optionalNumber(body.compareAtPrice),
        image: text(body.image),
        category: text(body.category),
        subcategory: optionalText(body.subcategory),
        description: optionalText(body.description),
        stock:
          variants.length > 0
            ? variants.reduce((sum, item) => sum + item.stock, 0)
            : safeStock(body.stock),
        isHotDeal: boolValue(body.isHotDeal),
        isUpcoming: boolValue(body.isUpcoming),
        badgeText: optionalText(body.badgeText),
        badgeTone: badgeToneValue(body.badgeTone),
        variants: {
          deleteMany: {},
          create: variants,
        },
      },
      include: { variants: { orderBy: { id: "asc" } } },
    });

    invalidateProductReadCache();

    return NextResponse.json({ success: true, product }, { headers: publicCacheHeaders() });
  } catch (error) {
    console.error("PUT /api/products failed:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to update product.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(req.url);
    const id = validId(searchParams.get("id"));

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Valid product id is required." },
        { status: 400 }
      );
    }

    await prisma.product.delete({ where: { id } });
    invalidateProductReadCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/products failed:", error);

    return NextResponse.json(
      { success: false, message: "Failed to delete product." },
      { status: 500 }
    );
  }
}

