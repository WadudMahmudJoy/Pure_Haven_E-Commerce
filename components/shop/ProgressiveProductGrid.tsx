"use client";

import { useEffect, useRef, useState } from "react";
import ProductCard from "@/components/ui/ProductCard";
import type { PublicProductCardDTO, PublicSortMode } from "@/lib/catalog/types";
import {
  computeRestorationTarget,
  createProgressiveQueryUrl,
  nextRequestGeneration,
  isCurrentGeneration,
} from "@/lib/catalog/progressiveCatalogState";
import {
  createProgressiveQueryIdentity,
  createShopHistoryUrl,
  createInitialProgressiveGridState,
  applyProgressivePageSuccess,
  applyProgressivePageFailure,
  type ProgressiveGridState,
} from "./progressiveProductGridState";

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
  const currentIdentity = createProgressiveQueryIdentity({
    category,
    subcategory,
    q,
    sort,
  });

  const [gridState, setGridState] = useState<ProgressiveGridState>(() =>
    createInitialProgressiveGridState({
      initialProducts,
      initialHasMore,
      initialTotalItems,
    })
  );

  const identityRef = useRef<string>(currentIdentity);
  const requestGenRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Effect A: Explicit query-identity lifecycle transition
  useEffect(() => {
    if (identityRef.current !== currentIdentity) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      requestGenRef.current = nextRequestGeneration(requestGenRef.current);
      identityRef.current = currentIdentity;

      setGridState(
        createInitialProgressiveGridState({
          initialProducts,
          initialHasMore,
          initialTotalItems,
        })
      );
    }
  }, [currentIdentity, initialProducts, initialHasMore, initialTotalItems]);

  // Effect B: Component unmount cleanup
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      requestGenRef.current = nextRequestGeneration(requestGenRef.current);
    };
  }, []);

  // Effect C: Truthful restoration lifecycle for requestedPage > 1
  useEffect(() => {
    if (!requestedPage || requestedPage <= 1) return;

    const restoration = computeRestorationTarget(requestedPage, 10);
    if (restoration.targetPage <= 1) return;

    let isAborted = false;
    const currentGen = nextRequestGeneration(requestGenRef.current);
    requestGenRef.current = currentGen;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Canonicalize customer URL to truthful Page 1 BEFORE requesting Page 2
    if (typeof window !== "undefined") {
      const page1Url = createShopHistoryUrl({
        category,
        subcategory,
        q,
        sort,
        page: 1,
      });
      window.history.replaceState(null, "", page1Url);
    }

    async function restorePages() {
      setGridState((prev) => ({ ...prev, loading: true, error: null }));

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

          const resolvedPage = data.page ?? p;
          setGridState((prev) =>
            applyProgressivePageSuccess(
              prev,
              data.items,
              resolvedPage,
              Boolean(data.hasMore),
              data.totalItems
            )
          );

          // Truthful restoration history update using replaceState
          if (typeof window !== "undefined") {
            const nextHistoryUrl = createShopHistoryUrl({
              category,
              subcategory,
              q,
              sort,
              page: resolvedPage,
            });
            window.history.replaceState(null, "", nextHistoryUrl);
          }

          if (!data.hasMore) {
            break;
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== "AbortError" && !isAborted) {
          if (isCurrentGeneration(requestGenRef.current, currentGen)) {
            setGridState((prev) =>
              applyProgressivePageFailure(
                prev,
                "Some products could not be restored. Click Load More to continue."
              )
            );
          }
        }
      } finally {
        if (!isAborted && isCurrentGeneration(requestGenRef.current, currentGen)) {
          setGridState((prev) => ({ ...prev, loading: false }));
        }
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }

    restorePages();

    return () => {
      isAborted = true;
      controller.abort();
    };
  }, [currentIdentity, requestedPage, category, subcategory, q, sort]);

  async function handleLoadMore() {
    if (gridState.loading || !gridState.hasMore) return;

    const nextPage = gridState.currentPage + 1;
    const currentGen = nextRequestGeneration(requestGenRef.current);
    requestGenRef.current = currentGen;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setGridState((prev) => ({ ...prev, loading: true, error: null }));

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

      const resolvedPage = data.page ?? nextPage;
      setGridState((prev) =>
        applyProgressivePageSuccess(
          prev,
          data.items,
          resolvedPage,
          Boolean(data.hasMore),
          data.totalItems
        )
      );

      // Synchronize customer-visible browser history path using pushState
      if (typeof window !== "undefined") {
        const nextHistoryUrl = createShopHistoryUrl({
          category,
          subcategory,
          q,
          sort,
          page: resolvedPage,
        });
        window.history.pushState(null, "", nextHistoryUrl);
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        if (isCurrentGeneration(requestGenRef.current, currentGen)) {
          setGridState((prev) =>
            applyProgressivePageFailure(
              prev,
              "Failed to load more products. Please try again."
            )
          );
        }
      }
    } finally {
      if (isCurrentGeneration(requestGenRef.current, currentGen)) {
        setGridState((prev) => ({ ...prev, loading: false }));
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }

  const { products, hasMore, totalItems, loading, error } = gridState;

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
            images={product.images}
            category={product.category}
            categoryName={product.categoryName}
            subcategoryName={product.subcategoryName}
            stock={product.stock}
            isHotDeal={product.isHotDeal}
            isUpcoming={product.isUpcoming}
            badgeText={product.badgeText}
            badgeTone={product.badgeTone}
            media={product.media}
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
