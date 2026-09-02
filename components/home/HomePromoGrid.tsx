"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SafeImage from "@/components/ui/SafeImage";

type Product = {
  id: number;
  name: string;
  image: string;
  isHotDeal?: boolean;
  createdAt?: string;
};

type HomePromo = {
  id: string;
  label: string;
  title: string;
  image: string;
  href: string;
  isActive: boolean;
  sortOrder: number;
};

const fallbackWide: HomePromo = {
  id: "fallback-wide",
  label: "Explore Now",
  title: "Top Picks",
  image: "/images/categories/cosmetics.jpg",
  href: "/shop",
  isActive: true,
  sortOrder: 1,
};

function newestFirst(a: Product, b: Product) {
  const at = a.createdAt ? new Date(a.createdAt).getTime() : a.id;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : b.id;
  return bt - at;
}

function PromoTile({
  href,
  image,
  title,
  label,
  wide = false,
}: {
  href: string;
  image: string;
  title: string;
  label: string;
  wide?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group relative block overflow-hidden rounded-[18px] bg-[#2e221d] shadow-sm ${
        wide ? "h-[155px] sm:h-[220px] md:h-[280px]" : "aspect-square"
      }`}
    >
      <SafeImage
        src={image}
        alt={title}
        fallbackSrc="/images/categories/cosmetics.jpg"
        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
        width={1400}
        height={700}
        sizes="(max-width: 768px) 100vw, 50vw"
        quality={76}
      />

      <div className="absolute inset-0 bg-black/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />

      <div
        className={
          wide
            ? "absolute inset-0 flex items-center justify-center text-center text-white"
            : "absolute inset-x-2 bottom-4 text-center text-white"
        }
      >
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/80 sm:text-xs">
            {label}
          </div>

          <div
            className={
              wide
                ? "mt-2 text-[34px] font-black uppercase leading-none tracking-tight sm:text-6xl md:text-7xl"
                : "mt-1 text-[20px] font-black leading-tight sm:text-3xl"
            }
          >
            {title}
          </div>
        </div>
      </div>
    </Link>
  );
}

type HomePromoGridProps = {
  initialProducts?: Product[];
  initialWide?: HomePromo | null;
  disableSelfFetch?: boolean;
};

export default function HomePromoGrid({
  initialProducts,
  initialWide,
  disableSelfFetch = false,
}: HomePromoGridProps = {}) {
  const [products, setProducts] = useState<Product[]>(() => initialProducts ?? []);
  const [wide, setWide] = useState<HomePromo>(() => initialWide ?? fallbackWide);

  useEffect(() => {
    if (initialProducts) {
      setProducts(initialProducts);
    }
  }, [initialProducts]);

  useEffect(() => {
    if (initialWide) {
      setWide(initialWide);
    }
  }, [initialWide]);

  useEffect(() => {
    if (disableSelfFetch) return;

    async function loadData() {
      try {
        const [productRes, wideRes] = await Promise.all([
          fetch("/api/products", { cache: "no-store" }),
          fetch("/api/home-promos?kind=wide", { cache: "no-store" }),
        ]);

        const productData = await productRes.json();
        const wideData = await wideRes.json();

        const productList = productData?.items || productData?.products;
        if (productRes.ok && productData?.success && Array.isArray(productList)) {
          setProducts(productList);
        }

        if (wideRes.ok && wideData?.success && Array.isArray(wideData.items)) {
          const activeWide = wideData.items
            .filter((item: HomePromo) => item.isActive)
            .sort((a: HomePromo, b: HomePromo) => a.sortOrder - b.sortOrder);

          if (activeWide[0]) setWide(activeWide[0]);
        }
      } catch {}
    }

    loadData();
  }, [disableSelfFetch]);

  const newestProduct = useMemo(() => {
    return [...products].sort(newestFirst)[0] || null;
  }, [products]);

  const hotDealProduct = useMemo(() => {
    return products.find((product) => product.isHotDeal === true) || null;
  }, [products]);

  return (
    <section className="bg-[#fcf8f6] px-3 py-4 sm:px-4 md:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PromoTile
          wide
          href={wide.href || "/shop"}
          image={wide.image || "/images/categories/cosmetics.jpg"}
          label={wide.label || "Explore Now"}
          title={wide.title || "Top Picks"}
        />

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <PromoTile
            href="/shop"
            image={newestProduct?.image || "/images/categories/skincare.jpg"}
            label={newestProduct?.name || "Fresh Just In"}
            title="New Arrivals"
          />

          <PromoTile
            href="/shop"
            image={hotDealProduct?.image || "/images/categories/haircare.jpg"}
            label={hotDealProduct?.name || "Special Offers"}
            title="Hot Deals"
          />
        </div>
      </div>
    </section>
  );
}