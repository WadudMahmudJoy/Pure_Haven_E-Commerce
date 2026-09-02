import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Resolves legacy Product.subcategory tokens into authoritative active Subcategory.name
 * in a single bounded batch query without N+1 loops.
 *
 * Scopes & Guarantees:
 *   - Only candidate items with categoryId !== null and non-empty subcategory tokens.
 *   - Deduplicates (categoryId, token.toLowerCase()) pairs in memory before query.
 *   - Enforces hard public catalog maximum of 48 candidates before query execution.
 *   - Short-circuits with empty Map if candidate list is empty (zero DB queries).
 *   - Executes at most 1 Prisma query with category-scoped OR conditions and isActive: true.
 *   - Deterministic query ordering: orderBy: [{ categoryId: "asc" }, { id: "asc" }].
 *   - Explicit slug-first resolution precedence: case-insensitive slug match wins over name match.
 *   - Returns Map<categoryId, Map<lowercaseRequestedToken, authoritativeName>>.
 */
export async function resolveSubcategoryBatch(
  items: Array<{
    categoryId: number | null;
    subcategory: string | null;
  }>
): Promise<Map<number, Map<string, string>>> {
  const candidatePairs: Array<{ categoryId: number; token: string }> = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (item.categoryId === null || item.categoryId === undefined) {
      continue;
    }
    if (typeof item.subcategory !== "string") {
      continue;
    }
    const trimmed = item.subcategory.trim();
    if (!trimmed) {
      continue;
    }
    const lowerToken = trimmed.toLowerCase();
    const dedupKey = `${item.categoryId}:${lowerToken}`;
    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      candidatePairs.push({
        categoryId: item.categoryId,
        token: trimmed,
      });
    }
  }

  // Enforce hard public catalog candidate limit before any query execution
  if (candidatePairs.length > 48) {
    throw new RangeError(
      "Subcategory resolution batch exceeds public catalog maximum of 48 candidates."
    );
  }

  const resultMap = new Map<number, Map<string, string>>();

  if (candidatePairs.length === 0) {
    return resultMap;
  }

  // Construct bounded category-scoped OR conditions
  const conditions: Prisma.SubcategoryWhereInput[] = candidatePairs.map((pair) => ({
    categoryId: pair.categoryId,
    isActive: true,
    OR: [
      { slug: { equals: pair.token, mode: "insensitive" } },
      { name: { equals: pair.token, mode: "insensitive" } },
    ],
  }));

  const subcategories = await prisma.subcategory.findMany({
    where: {
      OR: conditions,
    },
    orderBy: [
      { categoryId: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      categoryId: true,
      name: true,
      slug: true,
    },
  });

  // Build deterministic per-category slug and name lookup tables
  // preserving the first deterministic match on case collision
  const categorySlugMaps = new Map<number, Map<string, string>>();
  const categoryNameMaps = new Map<number, Map<string, string>>();

  for (const sub of subcategories) {
    let slugMap = categorySlugMaps.get(sub.categoryId);
    if (!slugMap) {
      slugMap = new Map<string, string>();
      categorySlugMaps.set(sub.categoryId, slugMap);
    }
    const lowerSlug = sub.slug.toLowerCase();
    if (!slugMap.has(lowerSlug)) {
      slugMap.set(lowerSlug, sub.name);
    }

    let nameMap = categoryNameMaps.get(sub.categoryId);
    if (!nameMap) {
      nameMap = new Map<string, string>();
      categoryNameMaps.set(sub.categoryId, nameMap);
    }
    const lowerName = sub.name.toLowerCase();
    if (!nameMap.has(lowerName)) {
      nameMap.set(lowerName, sub.name);
    }
  }

  // Resolve each requested candidate token: slug match takes strict precedence over name match
  for (const pair of candidatePairs) {
    const lowerToken = pair.token.toLowerCase();
    const catSlugs = categorySlugMaps.get(pair.categoryId);
    const catNames = categoryNameMaps.get(pair.categoryId);

    const resolved = catSlugs?.get(lowerToken) ?? catNames?.get(lowerToken);
    if (resolved) {
      let resCatMap = resultMap.get(pair.categoryId);
      if (!resCatMap) {
        resCatMap = new Map<string, string>();
        resultMap.set(pair.categoryId, resCatMap);
      }
      resCatMap.set(lowerToken, resolved);
    }
  }

  return resultMap;
}
