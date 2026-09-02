import { prisma } from "@/lib/prisma";
import { getCachedCategoryRows } from "@/lib/catalogRead";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ParsedPublicCatalogParams,
  PaginatedResult,
  PublicProductCardDTO,
  PublicProductDetailDTO,
  PublicProductVariantDTO,
} from "./types";

export async function getPublicCatalogQuery(
  params: ParsedPublicCatalogParams
): Promise<PaginatedResult<PublicProductCardDTO>> {
  // 1. invalidFilter short-circuit
  if (params.invalidFilter) {
    return {
      success: true,
      items: [],
      page: params.page,
      pageSize: params.pageSize,
      totalItems: 0,
      totalPages: 0,
      hasMore: false,
      nextPage: null,
    };
  }

  // 2. Base where clause with mandatory public lifecycle
  const where: Prisma.ProductWhereInput = {
    isActive: true,
    deletedAt: null,
  };

  // 3. Category & Subcategory resolution
  if (params.category) {
    const categories = await getCachedCategoryRows(false);
    const categorySlugLower = params.category.toLowerCase();
    const matchedCategory = categories.find(
      (c) => c.slug.toLowerCase() === categorySlugLower && c.isActive
    );

    if (!matchedCategory) {
      return {
        success: true,
        items: [],
        page: params.page,
        pageSize: params.pageSize,
        totalItems: 0,
        totalPages: 0,
        hasMore: false,
        nextPage: null,
      };
    }

    // Authoritative relational filter
    where.categoryId = matchedCategory.id;

    if (params.subcategory) {
      const subcategorySlugLower = params.subcategory.toLowerCase();
      const matchedSub = matchedCategory.subcategories?.find(
        (s) => s.slug.toLowerCase() === subcategorySlugLower && s.isActive
      );

      if (!matchedSub) {
        return {
          success: true,
          items: [],
          page: params.page,
          pageSize: params.pageSize,
          totalItems: 0,
          totalPages: 0,
          hasMore: false,
          nextPage: null,
        };
      }

      // Dual-format subcategory compatibility
      where.OR = [
        { subcategory: { equals: matchedSub.slug, mode: "insensitive" } },
        { subcategory: { equals: matchedSub.name, mode: "insensitive" } },
      ];
    }
  }

  // 4. Search query handling (excludes description)
  if (params.q) {
    const searchConditions: Prisma.ProductWhereInput[] = [
      { name: { contains: params.q, mode: "insensitive" } },
      { categoryRel: { name: { contains: params.q, mode: "insensitive" } } },
      { subcategory: { contains: params.q, mode: "insensitive" } },
    ];

    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: searchConditions }];
      delete where.OR;
    } else {
      where.OR = searchConditions;
    }
  }

  // 5. Deterministic sorting
  let orderBy: Prisma.ProductOrderByWithRelationInput[];
  if (params.sort === "price-asc") {
    orderBy = [{ price: "asc" }, { id: "desc" }];
  } else if (params.sort === "price-desc") {
    orderBy = [{ price: "desc" }, { id: "desc" }];
  } else {
    // "latest"
    orderBy = [{ id: "desc" }];
  }

  // 6. Concurrently query products and total count
  const [products, totalItems] = await Promise.all([
    prisma.product.findMany({
      where,
      skip: params.skip,
      take: params.pageSize,
      orderBy,
      select: {
        id: true,
        name: true,
        price: true,
        compareAtPrice: true,
        image: true,
        category: true,
        stock: true,
        isHotDeal: true,
        isUpcoming: true,
        badgeText: true,
        badgeTone: true,
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

  // 7. Project to PublicProductCardDTO (Decimal -> Number presentation serialization)
  const items: PublicProductCardDTO[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    compareAtPrice:
      p.compareAtPrice == null ? null : Number(p.compareAtPrice),
    image: p.image,
    category: p.category,
    stock: p.stock,
    isHotDeal: p.isHotDeal,
    isUpcoming: p.isUpcoming,
    badgeText: p.badgeText,
    badgeTone: p.badgeTone,
    hasVariants: (p._count?.variants ?? 0) > 0,
  }));

  // 8. Pagination envelope calculation
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

export async function getPublicProductDetailQuery(
  id: number
): Promise<PublicProductDetailDTO | null> {
  const product = await prisma.product.findFirst({
    where: {
      id,
      isActive: true,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      price: true,
      compareAtPrice: true,
      image: true,
      category: true,
      categoryId: true,
      subcategory: true,
      description: true,
      stock: true,
      isHotDeal: true,
      isUpcoming: true,
      badgeText: true,
      badgeTone: true,
      variants: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          label: true,
          price: true,
          stock: true,
          image: true,
        },
      },
    },
  });

  if (!product) {
    return null;
  }

  const variants: PublicProductVariantDTO[] = product.variants.map((v) => ({
    id: v.id,
    label: v.label,
    price: Number(v.price),
    stock: v.stock,
    image: v.image,
  }));

  return {
    id: product.id,
    name: product.name,
    price: Number(product.price),
    compareAtPrice:
      product.compareAtPrice == null ? null : Number(product.compareAtPrice),
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
    hasVariants: variants.length > 0,
    variants,
  };
}

/**
 * Keyset-paginated batch reader for sitemap generation.
 *
 * Invariants:
 *   - id ASC ordering
 *   - keyset traversal (id > afterId) with zero OFFSET/skip
 *   - active + non-deleted lifecycle only
 *   - minimal projection: strictly id and updatedAt
 *   - defensive bounds: take defaults to 1000, capped at 1000, fails closed on invalid take
 */
export async function getSitemapProductRowsBatch(params?: {
  afterId?: number;
  take?: number;
}): Promise<
  Array<{
    id: number;
    updatedAt: Date;
  }>
> {
  const DEFAULT_SITEMAP_BATCH_SIZE = 1000;
  const MAX_SITEMAP_BATCH_SIZE = 1000;

  let take = DEFAULT_SITEMAP_BATCH_SIZE;

  if (params?.take !== undefined) {
    const rawTake = params.take;
    if (
      typeof rawTake !== "number" ||
      !Number.isInteger(rawTake) ||
      rawTake < 1 ||
      rawTake > MAX_SITEMAP_BATCH_SIZE
    ) {
      throw new Error(
        `Invalid take parameter: ${rawTake}. Must be an integer between 1 and ${MAX_SITEMAP_BATCH_SIZE}.`
      );
    }
    take = rawTake;
  }

  const where: Prisma.ProductWhereInput = {
    isActive: true,
    deletedAt: null,
    ...(params?.afterId !== undefined ? { id: { gt: params.afterId } } : {}),
  };

  return prisma.product.findMany({
    where,
    orderBy: [{ id: "asc" }],
    take,
    select: {
      id: true,
      updatedAt: true,
    },
  });
}
