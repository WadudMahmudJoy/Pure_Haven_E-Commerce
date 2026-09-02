import type { PublicProductCardDTO, PublicSortMode } from "./types";

export type ProgressiveRequestGeneration = number;

export function nextRequestGeneration(current: number): number {
  return current + 1;
}

export function isCurrentGeneration(
  responseGeneration: number,
  currentGeneration: number
): boolean {
  return responseGeneration === currentGeneration;
}

export function deduplicateProducts(
  existing: PublicProductCardDTO[],
  incoming: PublicProductCardDTO[]
): PublicProductCardDTO[] {
  const seenIds = new Set<number>(existing.map((p) => p.id));
  const result = [...existing];

  for (const item of incoming) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      result.push(item);
    }
  }

  return result;
}

export type RestorationTarget = {
  targetPage: number;
  shouldNormalizeUrl: boolean;
};

export function computeRestorationTarget(
  requestedPage: number,
  maxRestore: number = 10
): RestorationTarget {
  if (requestedPage <= maxRestore) {
    return {
      targetPage: requestedPage,
      shouldNormalizeUrl: false,
    };
  }

  return {
    targetPage: maxRestore,
    shouldNormalizeUrl: true,
  };
}

export type ProgressiveQueryUrlOptions = {
  category?: string | null;
  subcategory?: string | null;
  q?: string | null;
  sort?: PublicSortMode | string | null;
  page?: number;
};

export function createProgressiveQueryUrl(
  options: ProgressiveQueryUrlOptions
): string {
  const params = new URLSearchParams();

  params.set("view", "public");
  params.set("pageSize", "24");

  if (options.category && options.category.trim() !== "") {
    params.set("category", options.category.trim().toLowerCase());
  }

  if (options.subcategory && options.subcategory.trim() !== "") {
    params.set("subcategory", options.subcategory.trim().toLowerCase());
  }

  if (options.q && options.q.trim() !== "") {
    params.set("q", options.q.trim());
  }

  if (options.sort && options.sort.trim() !== "") {
    params.set("sort", options.sort.trim().toLowerCase());
  }

  if (options.page !== undefined && options.page !== null && options.page > 0) {
    params.set("page", String(options.page));
  }

  return `/api/products?${params.toString()}`;
}
