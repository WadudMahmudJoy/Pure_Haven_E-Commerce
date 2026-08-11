import { NextResponse } from "next/server";

function publicCacheHeaders(seconds = 300) {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`,
  };
}
import { requireAdmin } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_CATEGORY_DEFINITIONS,
  getDefaultPublicCategories,
  labelFromCategorySlug,
} from "@/lib/defaultCategories";
import { getCachedCategoryRows } from "@/lib/catalogRead";
import { invalidateCategoryReadCache } from "@/lib/serverReadCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CategoryBody = {
  type?: unknown;
  id?: unknown;
  categoryId?: unknown;
  name?: unknown;
  image?: unknown;
  isActive?: unknown;
  sortOrder?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function idValue(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let categorySeedCheckDone = false;
let categorySeedCheckPromise: Promise<void> | null = null;

async function seedCategoriesIfEmpty() {
  const count = await prisma.category.count();

  if (count > 0) return;

  for (const [index, category] of DEFAULT_CATEGORY_DEFINITIONS.entries()) {
    await prisma.category.create({
      data: {
        name: category.name,
        slug: category.slug,
        sortOrder: index,
        subcategories: {
          create: category.subcategories.map((slug, subIndex) => ({
            name: labelFromCategorySlug(slug),
            slug,
            sortOrder: subIndex,
          })),
        },
      },
    });
  }

  invalidateCategoryReadCache();
}

async function ensureCategoriesSeededOnce() {
  if (categorySeedCheckDone) return;

  if (categorySeedCheckPromise) {
    await categorySeedCheckPromise;
    return;
  }

  categorySeedCheckPromise = (async () => {
    await seedCategoriesIfEmpty();
    categorySeedCheckDone = true;
  })();

  try {
    await categorySeedCheckPromise;
  } finally {
    categorySeedCheckPromise = null;
  }
}

export async function GET(req: Request) {
  try {
    await ensureCategoriesSeededOnce();

    const { searchParams } = new URL(req.url);
    const includeInactive = searchParams.get("includeInactive") === "true";

    const categories = await getCachedCategoryRows(includeInactive);

    return NextResponse.json({
      success: true,
      categories,
      fallback: false,
    });
  } catch (error) {
    console.error(
      "GET /api/categories failed. Serving safe fallback categories:",
      error
    );

    return NextResponse.json({
      success: true,
      categories: getDefaultPublicCategories(),
      fallback: true,
    });
  }
}

export async function POST(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = (await req.json()) as CategoryBody;
    const type = text(body.type);
    const name = text(body.name);

    if (!name) {
      return NextResponse.json(
        { success: false, message: "Name is required." },
        { status: 400 }
      );
    }

    if (type === "subcategory") {
      const categoryId = idValue(body.categoryId);

      if (!categoryId) {
        return NextResponse.json(
          { success: false, message: "Category id is required." },
          { status: 400 }
        );
      }

      const subcategory = await prisma.subcategory.create({
        data: {
          categoryId,
          name,
          slug: slugify(name),
        },
      });

      invalidateCategoryReadCache();

      return NextResponse.json({
        success: true,
        subcategory,
      });
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug: slugify(name),
        image: text(body.image) || null,
      },
      include: {
        subcategories: true,
      },
    });

    invalidateCategoryReadCache();

    return NextResponse.json({
      success: true,
      category,
    });
  } catch (error: any) {
    console.error("POST /api/categories failed:", error);

    if (error?.code === "P2002") {
      return NextResponse.json(
        { success: false, message: "This name already exists." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Failed to create category item." },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = (await req.json()) as CategoryBody;
    const type = text(body.type);
    const id = idValue(body.id);
    const name = text(body.name);
    const sortOrder = Number(body.sortOrder);

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Valid id is required." },
        { status: 400 }
      );
    }

    const data: any = {};

    if (name) {
      data.name = name;
      data.slug = slugify(name);
    }

    if (typeof body.isActive === "boolean") {
      data.isActive = body.isActive;
    }

    if (Number.isFinite(sortOrder)) {
      data.sortOrder = Math.floor(sortOrder);
    }

    if (type !== "subcategory") {
      const image = text(body.image);
      data.image = image || null;
    }

    if (type === "subcategory") {
      const subcategory = await prisma.subcategory.update({
        where: { id },
        data,
      });

      invalidateCategoryReadCache();

      return NextResponse.json({
        success: true,
        subcategory,
      });
    }

    const category = await prisma.category.update({
      where: { id },
      data,
      include: {
        subcategories: true,
      },
    });

    invalidateCategoryReadCache();

    return NextResponse.json({
      success: true,
      category,
    });
  } catch (error: any) {
    console.error("PUT /api/categories failed:", error);

    if (error?.code === "P2025") {
      return NextResponse.json(
        { success: false, message: "Item not found." },
        { status: 404 }
      );
    }

    if (error?.code === "P2002") {
      return NextResponse.json(
        { success: false, message: "This name already exists." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Failed to update category item." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "category";
    const id = idValue(searchParams.get("id"));

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Valid id is required." },
        { status: 400 }
      );
    }

    if (type === "subcategory") {
      await prisma.subcategory.delete({
        where: { id },
      });

      invalidateCategoryReadCache();

      return NextResponse.json({
        success: true,
      });
    }

    await prisma.category.delete({
      where: { id },
    });

    invalidateCategoryReadCache();

    return NextResponse.json({
      success: true,
    });
  } catch (error: any) {
    console.error("DELETE /api/categories failed:", error);

    if (error?.code === "P2025") {
      return NextResponse.json(
        { success: false, message: "Item not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Failed to delete category item." },
      { status: 500 }
    );
  }
}



