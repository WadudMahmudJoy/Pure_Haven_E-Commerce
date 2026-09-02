import type { PublicProductCardDTO } from "@/lib/catalog/types";
import { deduplicateProducts } from "@/lib/catalog/progressiveCatalogState";

export type ProgressiveGridState = {
  products: PublicProductCardDTO[];
  currentPage: number;
  hasMore: boolean;
  totalItems: number;
  loading: boolean;
  error: string | null;
};

export function createProgressiveQueryIdentity(params: {
  category?: string | null;
  subcategory?: string | null;
  q?: string | null;
  sort?: string | null;
}): string {
  return JSON.stringify([
    params.category ?? null,
    params.subcategory ?? null,
    params.q ?? "",
    params.sort ?? "latest",
  ]);
}

export function createShopHistoryUrl(options: {
  category?: string | null;
  subcategory?: string | null;
  q?: string | null;
  sort?: string | null;
  page?: number;
}): string {
  const params = new URLSearchParams();

  if (options.category && options.category.trim() !== "") {
    params.set("category", options.category.trim().toLowerCase());
  }

  if (options.subcategory && options.subcategory.trim() !== "") {
    params.set("subcategory", options.subcategory.trim().toLowerCase());
  }

  if (options.q && options.q.trim() !== "") {
    params.set("q", options.q.trim());
  }

  if (
    options.sort &&
    options.sort.trim() !== "" &&
    options.sort.trim().toLowerCase() !== "latest"
  ) {
    params.set("sort", options.sort.trim().toLowerCase());
  }

  if (options.page && options.page > 1) {
    params.set("page", String(options.page));
  }

  const qs = params.toString();
  return qs ? `/shop?${qs}` : "/shop";
}

export function createInitialProgressiveGridState(params: {
  initialProducts: PublicProductCardDTO[];
  initialHasMore: boolean;
  initialTotalItems: number;
}): ProgressiveGridState {
  return {
    products: params.initialProducts,
    currentPage: 1,
    hasMore: params.initialHasMore,
    totalItems: params.initialTotalItems,
    loading: false,
    error: null,
  };
}

export function applyProgressivePageSuccess(
  current: ProgressiveGridState,
  incomingItems: PublicProductCardDTO[],
  incomingPage: number,
  incomingHasMore: boolean,
  incomingTotalItems?: number
): ProgressiveGridState {
  return {
    products: deduplicateProducts(current.products, incomingItems),
    currentPage: incomingPage,
    hasMore: incomingHasMore,
    totalItems: incomingTotalItems ?? current.totalItems,
    loading: false,
    error: null,
  };
}

export function applyProgressivePageFailure(
  current: ProgressiveGridState,
  errorMessage: string
): ProgressiveGridState {
  return {
    ...current,
    loading: false,
    error: errorMessage,
  };
}
