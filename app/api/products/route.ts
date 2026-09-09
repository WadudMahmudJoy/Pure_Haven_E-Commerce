import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";
import { invalidateProductReadCache } from "@/lib/serverReadCache";
import { normalizeMoney, requireNonNegativeMoney } from "@/lib/money";
import {
  parsePublicCatalogParams,
  parseAdminCatalogParams,
  CatalogQueryParamError,
} from "@/lib/catalog/queryParams";
import {
  getPublicCatalogQuery,
  getPublicProductDetailQuery,
} from "@/lib/catalog/publicCatalogQuery";
import {
  getAdminCatalogQuery,
  getAdminProductDetailQuery,
  getAdminLowStockCount,
} from "@/lib/catalog/adminCatalogQuery";
import {
  parseGalleryWriteIntent,
  applyGalleryMutation,
} from "@/lib/catalog/galleryWrite";
import { productMediaAttachmentService } from "@/lib/media/productMediaAttachmentService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicCacheHeaders(seconds = 60) {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`,
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown) {
  const clean = text(value);
  return clean ? clean : null;
}

function safeStock(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function boolValue(value: unknown) {
  return value === true || value === "true";
}

function validId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return num;
}

function badgeToneValue(value: unknown) {
  const tone = text(value).toLowerCase();
  return ["sale", "new", "offer", "hot", "festival"].includes(tone)
    ? tone
    : "sale";
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const view = text(searchParams.get("view")).toLowerCase();
    const hasId = searchParams.has("id");

    // 1. ADMIN PRIVILEGED BRANCH FIRST
    if (view === "admin" || view === "full") {
      const unauthorized = requireAdmin(req);
      if (unauthorized) return unauthorized;

      if (searchParams.has("metric")) {
        const metric = text(searchParams.get("metric")).toLowerCase();
        if (metric === "low-stock") {
          const totalItems = await getAdminLowStockCount();
          return NextResponse.json({ success: true, metric: "low-stock", totalItems });
        }

        return NextResponse.json(
          { success: false, message: "Invalid admin metric." },
          { status: 400 }
        );
      }

      if (hasId) {
        const id = parsePositiveInt(searchParams.get("id"));
        if (!id) {
          return NextResponse.json(
            { success: false, message: "Invalid product ID." },
            { status: 400 }
          );
        }

        const product = await getAdminProductDetailQuery(id);
        if (!product) {
          return NextResponse.json(
            { success: false, message: "Product not found." },
            { status: 404 }
          );
        }

        return NextResponse.json({ success: true, product });
      }

      // Admin List
      const rawParams = Object.fromEntries(searchParams.entries());
      const params = parseAdminCatalogParams(rawParams);
      const result = await getAdminCatalogQuery(params);
      return NextResponse.json(result);
    }

    // 2. PUBLIC DETAIL BRANCH
    if (hasId) {
      const id = parsePositiveInt(searchParams.get("id"));
      if (!id) {
        return NextResponse.json(
          { success: false, message: "Invalid product ID." },
          { status: 400 }
        );
      }

      const product = await getPublicProductDetailQuery(id);
      if (!product) {
        return NextResponse.json(
          { success: false, message: "Product not found." },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { success: true, product },
        { headers: publicCacheHeaders() }
      );
    }

    // 3. PUBLIC LIST BRANCH
    const rawParams = Object.fromEntries(searchParams.entries());
    const params = parsePublicCatalogParams(rawParams);
    const result = await getPublicCatalogQuery(params);
    return NextResponse.json(result, { headers: publicCacheHeaders() });
  } catch (error) {
    if (error instanceof CatalogQueryParamError) {
      return NextResponse.json(
        {
          success: false,
          code: error.code,
          message: error.message,
        },
        { status: 400 }
      );
    }

    console.error("GET /api/products failed:", error);
    return NextResponse.json(
      { success: false, message: "Failed to load products." },
      { status: 500 }
    );
  }
}

type RawVariantInput = {
  id?: unknown;
  label?: unknown;
  price?: unknown;
  stock?: unknown;
  image?: unknown;
};

