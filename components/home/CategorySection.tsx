"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getDefaultPublicCategories,
  type PublicCategory,
  type PublicSubcategory,
} from "@/lib/defaultCategories";
import SafeImage from "@/components/ui/SafeImage";
import { fallbackImageForCategory, normalizeImageSrc } from "@/lib/imagePaths";

type Subcategory = PublicSubcategory;
type Category = PublicCategory;

/** Minimal product shape used only for subcategory fallback thumbnail resolution in self-fetch path. */
type SubcategoryThumbnailProduct = {
  id: number;
  image: string;
  category: string;
  subcategory?: string | null;
};

type BannerItem = {
  id: number | string;
  title: string;
  subtitle: string;
  href: string;
  image: string;
};

const defaultFallback = "/images/categories/cosmetics.jpg";

function slug(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function categoryImage(category: Category) {
  return normalizeImageSrc(
    category.image || fallbackImageForCategory(category.slug),
    {
      category: category.slug,
      fallbackSrc: defaultFallback,
    }
  );
}

/**
 * Resolve subcategory image:
 *   1. Prefer subcategoryImageMap[`${catSlug}:${subSlug}`] (server-supplied, batched)
 *   2. Fallback to in-memory product scan (self-fetch path only)
 *   3. Category.image
 *   4. Static fallback
 */
function resolveSubcategoryImage(
  category: Category,
  subcategory: Subcategory,
  subcategoryImageMap: Record<string, string>,
  products: SubcategoryThumbnailProduct[]
): string {
  // 1. Server-supplied batched map (homepage path — no product iteration)
  const mapKey = `${category.slug.toLowerCase()}:${subcategory.slug.toLowerCase()}`;
  if (subcategoryImageMap[mapKey]) {
    return normalizeImageSrc(subcategoryImageMap[mapKey], {
      category: category.slug,
      fallbackSrc: defaultFallback,
    });
  }

  // 2. In-memory product scan (self-fetch fallback path for non-homepage callers)
  const product = products.find(
    (p) =>
      slug(p.category) === category.slug &&
      slug(p.subcategory) === subcategory.slug &&
      p.image
  );

  return normalizeImageSrc(
    product?.image || category.image || fallbackImageForCategory(category.slug),
    {
      category: category.slug,
      fallbackSrc: defaultFallback,
    }
  );
}

function normalizeCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item: any) => {
      if (!item || typeof item !== "object") return null;

      const id = item.id;
      const name = typeof item.name === "string" ? item.name : "";
      const categorySlug = typeof item.slug === "string" ? item.slug : "";

      if (!name || !categorySlug) return null;

      const subcategories = Array.isArray(item.subcategories)
        ? item.subcategories
            .map((sub: any) => {
              if (!sub || typeof sub !== "object") return null;

              const subName =
                typeof sub.name === "string" ? sub.name : "";
              const subSlug =
                typeof sub.slug === "string" ? sub.slug : "";

              if (!subName || !subSlug) return null;

              return {
                id: sub.id,
                name: subName,
                slug: subSlug,
                isActive: sub.isActive,
                sortOrder: sub.sortOrder,
              } satisfies Subcategory;
            })
            .filter(Boolean)
        : [];

      return {
        id,
        name,
        slug: categorySlug,
        image: item.image ?? null,
        isActive: item.isActive,
        sortOrder: item.sortOrder,
        subcategories,
      } satisfies Category;
    })
    .filter(Boolean) as Category[];
}

function normalizeProducts(value: unknown): SubcategoryThumbnailProduct[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item: any) => {
      if (!item || typeof item !== "object") return null;

      const id = Number(item.id);
      const image = typeof item.image === "string" ? item.image : "";
      const category =
        typeof item.category === "string" ? item.category : "";
      const subcategory =
        typeof item.subcategory === "string" ? item.subcategory : null;

      if (!Number.isFinite(id) || !category) return null;

      return { id, image, category, subcategory } satisfies SubcategoryThumbnailProduct;
    })
    .filter(Boolean) as SubcategoryThumbnailProduct[];
}

function MarqueeStyle() {
  return null;
}

