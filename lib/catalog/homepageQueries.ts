/**
 * Phase 5 Task 7 — Homepage Bounded Catalog Reads
 *
 * Provides compile-safe stubs that become production implementations
 * after the behavioral RED test cycle.
 *
 * INVARIANTS:
 *   - getHomepagePromos()         → max 1 New Arrivals product + max 1 Hot Deal product
 *   - getRepresentativeSubcategoryImages() → ONE batched relational query (no N+1)
 *   - No full product table materialization
 *   - No variants, no descriptions, no unbounded findMany
 */

import { prisma } from "@/lib/prisma";

/**
 * Minimal homepage promo projection required by HomePromoGrid.
 * Only fields actually used by the component are included.
 */
export type HomepagePromoProduct = {
  id: number;
  name: string;
  image: string;
  createdAt: string; // ISO string — safe across Server → Client boundary
};

export type HomepagePromos = {
  newestProduct: HomepagePromoProduct | null;
  hotDealProduct: HomepagePromoProduct | null;
};

/**
 * Returns bounded homepage promo data using exactly two concurrent queries:
 *   1. findMany({ take: 1 }) ordered by createdAt DESC, id DESC → newestProduct
 *   2. findFirst() where isHotDeal=true ordered by id DESC   → hotDealProduct
 *
 * Active + non-deleted only. Does not load variants or description.
 */
export async function getHomepagePromos(): Promise<HomepagePromos> {
  const [newArrivals, hotDeal] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 1,
      select: {
        id: true,
        name: true,
        image: true,
        createdAt: true,
      },
    }),

    prisma.product.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        isHotDeal: true,
      },
      orderBy: [{ id: "desc" }],
      select: {
        id: true,
        name: true,
        image: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    newestProduct: newArrivals[0]
      ? {
          ...newArrivals[0],
          createdAt: newArrivals[0].createdAt.toISOString(),
        }
      : null,
    hotDealProduct: hotDeal
      ? {
          ...hotDeal,
          createdAt: hotDeal.createdAt.toISOString(),
        }
      : null,
  };
}

/**
 * Returns a map of canonical subcategory image URLs using ONE batched
 * relational PostgreSQL query.
 *
 * Map key format: `${categorySlug.toLowerCase()}:${subcategorySlug.toLowerCase()}`
 * Map value: representative product image URL for that subcategory
 *
 * The canonical map key comes from Subcategory.slug (relational authority),
 * NOT from Product.subcategory text.
 *
 * Dual-format compatibility: Product.subcategory may store either
 * Subcategory.slug or Subcategory.name — both are matched via:
 *   lower(p."subcategory") = lower(s."slug") OR lower(p."subcategory") = lower(s."name")
 *
 * Uses DISTINCT ON (categorySlug, subcategorySlug) ORDER BY id DESC
 * to select the most-recently-created product image per subcategory.
 *
 * Excludes: inactive products, soft-deleted products, inactive categories,
 * inactive subcategories, null/empty images.
 */
export async function getRepresentativeSubcategoryImages(): Promise<
  Record<string, string>
> {
  type RawRow = {
    categorySlug: string;
    subcategorySlug: string;
    image: string;
  };

  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT DISTINCT ON (c."slug", s."slug")
      c."slug" AS "categorySlug",
      s."slug" AS "subcategorySlug",
      p."image"
    FROM "Product" p
    JOIN "Category" c
      ON p."categoryId" = c."id"
    JOIN "Subcategory" s
      ON s."categoryId" = c."id"
     AND s."isActive" = true
     AND (
       lower(p."subcategory") = lower(s."slug")
       OR lower(p."subcategory") = lower(s."name")
     )
    WHERE p."isActive" = true
      AND p."deletedAt" IS NULL
      AND c."isActive" = true
      AND p."image" IS NOT NULL
      AND p."image" <> ''
    ORDER BY
      c."slug",
      s."slug",
      p."id" DESC
  `;

  const map: Record<string, string> = {};

  for (const row of rows) {
    map[
      `${row.categorySlug.toLowerCase()}:${row.subcategorySlug.toLowerCase()}`
    ] = row.image;
  }

  return map;
}