export async function POST(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = (await req.json()) as Record<string, unknown>;

    const name = text(body.name);
    const image = text(body.image);
    const category = text(body.category);

    if (!name || !image || !category) {
      return NextResponse.json(
        { success: false, message: "Name, image, and category are required." },
        { status: 400 }
      );
    }

    const price = requireNonNegativeMoney(body.price, "Product price");
    const compareAtPrice =
      body.compareAtPrice !== undefined && body.compareAtPrice !== null && body.compareAtPrice !== ""
        ? normalizeMoney(body.compareAtPrice, "Compare at price")
        : null;

    const rawVariants = Array.isArray(body.variants)
      ? (body.variants as RawVariantInput[])
      : [];
    const variants = rawVariants
      .map((item) => ({
        label: text(item?.label),
        price: requireNonNegativeMoney(item?.price, "Variant price"),
        stock: safeStock(item?.stock),
        image: optionalText(item?.image),
      }))
      .filter((item) => item.label && item.price >= 0);

    const initialStock =
      variants.length > 0
        ? variants.reduce((sum, item) => sum + item.stock, 0)
        : safeStock(body.stock);

    let categoryId: number | null = null;
    let resolvedCategoryName = category;

    if (body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== "") {
      const parsedCatId = Number(body.categoryId);
      if (!Number.isInteger(parsedCatId) || parsedCatId <= 0) {
        return NextResponse.json(
          { success: false, message: "Invalid categoryId provided." },
          { status: 400 }
        );
      }
      const matchedCategory = await prisma.category.findUnique({
        where: { id: parsedCatId },
      });
      if (!matchedCategory) {
        return NextResponse.json(
          { success: false, message: `Category with ID ${parsedCatId} not found.` },
          { status: 400 }
        );
      }
      categoryId = matchedCategory.id;
      resolvedCategoryName = matchedCategory.name;
    } else {
      const matchedCategory = await prisma.category.findFirst({
        where: {
          OR: [
            { slug: { equals: category, mode: "insensitive" } },
            { name: { equals: category, mode: "insensitive" } },
          ],
        },
      });
      if (matchedCategory) {
        categoryId = matchedCategory.id;
        resolvedCategoryName = matchedCategory.name;
      }
    }

    const product = await prisma.product.create({
      data: {
        name,
        price,
        compareAtPrice,
        image,
        category: resolvedCategoryName,
        categoryId,
        subcategory: optionalText(body.subcategory),
        description: optionalText(body.description),
        stock: initialStock,
        isHotDeal: boolValue(body.isHotDeal),
        isUpcoming: boolValue(body.isUpcoming),
        badgeText: optionalText(body.badgeText),
        badgeTone: badgeToneValue(body.badgeTone),
        variants: {
          create: variants.map((item) => ({
            label: item.label,
            price: item.price,
            stock: item.stock,
            image: item.image,
          })),
        },
      },
      include: { variants: { orderBy: { id: "asc" } } },
    });

    invalidateProductReadCache();

    return NextResponse.json({ success: true, product }, { status: 201 });
  } catch (error) {
    console.error("POST /api/products failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to create product.",
      },
      { status: 400 }
    );
  }
}

