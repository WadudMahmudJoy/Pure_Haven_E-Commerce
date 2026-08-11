"use client";

import { useEffect, useState } from "react";
import SiteBrand from "@/components/site/SiteBrand";
import {
  getDefaultPublicCategories,
  type PublicCategory,
} from "@/lib/defaultCategories";

type Category = PublicCategory;

function IconSearch() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20L16.5 16.5" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20.8 4.6c-1.8-1.7-4.6-1.6-6.3.2L12 7.4 9.5 4.8C7.8 3 5 2.9 3.2 4.6c-1.9 1.8-2 4.8-.2 6.7l9 9 9-9c1.8-1.9 1.7-4.9-.2-6.7Z" />
    </svg>
  );
}

function IconCart() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6h15l-2 8H8L6 6Z" />
      <path d="M6 6 5 3H2" />
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.7-4 4.5-6 8-6s6.3 2 8 6" />
    </svg>
  );
}

type NavbarProps = {
  initialCategories?: Category[];
  disableSelfFetch?: boolean;
};

export default function Navbar({
  initialCategories,
  disableSelfFetch = false,
}: NavbarProps = {}) {
  const [categories, setCategories] = useState<Category[]>(() =>
    initialCategories && initialCategories.length > 0
      ? initialCategories
      : getDefaultPublicCategories()
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [openCategory, setOpenCategory] = useState("");

  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories);
    }
  }, [initialCategories]);

  useEffect(() => {
    if (disableSelfFetch) return;

    async function loadCategories() {
      try {
        const res = await fetch("/api/categories", { cache: "no-store" });
        const data = await res.json();

        if (res.ok && data?.success && Array.isArray(data.categories)) {
          setCategories(
            data.categories.map((item: any) => ({
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

  function closeMenu() {
    setMenuOpen(false);
    setOpenCategory("");
  }

  function submitSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const q = searchText.trim();
    if (!q) return;

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
              className="grid h-12 w-12 place-items-center border border-[#ead9d1] bg-white text-3xl text-[#2e221d]"
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
                      window.location.href = `/shop?q=${encodeURIComponent(q)}`;
                    }
                  }}
                  className="grid h-12 w-12 shrink-0 place-items-center text-[#2e221d]"
                  aria-label="Search"
                >
                  <IconSearch />
                </button>
              </form>

              <a
                href="/wishlist"
                className="grid h-12 w-12 place-items-center border border-[#ead9d1] bg-white text-[#2e221d]"
                aria-label="Wishlist"
              >
                <IconHeart />
              </a>

              <a
                href="/cart"
                className="grid h-12 w-12 place-items-center border border-[#ead9d1] bg-white text-[#2e221d]"
                aria-label="Cart"
              >
                <IconCart />
              </a>

              <a
                href="/customer/dashboard"
                className="grid h-12 w-12 place-items-center border border-[#ead9d1] bg-white text-[#2e221d]"
                aria-label="Account"
              >
                <IconUser />
              </a>
            </div>
          </div>

          <nav className="hidden items-center justify-center gap-5 border-t border-[#ead9d1] py-4 text-sm text-[#2e221d] md:flex">
            <a href="/shop" className="whitespace-nowrap hover:text-[#7a5244]">
              All Products
            </a>

            {categories.map((category) => (
              <div key={category.id} className="group relative">
                <a
                  href={`/shop?category=${encodeURIComponent(category.slug)}`}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-1 transition hover:bg-[#f8f3ef] hover:text-[#7a5244]"
                >
                  <span>{category.name}</span>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 20 20"
                    fill="none"
                    className="shrink-0 text-[#7a5244] transition group-hover:rotate-180"
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
                </a>

                {category.subcategories && category.subcategories.length > 0 ? (
                  <div className="invisible absolute left-0 top-full z-[9999] min-w-52 translate-y-2 rounded-2xl border border-[#ead9d1] bg-white p-3 opacity-0 shadow-lg transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                    {category.subcategories.map((sub) => (
                      <a
                        key={sub.id}
                        href={`/shop?category=${encodeURIComponent(category.slug)}&subcategory=${encodeURIComponent(sub.slug)}`}
                        className="block whitespace-nowrap rounded-xl px-3 py-2 text-sm hover:bg-[#f8f3ef]"
                      >
                        {sub.name}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            <a href="/track-order" className="whitespace-nowrap hover:text-[#7a5244]">
              Track Order
            </a>
          </nav>
        </div>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-[99999] bg-black/35" onClick={closeMenu}>
          <aside
            className="h-full w-[88%] max-w-sm overflow-y-auto bg-white p-4 text-[#2e221d] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" onClick={closeMenu} className="mb-4 text-3xl">
              ×
            </button>

            <a
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
            </a>

            <div className="rounded-xl bg-[#f3f3f3] p-4">
              <a href="/shop" onClick={closeMenu} className="block border-b border-neutral-300 py-3">
                All Products
              </a>

              {categories.map((category) => {
                const hasSub = (category.subcategories || []).length > 0;
                const active = openCategory === category.slug;

                return (
                  <div key={category.id} className="border-b border-neutral-300">
                    <div className="flex items-center justify-between">
                      <a
                        href={`/shop?category=${encodeURIComponent(category.slug)}`}
                        onClick={(e) => {
                          if (hasSub) {
                            e.preventDefault();
                            setOpenCategory(active ? "" : category.slug);
                          } else {
                            closeMenu();
                          }
                        }}
                        className="flex-1 py-3"
                      >
                        {category.name}
                      </a>

                      {hasSub ? (
                        <button
                          type="button"
                          onClick={() => setOpenCategory(active ? "" : category.slug)}
                          className="px-3 py-3 text-2xl text-neutral-500"
                        >
                          ›
                        </button>
                      ) : null}
                    </div>

                    {hasSub && active ? (
                      <div className="grid gap-2 pb-3 pl-4 text-sm text-neutral-600">
                        {category.subcategories?.map((sub) => (
                          <a
                            key={sub.id}
                            href={`/shop?category=${encodeURIComponent(category.slug)}&subcategory=${encodeURIComponent(sub.slug)}`}
                            onClick={closeMenu}
                          >
                            {sub.name}
                          </a>
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
                <a href="/shop" onClick={closeMenu}>🛍️ Shop</a>
                <a href="/wishlist" onClick={closeMenu}>♡ Wishlists</a>
                <a href="/track-order" onClick={closeMenu}>📦 Track Order</a>
                <a href="/cart" onClick={closeMenu}>🛒 Cart</a>
                <a href="/customer/dashboard" onClick={closeMenu}>👤 Account</a>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