function BannerRow({
  title,
  eyebrow,
  viewAllHref,
  items,
}: {
  title: string;
  eyebrow?: string;
  viewAllHref: string;
  items: BannerItem[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          {eyebrow ? (
            <p className="text-sm uppercase tracking-[0.26em] text-[#8b5e4c]">
              {eyebrow}
            </p>
          ) : null}

          <h2 className="mt-1 text-2xl font-semibold text-[#2e221d] md:text-3xl">
            {title}
          </h2>
        </div>

        <Link
          href={viewAllHref}
          className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b5e4c] hover:text-[#2e221d]"
        >
          View All
        </Link>
      </div>

      <div className="overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-3 sm:gap-4">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="group relative overflow-hidden rounded-[22px] h-[245px] w-[165px] shrink-0 overflow-hidden rounded-none border border-[#e7d7cf] bg-white sm:h-[300px] sm:w-[210px] lg:h-[340px] lg:w-[250px]"
            >
              <SafeImage
                src={item.image}
                alt={item.title}
                fallbackSrc={defaultFallback}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />

              <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/25 to-black/5" />

              <div className="absolute bottom-3 left-3 right-3 text-white sm:bottom-4">
                <p className="text-[9px] uppercase tracking-[0.16em] text-white/85 sm:text-[11px] sm:tracking-[0.22em]">
                  {item.subtitle}
                </p>
                <h3 className="mt-1 text-base font-semibold leading-tight sm:text-lg md:text-xl">
                  {item.title}
                </h3>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

type CategorySectionProps = {
  initialCategories?: Category[];
  /**
   * Server-supplied batched subcategory image map (homepage path).
   * Key: `${categorySlug}:${subcategorySlug}` (lowercase).
   * Value: representative product image URL.
   *
   * When provided (homepage with disableSelfFetch=true), no product DB reads occur.
   * When absent (other call sites with !disableSelfFetch), falls back to bounded
   * per-page API self-fetch and in-memory resolution.
   */
  subcategoryImageMap?: Record<string, string>;
  disableSelfFetch?: boolean;
};

export default function CategorySection({
  initialCategories,
  subcategoryImageMap: initialSubcategoryImageMap,
  disableSelfFetch = false,
}: CategorySectionProps = {}) {
  const [categories, setCategories] = useState<Category[]>(() =>
    initialCategories && initialCategories.length > 0
      ? initialCategories
      : getDefaultPublicCategories()
  );
  const [subcategoryImageMap, setSubcategoryImageMap] = useState<
    Record<string, string>
  >(() => initialSubcategoryImageMap ?? {});
  // Bounded product list used only by the self-fetch fallback path for subcategory thumbnails.
  const [products, setProducts] = useState<SubcategoryThumbnailProduct[]>([]);

  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories);
    }
  }, [initialCategories]);

  useEffect(() => {
    if (initialSubcategoryImageMap) {
      setSubcategoryImageMap(initialSubcategoryImageMap);
    }
  }, [initialSubcategoryImageMap]);

  useEffect(() => {
    if (disableSelfFetch) return;

    let alive = true;

    async function loadData() {
      const categoryRequest = fetch("/api/categories", {
        cache: "no-store",
      })
        .then(async (res) => ({
          ok: res.ok,
          data: await res.json().catch(() => null),
        }))
        .catch(() => null);

      // Bounded product fetch for subcategory thumbnail fallback resolution.
      // Uses the standard paginated envelope (data.items) — page 1 only.
      const productRequest = fetch("/api/products?pageSize=24", {
        cache: "no-store",
      })
        .then(async (res) => ({
          ok: res.ok,
          data: await res.json().catch(() => null),
        }))
        .catch(() => null);

      const [categoryPayload, productPayload] = await Promise.all([
        categoryRequest,
        productRequest,
      ]);

      if (!alive) return;

      if (
        categoryPayload?.ok &&
        categoryPayload.data?.success &&
        Array.isArray(categoryPayload.data.categories)
      ) {
        const nextCategories = normalizeCategories(
          categoryPayload.data.categories
        );

        if (nextCategories.length > 0) {
          setCategories(nextCategories);
        }
      }

      // Consume paginated envelope (data.items — no legacy .products fallback)
      const productList = productPayload?.data?.items;
      if (
        productPayload?.ok &&
        productPayload.data?.success &&
        Array.isArray(productList)
      ) {
        setProducts(normalizeProducts(productList));
      }
    }

    loadData();

    return () => {
      alive = false;
    };
  }, [disableSelfFetch]);

  const visibleCategories = useMemo(
    () => categories.filter((category) => category.slug !== "essentials"),
    [categories]
  );

  const categoryItems: BannerItem[] = visibleCategories.map((category) => ({
    id: category.id,
    title: category.name,
    subtitle: "Collection",
    href: `/shop?category=${category.slug}`,
    // Parent category thumbnail uses Category.image (no product query needed)
    image: categoryImage(category),
  }));

  if (visibleCategories.length === 0) return null;

  return (
    <section className="ph-category-section py-6 md:py-8">
      <MarqueeStyle />

      <div className="container-ph space-y-6">
        <BannerRow
          title="Shop by Category"
          viewAllHref="/shop"
          items={categoryItems}
        />

        {visibleCategories
          .filter((category) => category.subcategories.length > 0)
          .map((category) => {
            const subcategoryItems: BannerItem[] =
              category.subcategories.map((subcategory) => ({
                id: subcategory.id,
                title: subcategory.name,
                subtitle: "Subcategory",
                href: `/shop?category=${category.slug}&subcategory=${subcategory.slug}`,
                // Homepage: resolved from batched subcategoryImageMap (zero per-subcategory queries)
                // Other callers: falls back to bounded product list from self-fetch
                image: resolveSubcategoryImage(
                  category,
                  subcategory,
                  subcategoryImageMap,
                  products
                ),
              }));

            return (
              <BannerRow
                key={category.id}
                eyebrow={`Shop ${category.name}`}
                title={category.name}
                viewAllHref={`/shop?category=${category.slug}`}
                items={subcategoryItems}
              />
            );
          })}
      </div>
    </section>
  );
}
