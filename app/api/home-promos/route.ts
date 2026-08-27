import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";
import { PromoKind } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicCacheHeaders(seconds = 300) {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`,
  };
}

type HomePromoDTO = {
  id: string;
  kind: PromoKind;
  label: string;
  title: string;
  subtitle: string;
  image: string;
  href: string;
  isActive: boolean;
  sortOrder: number;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanKind(value: unknown): PromoKind {
  return Object.values(PromoKind).includes(value as PromoKind)
    ? (value as PromoKind)
    : PromoKind.slider;
}

function cleanBool(value: unknown) {
  return value === true || value === "true" || value === "on";
}

function cleanNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const kind = searchParams.get("kind") as PromoKind | null;

    const promos = await prisma.homePromo.findMany({
      where: kind && Object.values(PromoKind).includes(kind) ? { kind } : undefined,
      orderBy: { sortOrder: "asc" },
    });

    const items: HomePromoDTO[] = promos.map((p) => ({
      id: String(p.id),
      kind: p.kind as PromoKind,
      label: p.label,
      title: p.title,
      subtitle: p.subtitle,
      image: p.image,
      href: p.href,
      isActive: p.isActive,
      sortOrder: p.sortOrder,
    }));

    return NextResponse.json({ success: true, items });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to load promos." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();
    const kind = cleanKind(body.kind);

    const defaults =
      kind === "wide"
        ? {
            label: "Explore Now",
            title: "Top Picks",
            image: "/images/categories/cosmetics.jpg",
          }
        : kind === "small"
          ? {
              label: "Featured",
              title: "Featured Promo",
              image: "/images/categories/skincare.jpg",
            }
          : {
              label: "New Arrivals",
              title: "Fresh Beauty Collection",
              image: "/images/categories/cosmetics.jpg",
            };

    const sortOrder = cleanNumber(body.sortOrder);

    const promo = await prisma.homePromo.create({
      data: {
        kind,
        label: cleanText(body.label) || defaults.label,
        title: cleanText(body.title) || defaults.title,
        subtitle: cleanText(body.subtitle),
        image: cleanText(body.image) || defaults.image,
        href: cleanText(body.href) || "/shop",
        isActive: body.isActive === undefined ? true : cleanBool(body.isActive),
        sortOrder: sortOrder > 0 ? sortOrder : 1,
      },
    });

    const item: HomePromoDTO = {
      id: String(promo.id),
      kind: promo.kind as PromoKind,
      label: promo.label,
      title: promo.title,
      subtitle: promo.subtitle,
      image: promo.image,
      href: promo.href,
      isActive: promo.isActive,
      sortOrder: promo.sortOrder,
    };

    return NextResponse.json({ success: true, item }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to add promo.",
      },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();
    const rawId = cleanText(body.id);
    const numericId = Number(rawId);

    if (!rawId) {
      return NextResponse.json(
        { success: false, message: "Promo id is required." },
        { status: 400 }
      );
    }

    let existing;
    if (Number.isInteger(numericId) && numericId > 0) {
      existing = await prisma.homePromo.findUnique({ where: { id: numericId } });
    }
    if (!existing) {
      existing = await prisma.homePromo.findFirst({
        where: { id: Number.isInteger(numericId) && numericId > 0 ? numericId : undefined },
      });
    }

    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Promo item not found." },
        { status: 404 }
      );
    }

    const kind = cleanKind(body.kind);

    const defaults =
      kind === "wide"
        ? {
            label: "Explore Now",
            title: "Top Picks",
            image: "/images/categories/cosmetics.jpg",
          }
        : kind === "small"
          ? {
              label: "Featured",
              title: "Featured Promo",
              image: "/images/categories/skincare.jpg",
            }
          : {
              label: "New Arrivals",
              title: "Fresh Beauty Collection",
              image: "/images/categories/cosmetics.jpg",
            };

    const sortOrder = cleanNumber(body.sortOrder);

    const updated = await prisma.homePromo.update({
      where: { id: existing.id },
      data: {
        kind,
        label: cleanText(body.label) || defaults.label,
        title: cleanText(body.title) || defaults.title,
        subtitle: cleanText(body.subtitle),
        image: cleanText(body.image) || existing.image || defaults.image,
        href: cleanText(body.href) || "/shop",
        isActive: body.isActive === undefined ? true : cleanBool(body.isActive),
        sortOrder: sortOrder > 0 ? sortOrder : 1,
      },
    });

    const item: HomePromoDTO = {
      id: String(updated.id),
      kind: updated.kind as PromoKind,
      label: updated.label,
      title: updated.title,
      subtitle: updated.subtitle,
      image: updated.image,
      href: updated.href,
      isActive: updated.isActive,
      sortOrder: updated.sortOrder,
    };

    return NextResponse.json({ success: true, item });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to update promo.",
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
    const id = searchParams.get("id");
    const numericId = Number(id);

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Promo id is required." },
        { status: 400 }
      );
    }

    if (Number.isInteger(numericId) && numericId > 0) {
      await prisma.homePromo.delete({ where: { id: numericId } }).catch(() => null);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to delete promo." },
      { status: 500 }
    );
  }
}
