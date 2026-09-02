"use client";

import { useEffect, useRef, useState } from "react";
import ProductCard from "@/components/ui/ProductCard";
import type { PublicProductCardDTO, PublicSortMode } from "@/lib/catalog/types";
import {
  deduplicateProducts,
  computeRestorationTarget,
  createProgressiveQueryUrl,
  nextRequestGeneration,
  isCurrentGeneration,
} from "@/lib/catalog/progressiveCatalogState";

export type ProgressiveProductGridProps = {
  initialProducts: PublicProductCardDTO[];
  initialHasMore: boolean;
  initialTotalItems: number;
  category?: string | null;
  subcategory?: string | null;
  q?: string | null;
  sort?: PublicSortMode | string | null;
  requestedPage?: number;
  gridClassName?: string;
};

export default function ProgressiveProductGrid({
  initialProducts,
  initialHasMore,
  initialTotalItems,
  category = null,
  subcategory = null,
  q = null,
  sort = "latest",
  requestedPage = 1,
  gridClassName = "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6",
}: ProgressiveProductGridProps) {
  const [products, setProducts] = useState<PublicProductCardDTO[]>(initialProducts);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore);
  const [totalItems, setTotalItems] = useState<number>(initialTotalItems);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const requestGenRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Restoration lifecycle for requestedPage > 1 on mount
  useEffect(() => {
    if (!requestedPage || requestedPage <= 1) return;

    const restoration = computeRestorationTarget(requestedPage, 10);

    // If page requested exceeds max restoration (10), normalize browser URL to page=10
    if (restoration.shouldNormalizeUrl && typeof window !== "undefined") {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set("page", String(restoration.targetPage));
      window.history.replaceState(null, "", currentUrl.pathname + currentUrl.search);
    }

    if (restoration.targetPage <= 1) return;

    let isAborted = false;
    const currentGen = nextRequestGeneration(requestGenRef.current);
    requestGenRef.current = currentGen;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    async function restorePages() {
      setLoading(true);
      setError(null);

      try {
        for (let p = 2; p <= restoration.targetPage; p++) {
          if (isAborted || !isCurrentGeneration(requestGenRef.current, currentGen)) {
            break;
          }

          const queryUrl = createProgressiveQueryUrl({
            category,
            subcategory,
            q,
            sort,
            page: p,
          });

          const res = await fetch(queryUrl, {
            signal: controller.signal,
          });

          if (!res.ok) {
            throw new Error(`Failed to restore page ${p}`);
          }

          const data = await res.json();
          if (!data?.success || !Array.isArray(data?.items)) {
            throw new Error(`Invalid payload for page ${p}`);
          }

          if (isAborted || !isCurrentGeneration(requestGenRef.current, currentGen)) {
            break;
          }

          setProducts((prev) => deduplicateProducts(prev, data.items));
          setCurrentPage(data.page ?? p);
          setHasMore(Boolean(data.hasMore));
          setTotalItems(data.totalItems ?? initialTotalItems);

          if (!data.hasMore) {
            break;
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== "AbortError" && !isAborted) {
          setError("Some products could not be restored. Click Load More to continue.");
        }
      } finally {
        if (!isAborted && isCurrentGeneration(requestGenRef.current, currentGen)) {
          setLoading(false);
        }
      }
    }

    restorePages();

    return () => {
      isAborted = true;
      controller.abort();
    };
  }, [requestedPage, category, subcategory, q, sort, initialTotalItems]);

  async function handleLoadMore() {
    if (loading || !hasMore) return;

    const nextPage = currentPage + 1;
    const currentGen = nextRequestGeneration(requestGenRef.current);
    requestGenRef.current = currentGen;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const queryUrl = createProgressiveQueryUrl({
        category,
        subcategory,
        q,
        sort,
        page: nextPage,
      });

      const res = await fetch(queryUrl, {
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error("Failed to load more products.");
      }

      const data = await res.json();
      if (!data?.success || !Array.isArray(data?.items)) {
        throw new Error(data?.message || "Failed to load more products.");
      }

      if (!isCurrentGeneration(requestGenRef.current, currentGen)) {
        return;
      }

      setProducts((prev) => deduplicateProducts(prev, data.items));
      setCurrentPage(data.page ?? nextPage);
      setHasMore(Boolean(data.hasMore));
      if (typeof data.totalItems === "number") {
        setTotalItems(data.totalItems);
      }

      // Synchronize browser history path to /shop?...page=N without API pathname
      if (typeof window !== "undefined") {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set("page", String(data.page ?? nextPage));
        window.history.pushState(null, "", currentUrl.pathname + currentUrl.search);
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        setError("Failed to load more products. Please try again.");
      }
    } finally {
      if (isCurrentGeneration(requestGenRef.current, currentGen)) {
        setLoading(false);
      }
    }
  }

  if (products.length === 0 && !loading) {
    return (
      <div className="rounded-none border border-[#ead9d1] bg-white p-8 text-center">
        <h2 className="text-xl font-semibold text-[#2e221d]">
          No products found
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          Products will appear here when available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className={gridClassName}>
        {products.map((product) => (
          <ProductCard
            key={product.id}
            id={product.id}
            name={product.name}
            price={product.price}
            compareAtPrice={product.compareAtPrice}
            image={product.image}
            category={product.category}
            stock={product.stock}
            isHotDeal={product.isHotDeal}
            isUpcoming={product.isUpcoming}
            badgeText={product.badgeText}
            badgeTone={product.badgeTone}
          />
        ))}
      </div>

      {hasMore ? (
        <div className="flex flex-col items-center gap-3 pt-2">
          <p className="text-xs uppercase tracking-[0.22em] text-[#8b5a45]">
            Showing {products.length} of {totalItems} products
          </p>

          {error ? (
            <p className="text-xs font-medium text-red-600">{error}</p>
          ) : null}

          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loading}
            className="rounded-none bg-[#5e3d32] px-8 py-3 text-xs font-bold uppercase tracking-[0.22em] text-white transition hover:bg-[#4a3027] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load More Products"}
          </button>
        </div>
      ) : products.length > 0 ? (
        <div className="pt-2 text-center">
          <p className="text-xs uppercase tracking-[0.22em] text-[#8b5a45]">
            Showing all {products.length} products
          </p>
        </div>
      ) : null}
    </div>
  );
}
