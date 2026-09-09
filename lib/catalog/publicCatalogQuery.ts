import { prisma } from "@/lib/prisma";
import { getCachedCategoryRows } from "@/lib/catalogRead";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ParsedPublicCatalogParams,
  PaginatedResult,
  PublicProductCardDTO,
  PublicProductDetailDTO,
  PublicProductVariantDTO,
  PublicProductGalleryImage,
  PublicProductMediaProjection,
} from "./types";
import { resolveSubcategoryBatch } from "./subcategoryResolution";
import { ConfiguredMediaDeliveryResolver } from "@/lib/media/delivery";
import {
  buildPublicResponsiveImageDto,
  type DeliveryReadyManagedMediaInput,
  type PublicResponsiveImageDto,
} from "@/lib/media/publicMediaDto";

type RawProductImageInput = {
  productId?: number;
  url: string;
  sourceKind?: string | null;
  managedMediaId?: string | null;
  altText?: string | null;
};

async function fetchPublicManagedMediaMap(
  managedMediaIds: string[]
): Promise<Map<string, PublicResponsiveImageDto>> {
  const map = new Map<string, PublicResponsiveImageDto>();
  if (managedMediaIds.length === 0) {
    return map;
  }

  const deliveryResolver = new ConfiguredMediaDeliveryResolver(
    process.env.MEDIA_PUBLIC_ORIGIN || "http://localhost:3000/media"
  );

  const managedRows = await prisma.managedMedia.findMany({
    where: {
      id: { in: managedMediaIds },
      lifecycleState: { in: ["READY", "CLEANUP_PENDING"] },
      deliveryDisabledAt: null,
    },
    include: {
      activeProcessingRun: {
        include: {
          mediaObjects: {
            where: {
              role: "RENDITION",
              accessClass: "PUBLIC_DELIVERY",
              deletedAt: null,
            },
          },
        },
      },
    },
  });

  for (const row of managedRows) {
    if (
      row.activeProcessingRun &&
      row.activeProcessingRun.mediaObjects &&
      row.activeProcessingRun.mediaObjects.length > 0
    ) {
      try {
        const deliveryInput: DeliveryReadyManagedMediaInput = {
          mediaId: row.id,
          lifecycleState: row.lifecycleState as "READY" | "CLEANUP_PENDING",
          deliveryDisabledAt: row.deliveryDisabledAt,
          activeProfileVersion: row.activeProcessingRun.profileVersion,
          width: row.sourceWidth ?? 1200,
          height: row.sourceHeight ?? 900,
          objects: row.activeProcessingRun.mediaObjects.map((o) => ({
            variantKey: o.variantKey,
            role: o.role as "MASTER" | "RENDITION",
            accessClass: o.accessClass as "PRIVATE_SOURCE" | "PUBLIC_DELIVERY",
            mimeType: o.mimeType,
            width: o.width,
            height: o.height,
            byteSize: o.byteSize,
            objectKey: o.objectKey,
            deletedAt: o.deletedAt,
          })),
        };

        const dto = buildPublicResponsiveImageDto(deliveryInput, deliveryResolver);
        map.set(row.id, dto);
      } catch {
        // Skip incomplete or invalid rendition sets
      }
    }
  }

  return map;
}

