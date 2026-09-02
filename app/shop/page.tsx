import Link from "next/link";
import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import ProgressiveProductGrid from "@/components/shop/ProgressiveProductGrid";
import SafeImage from "@/components/ui/SafeImage";
import { getCachedCategoryRows } from "@/lib/catalogRead";
import { parsePublicCatalogParams } from "@/lib/catalog/queryParams";
import { getPublicCatalogQuery } from "@/lib/catalog/publicCatalogQuery";
import type { ParsedPublicCatalogParams } from "@/lib/catalog/types";

export const revalidate = 60;

type ShopPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type ShopCategory = {
  id: number;
  name: string;
  slug: string;
  image?: string | null;
  subcategories: {
    id: number;
    name: string;
    slug: string;
  }[];
};

function shopHref(options: {
  category?: string | null;
  subcategory?: string | null;
  q?: string | null;
  sort?: string | null;
}) {
  const params = new URLSearchParams();

  if (options.category) params.set("category", options.category);
  if (options.subcategory) params.set("subcategory", options.subcategory);
  if (options.q) params.set("q", options.q);
  if (options.sort && options.sort !== "latest") params.set("sort", options.sort);

  const query = params.toString();
  return query ? `/shop?${query}` : "/shop";
}

async function getShopCategories(): Promise<ShopCategory[]> {
  try {
    return await getCachedCategoryRows(false);
  } catch {
    return [];
  }
}

const fallbackImage = "/images/categories/cosmetics.jpg";

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const resolvedSearchParams = (await searchParams) || {};
  const parsedParams = parsePublicCatalogParams(resolvedSearchParams);

  // Forced server-side initial query: exactly Page 1, pageSize 24, skip 0
  const serverQueryParams: ParsedPublicCatalogParams = {
    ...parsedParams,
    page: 1,
    pageSize: 24,
    skip: 0,
  };

  const [catalogResult, categories] = await Promise.all([
    getPublicCatalogQuery(serverQueryParams),
    getShopCategories(),
  ]);

  const category = parsedParams.category;
  const subcategory = parsedParams.subcategory;
  const query = parsedParams.q;
  const sort = parsedParams.sort;

  const activeCategory = category
    ? categories.find((item) => item.slug === category)
    : undefined;

  const categoryImage = activeCategory?.image || fallbackImage;

  const subcategories =
    activeCategory?.subcategories.map((item) => ({
      title: item.name,
      slug: item.slug,
      image: categoryImage,
    })) || [];

  const activeSubcategory = activeCategory?.subcategories.find(
    (item) => item.slug === subcategory
  );

  const activeTitle = query
    ? `Search results for "${query}"`
    : activeCategory && activeSubcategory
      ? `${activeCategory.name} / ${activeSubcategory.name}`
      : activeCategory
        ? activeCategory.name
        : "All Products";

  const queryKey = `${category || "all"}-${subcategory || "all"}-${query || ""}-${sort}`;

  return (
    <main>
      <TopBar />
      <Navbar />

      <section className="container-ph section-gap">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.22em] text-[#7a5244]">
              Browse Products
            </p>

            <h1 className="mt-2 text-3xl font-semibold text-[#2e221d]">
              {activeTitle}
            </h1>

            {activeCategory && activeSubcategory ? (
              <p className="mt-2 text-sm text-neutral-600">
                Showing products from {activeCategory.name} category under{" "}
                {activeSubcategory.name}.
              </p>
            ) : null}

            {query ? (
              <p className="mt-2 text-sm text-neutral-600">
                {catalogResult.totalItems} product
                {catalogResult.totalItems === 1 ? "" : "s"} found
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/shop"
              className={`text-sm ${
                !category && !subcategory && !query && sort === "latest"
                  ? "font-semibold underline"
                  : "font-medium text-[#7a5244] hover:underline"
              }`}
            >
              All Products
            </Link>

            <Link
              href={shopHref({ category, subcategory, q: query, sort: "latest" })}
              className={`text-sm ${
                sort === "latest"
                  ? "font-semibold underline"
                  : "font-medium text-[#7a5244] hover:underline"
              }`}
            >
              Latest
            </Link>

            <Link
              href={shopHref({
                category,
                subcategory,
                q: query,
                sort: "price-asc",
              })}
              className={`text-sm ${
                sort === "price-asc"
                  ? "font-semibold underline"
                  : "font-medium text-[#7a5244] hover:underline"
              }`}
            >
              Price Low to High
            </Link>

            <Link
              href={shopHref({
                category,
                subcategory,
                q: query,
                sort: "price-desc",
              })}
              className={`text-sm ${
                sort === "price-desc"
                  ? "font-semibold underline"
                  : "font-medium text-[#7a5244] hover:underline"
              }`}
            >
              Price High to Low
            </Link>
          </div>
        </div>

        {activeCategory && !subcategory && subcategories.length > 0 ? (
          <div className="mb-10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-[#2e221d]">
                Shop by Subcategory
              </h2>
            </div>

            <div className="flex gap-5 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {subcategories.map((item) => (
                <Link
                  key={item.slug}
                  href={`/shop?category=${category}&subcategory=${item.slug}`}
                  className="relative h-[300px] w-[260px] shrink-0 overflow-hidden rounded-none border border-[#ead9d1] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <SafeImage
                    src={item.image}
                    alt={item.title}
                    category={category}
                    fallbackSrc={categoryImage}
                    className="h-full w-full object-cover"
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />

                  <div className="absolute bottom-5 left-5 text-white">
                    <p className="text-xs uppercase tracking-[0.2em]">
                      Subcategory
                    </p>
                    <h3 className="mt-1 text-2xl font-semibold">
                      {item.title}
                    </h3>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <ProgressiveProductGrid
          key={queryKey}
          initialProducts={catalogResult.items}
          initialHasMore={catalogResult.hasMore}
          initialTotalItems={catalogResult.totalItems}
          category={category}
          subcategory={subcategory}
          q={query}
          sort={sort}
          requestedPage={parsedParams.page}
          gridClassName="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6"
        />
      </section>

      <Footer />
    </main>
  );
}
