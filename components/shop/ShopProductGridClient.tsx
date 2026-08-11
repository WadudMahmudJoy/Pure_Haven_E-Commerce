"use client";

import { useState } from "react";
import ProductCard from "@/components/ui/ProductCard";
import type { Product } from "@/lib/getProducts";

type Props = {
  initialProducts: Product[];
  category?: string;
  subcategory?: string;
  initialHasMore: boolean;
};

export default function ShopProductGridClient({
  initialProducts,
  category = "",
  subcategory = "",
  initialHasMore,
}: Props) {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    setLoading(true);

    const nextPage = page + 1;
    const params = new URLSearchParams({
      page: String(nextPage),
      limit: "40",
    });

    if (category) params.set("category", category);
    if (subcategory) params.set("subcategory", subcategory);

    const res = await fetch(`/api/products?${params.toString()}`);
    const data = await res.json();

    setProducts((prev) => [...prev, ...(data.products || [])]);
    setHasMore(Boolean(data.hasMore));
    setPage(nextPage);
    setLoading(false);
  }

  if (products.length === 0) {
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
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6">
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
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="rounded-none bg-[#2e221d] px-7 py-3 text-sm font-semibold text-white transition hover:bg-[#7a5244] disabled:opacity-60"
          >
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      ) : null}
    </>
  );
}