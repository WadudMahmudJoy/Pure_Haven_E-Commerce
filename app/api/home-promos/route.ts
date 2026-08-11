import { NextResponse } from "next/server";

function publicCacheHeaders(seconds = 300) {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`,
  };
}
import { requireAdmin } from "@/lib/adminSession";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PromoKind = "slider" | "wide" | "small";

type HomePromo = {
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

const filePath = path.join(process.cwd(), "data", "home-promos.json");

const seedData: HomePromo[] = [
  {
    id: "slide-1",
    kind: "slider",
    label: "New Arrivals",
    title: "Fresh Beauty Collection",
    subtitle: "Explore cosmetics, skincare, haircare, and daily essentials.",
    image: "/images/categories/cosmetics.jpg",
    href: "/shop",
    isActive: true,
    sortOrder: 1
  },
  {
    id: "wide-1",
    kind: "wide",
    label: "Explore Now",
    title: "Top Picks",
    subtitle: "",
    image: "/images/categories/cosmetics.jpg",
    href: "/shop",
    isActive: true,
    sortOrder: 1
  },
  {
    id: "small-1",
    kind: "small",
    label: "New Arrivals",
    title: "New Arrivals",
    subtitle: "",
    image: "/images/categories/skincare.jpg",
    href: "/shop",
    isActive: true,
    sortOrder: 1
  },
  {
    id: "small-2",
    kind: "small",
    label: "Hot Deals",
    title: "Hot Deals",
    subtitle: "",
    image: "/images/categories/haircare.jpg",
    href: "/shop",
    isActive: true,
    sortOrder: 2
  }
];

async function ensureFile() {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, JSON.stringify(seedData, null, 2), "utf8");
  }
}

async function readItems(): Promise<HomePromo[]> {
  await ensureFile();

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : seedData;
  } catch {
    return seedData;
  }
}

async function writeItems(items: HomePromo[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(items, null, 2), "utf8");
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanKind(value: unknown): PromoKind {
  return value === "wide" || value === "small" || value === "slider"
    ? value
    : "slider";
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
    const kind = searchParams.get("kind");

    const items = await readItems();

    const filtered = items
      .filter((item) => !kind || item.kind === kind)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return NextResponse.json({ success: true, items: filtered });
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
    const items = await readItems();

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

    const item: HomePromo = {
      id: `promo-${Date.now()}`,
      kind,
      label: cleanText(body.label) || defaults.label,
      title: cleanText(body.title) || defaults.title,
      subtitle: cleanText(body.subtitle),
      image: cleanText(body.image) || defaults.image,
      href: cleanText(body.href) || "/shop",
      isActive: body.isActive === undefined ? true : cleanBool(body.isActive),
      sortOrder: sortOrder > 0 ? sortOrder : 1,
    };

    items.push(item);
    await writeItems(items);

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
    const id = cleanText(body.id);

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Promo id is required." },
        { status: 400 }
      );
    }

    const items = await readItems();
    const index = items.findIndex((item) => item.id === id);

    if (index < 0) {
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

    items[index] = {
      id,
      kind,
      label: cleanText(body.label) || defaults.label,
      title: cleanText(body.title) || defaults.title,
      subtitle: cleanText(body.subtitle),
      image: cleanText(body.image) || items[index].image || defaults.image,
      href: cleanText(body.href) || "/shop",
      isActive: body.isActive === undefined ? true : cleanBool(body.isActive),
      sortOrder: sortOrder > 0 ? sortOrder : 1,
    };

    await writeItems(items);

    return NextResponse.json({ success: true, item: items[index] });
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

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Promo id is required." },
        { status: 400 }
      );
    }

    const items = await readItems();
    await writeItems(items.filter((item) => item.id !== id));

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to delete promo." },
      { status: 500 }
    );
  }
}



