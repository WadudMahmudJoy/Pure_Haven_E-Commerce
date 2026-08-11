"use client";

import { useEffect, useMemo, useState } from "react";
import ProductCard from "@/components/ui/ProductCard";

type LoadMoreProductsProps = {
  products: any[];
  initialLimit?: number;
  step?: number;
  gridClassName?: string;
};

export default function LoadMoreProducts({
  products,
  initialLimit = 12,
  step = 12,
  gridClassName = "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6",
}: LoadMoreProductsProps) {
  const [visibleCount, setVisibleCount] = useState(initialLimit);

  useEffect(() => {
    setVisibleCount(initialLimit);
  }, [products, initialLimit]);

  const safeProducts = Array.isArray(products) ? products : [];

  const visibleProducts = useMemo(
    () => safeProducts.slice(0, visibleCount),
    [safeProducts, visibleCount]
  );

  const remaining = Math.max(safeProducts.length - visibleProducts.length, 0);
  const hasMore = remaining > 0;

  return (
    <div className="space-y-8">
      <div className={gridClassName}>
        {visibleProducts.map((product) => (
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
            Showing {visibleProducts.length} of {safeProducts.length} products
          </p>
          <button
            type="button"
            onClick={() =>
              setVisibleCount((current) =>
                Math.min(current + step, safeProducts.length)
              )
            }
            className="rounded-full bg-[#2d1f1a] px-8 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white shadow-sm transition hover:bg-[#8b5a45]"
          >
            Load More
          </button>
        </div>
      ) : safeProducts.length > initialLimit ? (
        <p className="text-center text-xs uppercase tracking-[0.22em] text-[#8b5a45]">
          All products loaded
        </p>
      ) : null}
    </div>
  );
}
