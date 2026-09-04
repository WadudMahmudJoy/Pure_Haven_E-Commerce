import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { getCachedCategoryRows } from "@/lib/catalogRead";
import type { PublicCategory } from "@/lib/defaultCategories";
import { sortAndSplitNavCategories } from "@/components/layout/navbarNavigation";

export const metadata: Metadata = {
  title: "Categories | Pure Haven BD",
  description: "Browse all top-level product categories at Pure Haven BD.",
};

export const revalidate = 60;

export default async function CategoriesPage() {
  let categoryRows: unknown[] | null = null;
  let fetchFailed = false;

  try {
    categoryRows = await getCachedCategoryRows(false);
  } catch {
    fetchFailed = true;
    categoryRows = null;
  }

  const categories: PublicCategory[] =
    !fetchFailed && Array.isArray(categoryRows)
      ? (() => {
          const { primaryCategories, overflowCategories } = sortAndSplitNavCategories(
            categoryRows as PublicCategory[],
            100
          );
          return [...primaryCategories, ...overflowCategories];
        })()
      : [];

  return (
    <div className="min-h-screen flex flex-col bg-[#fffaf7]">
      <TopBar />
      <Navbar initialCategories={categories} />

      <main className="flex-1 py-6 sm:py-10">
        <div className="container-ph max-w-7xl mx-auto px-3 sm:px-6">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="mb-6 text-xs sm:text-sm text-[#7a5244]">
            <ol className="flex items-center gap-2">
              <li>
                <Link href="/" className="hover:underline text-[#7a5244]">
                  Home
                </Link>
              </li>
              <li aria-hidden="true" className="text-[#c4a99b]">/</li>
              <li className="font-semibold text-[#2e221d]" aria-current="page">
                Categories
              </li>
            </ol>
          </nav>

          {/* Heading */}
          <div className="mb-8 border-b border-[#ead9d1] pb-6">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#2e221d]">
              Categories
            </h1>
            <p className="mt-2 text-sm text-[#7a5244]">
              Browse all product categories.
            </p>
          </div>

          {/* Controlled Database Failure State */}
          {fetchFailed ? (
            <div className="rounded-2xl border border-[#ead9d1] bg-white p-8 text-center text-[#7a5244] shadow-2xs">
              <p className="text-sm sm:text-base font-semibold text-[#2e221d]">
                Unable to load categories at this time.
              </p>
              <p className="mt-1 text-xs text-[#7a5244]">
                Please check back shortly or explore our products directly in the shop.
              </p>
              <Link
                href="/shop"
                className="mt-4 inline-flex items-center justify-center rounded-full bg-[#2e221d] px-5 py-2.5 text-xs font-semibold !text-white hover:bg-[#7a5244] transition"
              >
                Browse Shop
              </Link>
            </div>
          ) : categories.length === 0 ? (
            /* Valid Neutral Empty State */
            <div className="rounded-2xl border border-[#ead9d1] bg-white p-8 text-center text-[#7a5244] shadow-2xs">
              <p className="text-sm sm:text-base font-semibold text-[#2e221d]">
                No active categories currently available.
              </p>
              <p className="mt-1 text-xs text-[#7a5244]">
                Please explore our full product catalog in the shop.
              </p>
              <Link
                href="/shop"
                className="mt-4 inline-flex items-center justify-center rounded-full bg-[#2e221d] px-5 py-2.5 text-xs font-semibold !text-white hover:bg-[#7a5244] transition"
              >
                Go to Shop
              </Link>
            </div>
          ) : (
            /* Approved 6 / 4 / 2 Responsive Category Grid */
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  href={`/shop?category=${encodeURIComponent(category.slug)}`}
                  className="group flex flex-col items-center justify-between min-h-[105px] h-full p-4 sm:p-5 rounded-2xl border border-[#ead9d1] bg-white text-center hover:bg-[#2e221d] hover:border-[#2e221d] hover:shadow-md transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                >
                  <span className="text-sm sm:text-base font-semibold text-[#2e221d] group-hover:!text-white transition break-words leading-snug">
                    {category.name}
                  </span>
                  <span className="mt-2 text-xs font-medium text-[#7a5244] group-hover:!text-white/80 transition flex items-center gap-1">
                    Explore →
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
