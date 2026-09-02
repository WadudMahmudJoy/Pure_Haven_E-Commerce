"use client";

import ProgressiveProductGrid from "@/components/shop/ProgressiveProductGrid";
import type { PublicProductCardDTO, PublicSortMode } from "@/lib/catalog/types";

type LoadMoreProductsProps = {
  products: PublicProductCardDTO[];
  hasMore?: boolean;
  totalItems?: number;
  category?: string | null;
  subcategory?: string | null;
  q?: string | null;
  sort?: PublicSortMode | string | null;
  requestedPage?: number;
  gridClassName?: string;
  initialLimit?: number;
  step?: number;
};

export default function LoadMoreProducts({
  products,
  hasMore = false,
  totalItems,
  category = null,
  subcategory = null,
  q = null,
  sort = "latest",
  requestedPage = 1,
  gridClassName = "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6",
}: LoadMoreProductsProps) {
  const safeProducts = Array.isArray(products) ? products : [];
  const safeTotal = typeof totalItems === "number" ? totalItems : safeProducts.length;

  return (
    <ProgressiveProductGrid
      initialProducts={safeProducts}
      initialHasMore={hasMore}
      initialTotalItems={safeTotal}
      category={category}
      subcategory={subcategory}
      q={q}
      sort={sort}
      requestedPage={requestedPage}
      gridClassName={gridClassName}
    />
  );
}
