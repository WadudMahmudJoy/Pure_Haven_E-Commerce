import Link from "next/link";
import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import ProgressiveProductGrid from "@/components/shop/ProgressiveProductGrid";
import { getCachedCategoryRows } from "@/lib/catalogRead";
import { parsePublicCatalogParams } from "@/lib/catalog/queryParams";
import { getPublicCatalogQuery } from "@/lib/catalog/publicCatalogQuery";
import type { ParsedPublicCatalogParams } from "@/lib/catalog/types";
import { createProgressiveQueryIdentity } from "@/components/shop/progressiveProductGridState";

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

  const queryKey = createProgressiveQueryIdentity({
    category,
    subcategory,
    q: query,
    sort,
  });

  return (
    <main>
      <TopBar />
      <Navbar />

      <section className="container-ph section-gap">
        {/* Breadcrumb */}
        {activeCategory ? (
          <nav aria-label="Breadcrumb" className="mb-4">
            <ol className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
              <li>
                <Link href="/" className="hover:text-[#7a5244] transition">
                  Home
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link href="/shop" className="hover:text-[#7a5244] transition">
                  Shop
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              {activeSubcategory ? (
                <>
                  <li>
                    <Link
                      href={shopHref({ category: activeCategory.slug, sort, q: query })}
                      className="hover:text-[#7a5244] transition"
                    >
                      {activeCategory.name}
                    </Link>
                  </li>
                  <li aria-hidden="true">/</li>
                  <li className="font-semibold text-[#2e221d]" aria-current="page">
                    {activeSubcategory.name}
                  </li>
                </>
              ) : (
                <li className="font-semibold text-[#2e221d]" aria-current="page">
                  {activeCategory.name}
                </li>
              )}
            </ol>
          </nav>
        ) : null}

        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs sm:text-sm uppercase tracking-[0.22em] text-[#7a5244]">
              {activeCategory ? "Category Catalog" : "Browse Products"}
            </p>

            <h1 className="mt-2 text-2xl sm:text-3xl font-semibold text-[#2e221d]">
              {activeCategory ? activeCategory.name.toUpperCase() : activeTitle}
            </h1>

            {activeCategory && activeSubcategory ? (
              <p className="mt-2 text-sm text-neutral-600">
                Showing products from {activeCategory.name} under{" "}
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

        {/* Subcategory Chip Bar (Approved Pre-Phase-6 UX) */}
        {activeCategory && subcategories.length > 0 ? (
          <div className="mb-8">
            <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap">
              <Link
                href={shopHref({ category: activeCategory.slug, sort, q: query })}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-xs sm:text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244] ${
                  !subcategory
                    ? "bg-[#2e221d] !text-white shadow-xs"
                    : "border border-[#ead9d1] bg-white text-[#2e221d] hover:bg-[#f8f3ef] hover:text-[#7a5244]"
                }`}
              >
                All
              </Link>

              {subcategories.map((item) => {
                const isSelected = subcategory === item.slug;
                return (
                  <Link
                    key={item.slug}
                    href={shopHref({
                      category: activeCategory.slug,
                      subcategory: item.slug,
                      sort,
                      q: query,
                    })}
                    className={`whitespace-nowrap rounded-full px-4 py-2 text-xs sm:text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244] ${
                      isSelected
                        ? "bg-[#2e221d] !text-white shadow-xs"
                        : "border border-[#ead9d1] bg-white text-[#2e221d] hover:bg-[#f8f3ef] hover:text-[#7a5244]"
                    }`}
                  >
                    {item.title}
                  </Link>
                );
              })}
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
