import Link from "next/link";
import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import LoadMoreProducts from "@/components/shop/LoadMoreProducts";
import SafeImage from "@/components/ui/SafeImage";
import { getProducts, type Product } from "@/lib/getProducts";
import { getCachedCategoryRows } from "@/lib/catalogRead";

export const revalidate = 60;

type ShopPageProps = {
  searchParams?: Promise<{
    category?: string;
    subcategory?: string;
    q?: string;
    sort?: string;
  }>;
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


function slug(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function label(value?: string | null) {
  return (value || "")
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function cleanQuery(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function sortProducts(products: Product[], sort?: string) {
  const sorted = [...products];

  if (sort === "price-asc") {
    return sorted.sort((a, b) => Number(a.price) - Number(b.price));
  }

  if (sort === "price-desc") {
    return sorted.sort((a, b) => Number(b.price) - Number(a.price));
  }

  return sorted.sort((a, b) => Number(b.id) - Number(a.id));
}

function shopHref(options: {
  category?: string;
  subcategory?: string;
  q?: string;
  sort?: string;
}) {
  const params = new URLSearchParams();

  if (options.category) params.set("category", options.category);
  if (options.subcategory) params.set("subcategory", options.subcategory);
  if (options.q) params.set("q", options.q);
  if (options.sort) params.set("sort", options.sort);

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
  const params = (await searchParams) || {};
  const category = slug(params.category);
  const subcategory = slug(params.subcategory);
  const query = cleanQuery(params.q);
  const sort = params.sort || "latest";

  const [allProducts, categories] = await Promise.all([
    getProducts(),
    getShopCategories(),
  ]);

  const activeCategory = categories.find((item) => item.slug === category);

  const categoryProducts = category
    ? allProducts.filter((product) => slug(product.category) === category)
    : allProducts;

  const searchProducts = query
    ? categoryProducts.filter((product) => {
        const searchableText = [
          product.name,
          product.category,
          product.subcategory || "",
          product.description || "",
        ]
          .join(" ")
          .toLowerCase();

        return searchableText.includes(query);
      })
    : categoryProducts;

  const categoryImage =
    activeCategory?.image || categoryProducts[0]?.image || fallbackImage;

  const subcategories =
    activeCategory?.subcategories.map((item) => {
      const matchedProduct = categoryProducts.find(
        (product) => slug(product.subcategory) === item.slug
      );

      return {
        title: item.name,
        slug: item.slug,
        image: matchedProduct?.image || categoryImage,
      };
    }) || [];

  const filteredProducts =
    category && !subcategory && !query
      ? []
      : searchProducts.filter((product) =>
          subcategory ? slug(product.subcategory) === subcategory : true
        );

  const visibleProducts = sortProducts(filteredProducts, sort);

  const activeSubcategory = activeCategory?.subcategories.find(
    (item) => item.slug === subcategory
  );

  const activeTitle = query
    ? `Search results for "${params.q}"`
    : activeCategory && activeSubcategory
      ? `${activeCategory.name} / ${activeSubcategory.name}`
      : activeCategory
        ? activeCategory.name
        : "All Products";

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
                {visibleProducts.length} product
                {visibleProducts.length === 1 ? "" : "s"} found
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link href="/shop" className="text-sm font-semibold underline">
              All Products
            </Link>

            <Link
              href={shopHref({ category, subcategory, q: query, sort: "latest" })}
              className="text-sm font-medium text-[#7a5244] hover:underline"
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
              className="text-sm font-medium text-[#7a5244] hover:underline"
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
              className="text-sm font-medium text-[#7a5244] hover:underline"
            >
              Price High to Low
            </Link>
          </div>
        </div>

        {category && !subcategory && subcategories.length > 0 ? (
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

        {category && !subcategory && !query ? (
          <div className="rounded-none border border-[#ead9d1] bg-white p-8 text-center">
            <h2 className="text-xl font-semibold text-[#2e221d]">
              Select a subcategory
            </h2>
            <p className="mt-2 text-sm text-neutral-600">
              Products will appear after choosing a subcategory.
            </p>
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="rounded-none border border-[#ead9d1] bg-white p-8 text-center">
            <h2 className="text-xl font-semibold text-[#2e221d]">
              No products found
            </h2>
            <p className="mt-2 text-sm text-neutral-600">
              Products will appear here when available.
            </p>
          </div>
        ) : (
          <LoadMoreProducts
            products={visibleProducts}
            gridClassName="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6"
            initialLimit={12}
            step={12}
          />
        )}
      </section>

      <Footer />
    </main>
  );
}
