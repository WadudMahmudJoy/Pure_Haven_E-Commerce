import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ParsedAdminCatalogParams,
  PaginatedResult,
  AdminProductListDTO,
  AdminProductDetailDTO,
} from "./types";

export async function getAdminCatalogQuery(
  params: ParsedAdminCatalogParams
): Promise<PaginatedResult<AdminProductListDTO>> {
  // 1. Base where clause with mandatory admin list lifecycle
  const where: Prisma.ProductWhereInput = {
    isActive: true,
    deletedAt: null,
  };

  // 2. Admin filter handling
  if (params.filter === "hot") {
    where.isHotDeal = true;
  } else if (params.filter === "upcoming") {
    where.isUpcoming = true;
  } else if (params.filter === "badge") {
    where.badgeText = { not: null };
  } else if (params.filter === "discount") {
    // Database-side exact discount predicate: compareAtPrice IS NOT NULL AND compareAtPrice > price
    where.compareAtPrice = {
      not: null,
      gt: prisma.product.fields.price,
    };
  }

  // 3. Search query handling (Product.name, category, subcategory, exact numeric ID)
  if (params.q) {
    const searchConditions: Prisma.ProductWhereInput[] = [
      { name: { contains: params.q, mode: "insensitive" } },
      { category: { contains: params.q, mode: "insensitive" } },
      { subcategory: { contains: params.q, mode: "insensitive" } },
    ];

    const trimmed = params.q.trim();
    const numId = Number(trimmed);
    if (Number.isInteger(numId) && numId > 0 && String(numId) === trimmed) {
      searchConditions.push({ id: numId });
    }

    where.OR = searchConditions;
  }

  // 4. Bounded concurrent query and total counting
  const [products, totalItems] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ id: "desc" }],
      skip: params.skip,
      take: params.pageSize,
      select: {
        id: true,
        name: true,
        price: true,
        compareAtPrice: true,
        image: true,
        category: true,
        categoryId: true,
        subcategory: true,
        stock: true,
        isHotDeal: true,
        isUpcoming: true,
        badgeText: true,
        badgeTone: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            variants: {
              where: { isActive: true },
            },
          },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  // 5. Projection to AdminProductListDTO with monetary Decimal -> Number conversion
  const items: AdminProductListDTO[] = products.map((p) => {
    const activeVariantCount = p._count?.variants ?? 0;
    return {
      id: p.id,
      name: p.name,
      price: Number(p.price),
      compareAtPrice: p.compareAtPrice !== null ? Number(p.compareAtPrice) : null,
      image: p.image,
      category: p.category,
      categoryId: p.categoryId,
      subcategory: p.subcategory,
      stock: p.stock,
      isHotDeal: p.isHotDeal,
      isUpcoming: p.isUpcoming,
      badgeText: p.badgeText,
      badgeTone: p.badgeTone,
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
      variantCount: activeVariantCount,
      hasVariants: activeVariantCount > 0,
    };
  });

  const totalPages = Math.ceil(totalItems / params.pageSize);
  const hasMore = params.page < totalPages;
  const nextPage = hasMore ? params.page + 1 : null;

  return {
    success: true,
    items,
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages,
    hasMore,
    nextPage,
  };
}

export async function getAdminProductDetailQuery(
  id: number
): Promise<AdminProductDetailDTO | null> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!product) return null;

  const activeVariantCount = product.variants.filter((v) => v.isActive).length;

  return {
    id: product.id,
    name: product.name,
    price: Number(product.price),
    compareAtPrice: product.compareAtPrice !== null ? Number(product.compareAtPrice) : null,
    image: product.image,
    category: product.category,
    categoryId: product.categoryId,
    subcategory: product.subcategory,
    description: product.description,
    stock: product.stock,
    isHotDeal: product.isHotDeal,
    isUpcoming: product.isUpcoming,
    badgeText: product.badgeText,
    badgeTone: product.badgeTone,
    isActive: product.isActive,
    deletedAt: product.deletedAt ? product.deletedAt.toISOString() : null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    variantCount: activeVariantCount,
    hasVariants: activeVariantCount > 0,
    variants: product.variants.map((v) => ({
      id: v.id,
      productId: v.productId,
      label: v.label,
      price: Number(v.price),
      stock: v.stock,
      image: v.image,
      isActive: v.isActive,
      sortOrder: v.sortOrder,
    })),
  };
}

export async function getAdminLowStockCount(): Promise<number> {
  return prisma.product.count({
    where: {
      isActive: true,
      deletedAt: null,
      stock: { lte: 3 },
    },
  });
}
