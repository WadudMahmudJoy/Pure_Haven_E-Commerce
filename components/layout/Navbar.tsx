"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SiteBrand from "@/components/site/SiteBrand";
import {
  getDefaultPublicCategories,
  type PublicCategory,
} from "@/lib/defaultCategories";
import {
  DESKTOP_NAV_PRIMARY_BUDGET,
  sortAndSplitNavCategories,
} from "./navbarNavigation";

function IconSearch() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20L16.5 16.5" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20.8 4.6c-1.8-1.7-4.6-1.6-6.3.2L12 7.4 9.5 4.8C7.8 3 5 2.9 3.2 4.6c-1.9 1.8-2 4.8-.2 6.7l9 9 9-9c1.8-1.9 1.7-4.9-.2-6.7Z" />
    </svg>
  );
}

function IconCart() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 6h15l-2 8H8L6 6Z" />
      <path d="M6 6 5 3H2" />
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.7-4 4.5-6 8-6s6.3 2 8 6" />
    </svg>
  );
}

export type NavbarProps = {
  initialCategories?: PublicCategory[];
  disableSelfFetch?: boolean;
};

export default function Navbar(props: NavbarProps = {}) {
  const {
    initialCategories,
    disableSelfFetch = false,
  } = props;
  const [categories, setCategories] = useState<PublicCategory[]>(() =>
    initialCategories && initialCategories.length > 0
      ? initialCategories
      : getDefaultPublicCategories()
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [openCategory, setOpenCategory] = useState("");

  const [prevInitial, setPrevInitial] = useState(initialCategories);
  if (prevInitial !== initialCategories) {
    setPrevInitial(initialCategories);
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories);
    }
  }

  useEffect(() => {
    if (disableSelfFetch) return;

    async function loadCategories() {
      try {
        const res = await fetch("/api/categories", { cache: "no-store" });
        const data = await res.json();

        if (res.ok && data?.success && Array.isArray(data.categories)) {
          setCategories(
            data.categories.map((item: { id: number | string; name: string; slug: string; image?: string | null; isActive?: boolean; sortOrder?: number; subcategories?: unknown[]; subCategories?: unknown[] }) => ({
              id: item.id,
              name: item.name,
              slug: item.slug,
              image: item.image ?? null,
              isActive: item.isActive,
              sortOrder: item.sortOrder,
              subcategories: item.subcategories || item.subCategories || [],
            }))
          );
        }
      } catch {
        // Keep the already-visible safe navbar categories.
      }
    }

    loadCategories();
  }, [disableSelfFetch]);

  // Single helper owns active filtering, deterministic sorting, and primary/overflow split
  const { primaryCategories, overflowCategories } = useMemo(
    () => sortAndSplitNavCategories(categories, DESKTOP_NAV_PRIMARY_BUDGET),
    [categories]
  );

  const allNavCategories = useMemo(
    () => [...primaryCategories, ...overflowCategories],
    [primaryCategories, overflowCategories]
  );

  function closeMenu() {
    setMenuOpen(false);
    setOpenCategory("");
  }

  function submitSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const q = searchText.trim();
    if (!q) return;

    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/shop?q=${encodeURIComponent(q)}`;
  }

  return (
    <>
      <header className="sticky top-0 z-[999] border-b border-[#ead9d1] bg-[#fffaf7]">
        <div className="container-ph">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 py-4">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="grid h-12 w-12 place-items-center border border-[#ead9d1] bg-white text-3xl text-[#2e221d] lg:hidden"
              aria-label="Open menu"
            >
              ☰
            </button>

            <SiteBrand />

            <div className="flex items-center gap-2">
              <form
                onSubmit={submitSearch}
                className={`flex h-12 items-center overflow-hidden border border-[#ead9d1] bg-white transition-all duration-300 ${
                  searchOpen ? "w-[180px] sm:w-[280px] md:w-[420px]" : "w-12"
                }`}
              >
                {searchOpen ? (
                  <input
                    autoFocus
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Search in..."
                    className="min-w-0 flex-1 bg-transparent px-4 text-base outline-none"
                  />
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    if (!searchOpen) {
                      setSearchOpen(true);
                      return;
                    }

                    const q = searchText.trim();
                    if (q) {
                      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                      window.location.href = `/shop?q=${encodeURIComponent(q)}`;
                    }
                  }}
                  className="grid h-12 w-12 shrink-0 place-items-center text-[#2e221d]"
                  aria-label="Search"
                >
                  <IconSearch />
                </button>
              </form>

              <Link
                href="/wishlist"
                className="grid h-12 w-12 place-items-center border border-[#ead9d1] bg-white text-[#2e221d]"
                aria-label="Wishlist"
              >
                <IconHeart />
              </Link>

              <Link
                href="/cart"
                className="grid h-12 w-12 place-items-center border border-[#ead9d1] bg-white text-[#2e221d]"
                aria-label="Cart"
              >
                <IconCart />
              </Link>

              <Link
                href="/customer/dashboard"
                className="grid h-12 w-12 place-items-center border border-[#ead9d1] bg-white text-[#2e221d]"
                aria-label="Account"
              >
                <IconUser />
              </Link>
            </div>
          </div>

          {/* Desktop navigation: activates strictly at lg (>=1024px) breakpoint */}
          <nav className="hidden items-center justify-center gap-5 border-t border-[#ead9d1] py-4 text-sm text-[#2e221d] lg:flex">
            <Link href="/shop" className="whitespace-nowrap hover:text-[#7a5244]">
              All Products
            </Link>

            {/* At most 4 primary categories rendered directly before More */}
            {primaryCategories.map((category) => {
              const activeSubs = (category.subcategories || []).filter(
                (s) => s.isActive !== false
              );
              const hasActiveSubs = activeSubs.length > 0;

              return (
                <div key={category.id} className="group relative">
                  <Link
                    href={`/shop?category=${encodeURIComponent(category.slug)}`}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 transition hover:bg-[#f8f3ef] hover:text-[#7a5244] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                  >
                    <span className="max-w-[140px] truncate">{category.name}</span>
                    {hasActiveSubs ? (
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 20 20"
                        fill="none"
                        className="shrink-0 text-[#7a5244] transition group-hover:rotate-180 group-focus-within:rotate-180"
                        aria-hidden="true"
                      >
                        <path
                          d="M5 7.5L10 12.5L15 7.5"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </Link>

                  {/* Desktop primary subcategory dropdown (active subcategories only) */}
                  {hasActiveSubs ? (
                    <div className="invisible absolute left-0 top-full z-[9999] min-w-52 translate-y-2 rounded-2xl border border-[#ead9d1] bg-white p-3 opacity-0 shadow-lg transition group-hover:visible group-focus-within:visible group-hover:translate-y-0 group-focus-within:translate-y-0 group-hover:opacity-100 group-focus-within:opacity-100">
                      {activeSubs.map((sub) => (
                        <Link
                          key={sub.id}
                          href={`/shop?category=${encodeURIComponent(category.slug)}&subcategory=${encodeURIComponent(sub.slug)}`}
                          className="block whitespace-nowrap rounded-xl px-3 py-2 text-sm text-[#2e221d] hover:bg-[#f8f3ef] hover:text-[#7a5244]"
                        >
                          {sub.name}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {/* Exactly ONE grouped More panel when overflowCategories.length > 0 */}
            {overflowCategories.length > 0 ? (
              <div className="group relative">
                <button
                  type="button"
                  aria-haspopup="true"
                  aria-label="More categories"
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 transition hover:bg-[#f8f3ef] hover:text-[#7a5244] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                >
                  <span>More</span>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 20 20"
                    fill="none"
                    className="shrink-0 text-[#7a5244] transition group-hover:rotate-180 group-focus-within:rotate-180"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 7.5L10 12.5L15 7.5"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                <div className="invisible absolute right-0 top-full z-[9999] min-w-64 max-w-sm translate-y-2 rounded-2xl border border-[#ead9d1] bg-white p-4 opacity-0 shadow-xl transition group-hover:visible group-focus-within:visible group-hover:translate-y-0 group-focus-within:translate-y-0 group-hover:opacity-100 group-focus-within:opacity-100">
                  <div className="grid gap-4">
                    {overflowCategories.map((category) => {
                      const activeSubs = (category.subcategories || []).filter(
                        (s) => s.isActive !== false
                      );

                      return (
                        <div key={category.id} className="border-b border-neutral-100 pb-3 last:border-0 last:pb-0">
                          <Link
                            href={`/shop?category=${encodeURIComponent(category.slug)}`}
                            className="block font-medium text-[#2e221d] hover:text-[#7a5244]"
                          >
                            {category.name}
                          </Link>

                          {activeSubs.length > 0 ? (
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-2 text-xs text-neutral-600">
                              {activeSubs.map((sub) => (
                                <Link
                                  key={sub.id}
                                  href={`/shop?category=${encodeURIComponent(category.slug)}&subcategory=${encodeURIComponent(sub.slug)}`}
                                  className="hover:text-[#7a5244]"
                                >
                                  {sub.name}
                                </Link>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            <Link href="/track-order" className="whitespace-nowrap hover:text-[#7a5244]">
              Track Order
            </Link>
          </nav>
        </div>
      </header>

      {/* Mobile drawer: active below lg */}
      {menuOpen ? (
        <div className="fixed inset-0 z-[99999] bg-black/35" onClick={closeMenu}>
          <aside
            className="h-full w-[88%] max-w-sm overflow-y-auto bg-white p-4 text-[#2e221d] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" onClick={closeMenu} className="mb-4 text-3xl" aria-label="Close menu">
              ×
            </button>

            <Link
              href="/customer/dashboard"
              onClick={closeMenu}
              className="mb-7 flex items-center gap-5 rounded-2xl bg-orange-500 p-5 text-white"
            >
              <div className="grid h-20 w-20 place-items-center rounded-full bg-blue-100 text-5xl">
                👤
              </div>
              <div>
                <div className="text-2xl font-semibold leading-tight">
                  Hello<br />there!
                </div>
                <div className="mt-1 text-base">Signin</div>
              </div>
            </Link>

            <div className="rounded-xl bg-[#f3f3f3] p-4">
              <Link href="/shop" onClick={closeMenu} className="block border-b border-neutral-300 py-3 font-medium text-[#2e221d]">
                All Products
              </Link>

              {allNavCategories.map((category) => {
                const activeSubs = (category.subcategories || []).filter(
                  (s) => s.isActive !== false
                );
                const hasActiveSubs = activeSubs.length > 0;
                const isOpen = openCategory === category.slug;
                const containerId = `${category.id}-subcategories`;

                return (
                  <div key={category.id} className="border-b border-neutral-300">
                    <div className="flex items-center justify-between">
                      {/* Direct category navigation link: navigates immediately, does NOT toggle accordion */}
                      <Link
                        href={`/shop?category=${encodeURIComponent(category.slug)}`}
                        onClick={closeMenu}
                        className="flex-1 py-3 text-[#2e221d] hover:text-[#7a5244]"
                      >
                        {category.name}
                      </Link>

                      {/* Separate disclosure button: toggles accordion, does NOT navigate, >=44x44 touch target */}
                      {hasActiveSubs ? (
                        <button
                          type="button"
                          onClick={() => setOpenCategory(isOpen ? "" : category.slug)}
                          aria-expanded={isOpen}
                          aria-controls={containerId}
                          aria-label={
                            isOpen
                              ? `Hide subcategories for ${category.name}`
                              : `Show subcategories for ${category.name}`
                          }
                          className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                        >
                          <svg
                            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </button>
                      ) : null}
                    </div>

                    {/* Expandable subcategory container with matching aria-controls ID */}
                    {hasActiveSubs && isOpen ? (
                      <div
                        id={containerId}
                        className="grid gap-2 pb-3 pl-4 text-sm text-neutral-600"
                      >
                        {activeSubs.map((sub) => (
                          <Link
                            key={sub.id}
                            href={`/shop?category=${encodeURIComponent(category.slug)}&subcategory=${encodeURIComponent(sub.slug)}`}
                            onClick={closeMenu}
                            className="py-1 hover:text-[#7a5244]"
                          >
                            {sub.name}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-6">
              <h3 className="text-xl font-semibold text-neutral-600">Quick Links</h3>
              <div className="mt-3 h-[3px] w-10 bg-orange-500" />

              <div className="mt-4 grid gap-4 rounded-xl bg-[#f3f3f3] p-4 text-lg">
                <Link href="/shop" onClick={closeMenu}>🛍️ Shop</Link>
                <Link href="/wishlist" onClick={closeMenu}>♡ Wishlists</Link>
                <Link href="/track-order" onClick={closeMenu}>📦 Track Order</Link>
                <Link href="/cart" onClick={closeMenu}>🛒 Cart</Link>
                <Link href="/customer/dashboard" onClick={closeMenu}>👤 Account</Link>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