function projectProductMedia(
  rawImages: RawProductImageInput[],
  productImage: string,
  managedMediaMap: Map<string, PublicResponsiveImageDto>
): {
  media: PublicProductMediaProjection;
  displayImage: string;
  displayImages: string[];
} {
  const gallery: PublicProductGalleryImage[] = [];
  const safeImageUrls: string[] = [];
  const suspendedUrls = new Set<string>();
  const suspendedMediaIds = new Set<string>();

  for (const img of rawImages) {
    if (img.sourceKind === "MANAGED") {
      const managedDto = img.managedMediaId ? managedMediaMap.get(img.managedMediaId) : undefined;
      if (managedDto) {
        gallery.push({
          kind: "managed",
          media: managedDto,
          altText: img.altText ?? "",
        });
        safeImageUrls.push(managedDto.fallbackSrc);
      } else {
        if (img.url) {
          suspendedUrls.add(img.url);
        }
        if (img.managedMediaId) {
          suspendedMediaIds.add(img.managedMediaId);
        }
      }
    } else {
      // Legacy image (LEGACY_LOCAL, LEGACY_EXTERNAL, or unclassified legacy)
      gallery.push({
        kind: "legacy",
        src: img.url,
        altText: img.altText ?? "",
      });
      safeImageUrls.push(img.url);
    }
  }

  let primarySrc: string | null = null;
  let primaryKind: "managed" | "legacy" | "fallback" | "unavailable" = "unavailable";

  if (gallery.length > 0) {
    const firstSafe = gallery[0];
    if (firstSafe.kind === "managed") {
      primaryKind = "managed";
      primarySrc = firstSafe.media.fallbackSrc;
    } else {
      primaryKind = "legacy";
      primarySrc = firstSafe.src;
    }
  } else if (rawImages.length === 0) {
    // 0 relational images: fallback to product.image if valid and non-suspended
    const isSuspended =
      suspendedUrls.has(productImage) ||
      Array.from(suspendedMediaIds).some((id) => productImage.includes(id));

    if (productImage && !isSuspended) {
      primaryKind = "fallback";
      primarySrc = productImage;
    } else {
      primaryKind = "unavailable";
      primarySrc = null;
    }
  } else {
    // Relational images were present, but all were suspended/undeliverable
    primaryKind = "unavailable";
    primarySrc = null;
  }

  // Derive legacy compatibility displayImage and displayImages
  let displayImage: string;
  if (primarySrc !== null) {
    displayImage = primarySrc;
  } else {
    const isSuspended =
      suspendedUrls.has(productImage) ||
      Array.from(suspendedMediaIds).some((id) => productImage.includes(id));
    if (productImage && !isSuspended && rawImages.length === 0) {
      displayImage = productImage;
    } else {
      displayImage = "";
    }
  }

  let displayImages: string[];
  if (safeImageUrls.length > 0) {
    displayImages = safeImageUrls;
  } else if (displayImage !== "") {
    displayImages = [displayImage];
  } else {
    displayImages = [];
  }

  return {
    media: {
      gallery,
      primarySrc,
      primaryKind,
    },
    displayImage,
    displayImages,
  };
}

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
        categoryId: true,
        subcategory: true,
        categoryRel: {
          select: {
            name: true,
          },
        },
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

  // 7. Concurrent batched media and subcategory resolution
  const productIds = products.map((p) => p.id);

  const [productImages, subcategoryMap] = await Promise.all([
    productIds.length > 0
      ? prisma.productImage.findMany({
          where: { productId: { in: productIds } },
          orderBy: [
            { productId: "asc" },
            { sortOrder: "asc" },
            { id: "asc" },
          ],
          select: {
            productId: true,
            url: true,
            sourceKind: true,
            managedMediaId: true,
            altText: true,
          },
        })
      : Promise.resolve([]),
    resolveSubcategoryBatch(products),
  ]);

  const managedIds = Array.from(
    new Set(
      productImages
        .map((img) => img.managedMediaId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );

  const managedMediaMap = await fetchPublicManagedMediaMap(managedIds);

  const groupedImages = new Map<number, RawProductImageInput[]>();
  for (const img of productImages) {
    let list = groupedImages.get(img.productId);
    if (!list) {
      list = [];
      groupedImages.set(img.productId, list);
    }
    list.push(img);
  }

  // 8. Project to PublicProductCardDTO (Decimal -> Number presentation serialization)
  const items: PublicProductCardDTO[] = products.map((p) => {
    const rawList = groupedImages.get(p.id) ?? [];
    const { media, displayImage, displayImages } = projectProductMedia(
      rawList,
      p.image,
      managedMediaMap
    );

    let subcategoryName: string | null = null;
    if (p.categoryId !== null && p.subcategory) {
      const catMap = subcategoryMap.get(p.categoryId);
      if (catMap) {
        subcategoryName =
          catMap.get(p.subcategory.trim().toLowerCase()) ?? null;
      }
    }

    return {
      id: p.id,
      name: p.name,
      price: Number(p.price),
      compareAtPrice:
        p.compareAtPrice == null ? null : Number(p.compareAtPrice),
      image: displayImage,
      images: displayImages.slice(0, 4),
      category: p.category,
      categoryName: p.categoryRel?.name ?? p.category ?? null,
      subcategoryName,
      stock: p.stock,
      isHotDeal: p.isHotDeal,
      isUpcoming: p.isUpcoming,
      badgeText: p.badgeText,
      badgeTone: p.badgeTone,
      hasVariants: (p._count?.variants ?? 0) > 0,
      media,
    };
  });

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
      categoryRel: {
        select: {
          name: true,
        },
      },
      images: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          url: true,
          sourceKind: true,
          managedMediaId: true,
          altText: true,
        },
      },
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

  const managedIds = Array.from(
    new Set(
      product.images
        .map((img) => img.managedMediaId)
        .filter((mediaId): mediaId is string => typeof mediaId === "string" && mediaId.length > 0)
    )
  );

  const [managedMediaMap, subcategoryMap] = await Promise.all([
    fetchPublicManagedMediaMap(managedIds),
    resolveSubcategoryBatch([product]),
  ]);

  const { media, displayImage, displayImages } = projectProductMedia(
    product.images,
    product.image,
    managedMediaMap
  );

  let subcategoryName: string | null = null;
  if (product.categoryId !== null && product.subcategory) {
    const catMap = subcategoryMap.get(product.categoryId);
    if (catMap) {
      subcategoryName =
        catMap.get(product.subcategory.trim().toLowerCase()) ?? null;
    }
  }

  const categoryName = product.categoryRel?.name ?? product.category ?? null;

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
    image: displayImage,
    images: displayImages.slice(0, 4),
    category: product.category,
    categoryName,
    subcategoryName,
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
    media,
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