export async function PUT(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();

    // 1. Syntactic gallery validation & conflict check BEFORE lookup/transaction
    const galleryParsed = parseGalleryWriteIntent(body);
    if (!galleryParsed.ok) {
      return NextResponse.json(
        { success: false, message: galleryParsed.message },
        { status: galleryParsed.statusCode }
      );
    }
    const galleryIntent = galleryParsed.intent;

    const id = validId(body.id);

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Valid product id is required." },
        { status: 400 }
      );
    }

    const existing = await prisma.product.findUnique({
      where: { id },
      include: { variants: true },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Product not found." },
        { status: 404 }
      );
    }

    const name = text(body.name);
    const category = text(body.category);

    if (!name || !category) {
      return NextResponse.json(
        { success: false, message: "Name and category are required." },
        { status: 400 }
      );
    }

    const price = requireNonNegativeMoney(body.price, "Product price");
    const compareAtPrice =
      body.compareAtPrice !== undefined && body.compareAtPrice !== null && body.compareAtPrice !== ""
        ? normalizeMoney(body.compareAtPrice, "Compare at price")
        : null;

    const rawVariants = Array.isArray(body.variants) ? body.variants : [];
    const existingVariantsMap = new Map(existing.variants.map((v) => [v.id, v]));
    const submittedVariantIds = new Set<number>();

    const variantsToUpdate: Array<{ id: number; label: string; price: number; image: string | null }> = [];
    const variantsToCreate: Array<{ label: string; price: number; stock: number; image: string | null }> = [];

    for (const item of rawVariants) {
      const vLabel = text(item.label);
      if (!vLabel) continue;
      const vPrice = requireNonNegativeMoney(item.price, "Variant price");
      const vImage = optionalText(item.image);

      if (item.id !== undefined && item.id !== null) {
        const vid = validId(item.id);
        if (!vid || !existingVariantsMap.has(vid)) {
          return NextResponse.json(
            {
              success: false,
              message: `Variant ID ${item.id} does not belong to product ID ${id}.`,
            },
            { status: 400 }
          );
        }
        submittedVariantIds.add(vid);
        variantsToUpdate.push({
          id: vid,
          label: vLabel,
          price: vPrice,
          image: vImage,
        });
      } else {
        variantsToCreate.push({
          label: vLabel,
          price: vPrice,
          stock: safeStock(item.stock),
          image: vImage,
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Step A: Re-read target Product inside transaction and verify exists and not soft-deleted
      const targetProduct = await tx.product.findUnique({
        where: { id },
        select: {
          id: true,
          deletedAt: true,
        },
      });

      if (!targetProduct) {
        const err = Object.assign(new Error("Product not found."), { statusCode: 404 });
        throw err;
      }

      if (targetProduct.deletedAt !== null) {
        const err = Object.assign(new Error("Cannot edit a soft-deleted product."), { statusCode: 400 });
        throw err;
      }

      // Step B: Apply gallery mutation
      const { primaryImageOverride } = await applyGalleryMutation(tx, {
        productId: id,
        intent: galleryIntent,
      });

      // Check omitted variants for active inventory reservations before deleting
      for (const ev of existing.variants) {
        if (!submittedVariantIds.has(ev.id)) {
          // Check for active or return-bearing fulfilled reservations
          // Wave E Note: Unresolved ReturnItem rows in Wave E will build on this exact catalog identity retention.
          const activeReservationCount = await tx.inventoryReservation.count({
            where: {
              variantId: ev.id,
              status: { in: ["RESERVED", "FULFILLED"] },
            },
          });

          if (activeReservationCount > 0) {
            throw new Error(`VARIANT_RESERVED_ACTIVE:${ev.id}`);
          }

          await tx.productVariant.delete({
            where: { id: ev.id },
          });
        }
      }

      // Update existing variants (preserving their live stock in DB)
      for (const uv of variantsToUpdate) {
        await tx.productVariant.update({
          where: { id: uv.id },
          data: {
            label: uv.label,
            price: uv.price,
            image: uv.image,
          },
        });
      }

      // Create new variants
      for (const cv of variantsToCreate) {
        await tx.productVariant.create({
          data: {
            productId: id,
            label: cv.label,
            price: cv.price,
            stock: cv.stock,
            image: cv.image,
          },
        });
      }

      // Re-query current variants in DB to maintain exact aggregate Product.stock mirror
      const hasAnyVariants = variantsToUpdate.length > 0 || variantsToCreate.length > 0;
      let finalProductStock = existing.stock;

      if (hasAnyVariants) {
        const currentVariants = await tx.productVariant.findMany({
          where: { productId: id },
        });
        finalProductStock = currentVariants.reduce((sum, v) => sum + v.stock, 0);
      }

      let categoryId: number | null = null;
      let resolvedCategoryName = category;

      if (body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== "") {
        const parsedCatId = Number(body.categoryId);
        if (!Number.isInteger(parsedCatId) || parsedCatId <= 0) {
          throw new Error("INVALID_CATEGORY_ID: Invalid categoryId provided.");
        }
        const matchedCategory = await tx.category.findUnique({
          where: { id: parsedCatId },
        });
        if (!matchedCategory) {
          throw new Error(`INVALID_CATEGORY_ID: Category with ID ${parsedCatId} not found.`);
        }
        categoryId = matchedCategory.id;
        resolvedCategoryName = matchedCategory.name;
      } else {
        const matchedCategory = await tx.category.findFirst({
          where: {
            OR: [
              { slug: { equals: category, mode: "insensitive" } },
              { name: { equals: category, mode: "insensitive" } },
            ],
          },
        });
        if (matchedCategory) {
          categoryId = matchedCategory.id;
          resolvedCategoryName = matchedCategory.name;
        }
      }

      const productUpdateData = {
        name,
        price,
        compareAtPrice,
        ...(primaryImageOverride !== undefined ? { image: primaryImageOverride } : {}),
        category: resolvedCategoryName,
        categoryId,
        subcategory: optionalText(body.subcategory),
        description: optionalText(body.description),
        stock: hasAnyVariants ? finalProductStock : undefined, // Preserve existing stock if non-variant
        isHotDeal: boolValue(body.isHotDeal),
        isUpcoming: boolValue(body.isUpcoming),
        badgeText: optionalText(body.badgeText),
        badgeTone: badgeToneValue(body.badgeTone),
      };

      const updatedProduct = await tx.product.update({
        where: { id },
        data: productUpdateData,
        include: { variants: { orderBy: { id: "asc" } } },
      });

      return updatedProduct;
    });

    invalidateProductReadCache();

    return NextResponse.json({ success: true, product: result }, { headers: publicCacheHeaders() });
  } catch (error) {
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof (error as { statusCode: unknown }).statusCode === "number"
    ) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        { status: (error as { statusCode: number }).statusCode }
      );
    }

    if (error instanceof Error && error.message.startsWith("VARIANT_RESERVED_ACTIVE:")) {
      const vid = error.message.split(":")[1];
      return NextResponse.json(
        {
          success: false,
          code: "VARIANT_RESERVED_ACTIVE",
          message: `Cannot delete variant ID ${vid} with active inventory reservations.`,
        },
        { status: 409 }
      );
    }

    console.error("PUT /api/products failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to update product.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
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

    if (body.stock === undefined || body.stock === null || typeof body.stock !== "number" || body.stock < 0) {
      return NextResponse.json(
        { success: false, message: "Stock must be a non-negative integer." },
        { status: 400 }
      );
    }

    const targetStock = safeStock(body.stock);
    const variantId = body.variantId !== undefined && body.variantId !== null ? validId(body.variantId) : null;

    const existing = await prisma.product.findUnique({
      where: { id },
      include: { variants: true },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Product not found." },
        { status: 404 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      if (variantId) {
        const variant = existing.variants.find((v) => v.id === variantId);
        if (!variant) {
          throw new Error("VARIANT_NOT_FOUND");
        }

        const delta = targetStock - variant.stock;

        await tx.productVariant.update({
          where: { id: variantId },
          data: { stock: targetStock },
        });

        const updatedProduct = await tx.product.update({
          where: { id },
          data: { stock: { increment: delta } },
          include: { variants: { orderBy: { id: "asc" } } },
        });

        return updatedProduct;
      } else {
        const updatedProduct = await tx.product.update({
          where: { id },
          data: { stock: targetStock },
          include: { variants: { orderBy: { id: "asc" } } },
        });

        return updatedProduct;
      }
    });

    invalidateProductReadCache();

    return NextResponse.json({ success: true, product: result });
  } catch (error) {
    if (error instanceof Error && error.message === "VARIANT_NOT_FOUND") {
      return NextResponse.json(
        { success: false, message: "Variant not found for this product." },
        { status: 404 }
      );
    }

    console.error("PATCH /api/products failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to adjust product stock.",
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

    // 1. Check for active or return-bearing fulfilled reservations
    const activeReservationCount = await prisma.inventoryReservation.count({
      where: {
        productId: id,
        status: { in: ["RESERVED", "FULFILLED"] },
      },
    });

    if (activeReservationCount > 0) {
      return NextResponse.json(
        {
          success: false,
          code: "PRODUCT_RESERVED_ACTIVE",
          message: "Cannot delete product with active or fulfilled inventory reservations.",
        },
        { status: 409 }
      );
    }

    // 2. Check for historical order items
    let hasHistoricalOrder = false;
    try {
      if (prisma.orderItem?.count) {
        const count = await prisma.orderItem.count({ where: { productId: id } });
        if (count > 0) hasHistoricalOrder = true;
      }
    } catch {}

    if (hasHistoricalOrder) {
      // D6: Soft delete to preserve historical commerce integrity
      await prisma.$transaction([
        prisma.product.update({
          where: { id },
          data: {
            isActive: false,
            deletedAt: new Date(),
          },
        }),
        prisma.productVariant.updateMany({
          where: { productId: id },
          data: { isActive: false },
        }),
      ]);

      invalidateProductReadCache();
      return NextResponse.json({ success: true, softDeleted: true });
    }

    // 3. No historical references -> safe hard delete
    const attachedMedia = await prisma.productImage.findMany({
      where: { productId: id, managedMediaId: { not: null } },
      select: { managedMediaId: true },
    });
    const managedIds = attachedMedia
      .map((m) => m.managedMediaId)
      .filter((m): m is string => Boolean(m));

    await prisma.$transaction(async (tx) => {
      await tx.product.delete({ where: { id } });
      if (managedIds.length > 0) {
        await productMediaAttachmentService.handleDetachedMedia(tx, managedIds);
      }
    });
    invalidateProductReadCache();

    return NextResponse.json({ success: true, softDeleted: false });
  } catch (error) {
    console.error("DELETE /api/products failed:", error);

    return NextResponse.json(
      { success: false, message: "Failed to delete product." },
      { status: 500 }
    );
  }
}
