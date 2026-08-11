import Link from "next/link";
import { ChevronRight } from "lucide-react";
import ProductCard from "@/components/ui/ProductCard";
import type { Product } from "@/lib/getProducts";

type ProductSectionProps = {
  title?: string;
  subtitle?: string;
  products?: Product[];
  viewAllHref?: string;
};

export default function ProductSection({
  title = "Featured Products",
  subtitle = "Discover some of our selected products.",
  products = [],
  viewAllHref = "/shop",
}: ProductSectionProps) {
  return (
    <section className="container-ph section-gap">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold text-[#2e221d] sm:text-3xl">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 hidden text-sm text-neutral-600 sm:block">
              {subtitle}
            </p>
          ) : null}
        </div>

        <Link
          href={viewAllHref}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold uppercase tracking-[0.12em] text-[#f4a024] transition hover:text-[#d98912]"
        >
          <span>View All</span>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="rounded-[20px] border border-[#ead9d1] bg-white p-6 text-center">
          <h3 className="text-xl font-semibold text-[#2e221d]">
            No products available yet
          </h3>
          <p className="mt-2 text-sm text-neutral-600">
            Products will appear here when available.
          </p>
        </div>
      ) : (
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
      )}
    </section>
  );
}