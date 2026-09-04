"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import SiteBrand from "@/components/site/SiteBrand";
import {
  getDefaultPublicCategories,
  type PublicCategory,
} from "@/lib/defaultCategories";
import { sortAndSplitNavCategories } from "./navbarNavigation";

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20L16.5 16.5" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20.8 4.6c-1.8-1.7-4.6-1.6-6.3.2L12 7.4 9.5 4.8C7.8 3 5 2.9 3.2 4.6c-1.9 1.8-2 4.8-.2 6.7l9 9 9-9c1.8-1.9 1.7-4.9-.2-6.7Z" />
    </svg>
  );
}

function IconCart() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 6h15l-2 8H8L6 6Z" />
      <path d="M6 6 5 3H2" />
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.7-4 4.5-6 8-6s6.3 2 8 6" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export interface CategoryGridResult {
  displayItems: PublicCategory[];
  hasOverflow: boolean;
  cols: number;
  maxRows: number;
}

export function computeCategoryGrid(
  categories: PublicCategory[],
  maxCols: number = 6
): CategoryGridResult {
  const safeMaxCols = Math.max(1, maxCols);
  const maxCapacity = 3 * safeMaxCols;
  const hasOverflow = categories.length > maxCapacity;

  const displayItems = hasOverflow
    ? categories.slice(0, maxCapacity - 1)
    : categories;

  return {
    displayItems,
    hasOverflow,
    cols: safeMaxCols,
    maxRows: 3,
  };
}

export type NavbarProps = {
  initialCategories?: PublicCategory[];
  disableSelfFetch?: boolean;
  initialMegaMenuOpen?: boolean;
};

export default function Navbar(props: NavbarProps = {}) {
  const {
    initialCategories,
    disableSelfFetch = false,
    initialMegaMenuOpen = false,
  } = props;

  const [categories, setCategories] = useState<PublicCategory[]>(() =>
    initialCategories && initialCategories.length > 0
      ? initialCategories
      : getDefaultPublicCategories()
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [megaMenuOpen, setMegaMenuOpen] = useState(initialMegaMenuOpen);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const megaMenuRef = useRef<HTMLDivElement>(null);
  const megaMenuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const [prevInitial, setPrevInitial] = useState(initialCategories);
  if (prevInitial !== initialCategories) {
    setPrevInitial(initialCategories);
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories);
    }
  }

  // Load customer auth state (non-blocking)
  useEffect(() => {
    fetch("/api/customer-auth/session", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated) {
          setIsLoggedIn(true);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch categories if self-fetch is enabled
  useEffect(() => {
    if (disableSelfFetch) return;

    async function loadCategories() {
      try {
        const res = await fetch("/api/categories", { credentials: "omit" });
        if (!res.ok) return;
        const data = await res.json();
        const cats = data.categories || [];
        if (Array.isArray(cats) && cats.length > 0) {
          setCategories(
            cats.map((item: {
              id: number | string;
              name: string;
              slug: string;
              image?: string | null;
              isActive?: boolean;
              sortOrder?: number;
              subcategories?: unknown[];
              subCategories?: unknown[];
            }) => ({
              id: item.id,
              name: item.name,
              slug: item.slug,
              image: item.image ?? null,
              isActive: item.isActive,
              sortOrder: item.sortOrder,
              subcategories: (item.subcategories || item.subCategories || []) as Array<{
                id: number | string;
                name: string;
                slug: string;
                isActive?: boolean;
                sortOrder?: number;
              }>,
            }))
          );
        }
      } catch {
        // Fallback categories retained
      }
    }

    loadCategories();
  }, [disableSelfFetch]);

  // Handle pushed sidebar class on body and keyboard/outside-click listeners
  useEffect(() => {
    if (menuOpen) {
      document.body.classList.add("ph-menu-open");
    } else {
      document.body.classList.remove("ph-menu-open");
    }
    return () => {
      document.body.classList.remove("ph-menu-open");
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    function handleOutsideClick(e: MouseEvent) {
      if (
        sidebarRef.current &&
        !sidebarRef.current.contains(e.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [menuOpen]);

  // Handle outside click and Escape key for category picker
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMegaMenuOpen(false);
        setSearchOpen(false);
        megaMenuButtonRef.current?.focus();
      }
    }

    function handleClickOutside(e: MouseEvent) {
      if (
        megaMenuRef.current &&
        !megaMenuRef.current.contains(e.target as Node) &&
        megaMenuButtonRef.current &&
        !megaMenuButtonRef.current.contains(e.target as Node)
      ) {
        setMegaMenuOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    if (megaMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [megaMenuOpen]);

  // Deterministically sort and prepare active categories
  const sortedActiveCategories = useMemo(() => {
    const { primaryCategories, overflowCategories } = sortAndSplitNavCategories(categories, 100);
    return [...primaryCategories, ...overflowCategories];
  }, [categories]);

  // Responsive capacity: 6 columns on desktop (>=1024px, max 18), 4 on tablet (>=768px, max 12), 2 on mobile (max 6)
  const [maxCols, setMaxCols] = useState(6);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mqlDesktop = window.matchMedia("(min-width: 1024px)");
    const mqlTablet = window.matchMedia("(min-width: 768px)");
    function updateCapacity() {
      if (mqlDesktop.matches) {
        setMaxCols(6);
      } else if (mqlTablet.matches) {
        setMaxCols(4);
      } else {
        setMaxCols(2);
      }
    }
    updateCapacity();
    mqlDesktop.addEventListener("change", updateCapacity);
    mqlTablet.addEventListener("change", updateCapacity);
    return () => {
      mqlDesktop.removeEventListener("change", updateCapacity);
      mqlTablet.removeEventListener("change", updateCapacity);
    };
  }, []);

  const gridConfig = useMemo(() => {
    return computeCategoryGrid(sortedActiveCategories, maxCols);
  }, [sortedActiveCategories, maxCols]);

  function closeMenu() {
    setMenuOpen(false);
  }

  function submitSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = searchText.trim();
    if (!q) return;
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/shop?q=${encodeURIComponent(q)}`;
  }

  const accountHref = isLoggedIn ? "/customer/dashboard" : "/user-login";

  return (
    <>
      <header className="sticky top-0 z-[999] w-full px-2 sm:px-4 py-2 sm:py-3 transition-all duration-200">
        <div className="container-ph max-w-7xl mx-auto">
          {/* Floating premium container */}
          <div className="relative rounded-2xl sm:rounded-[24px] border border-[#ead9d1] bg-[#fffaf7]/95 backdrop-blur-md shadow-sm px-2.5 sm:px-6 py-2 sm:py-2.5">
            {/* 3-Part Layout: Left, Center, Right */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 sm:gap-4">

              {/* LEFT SECTION:
                  Desktop: ☰ Menu, 👤 Account, Shop, Categories ▾
                  Mobile: ☰ Menu, 👤 Account */}
              <div className="flex items-center gap-1.5 sm:gap-2.5 lg:gap-4 justify-start min-w-0">
                <button
                  ref={menuButtonRef}
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  aria-expanded={menuOpen}
                  aria-controls="storefront-menu-sidebar"
                  className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[#ead9d1] bg-white h-9 px-2 sm:px-3 text-xs sm:text-sm font-medium text-[#2e221d] hover:bg-[#f8f3ef] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                  aria-label="Open menu"
                >
                  <IconMenu />
                  <span className="hidden sm:inline">Menu</span>
                </button>

                {/* Account: strictly icon-only */}
                <Link
                  href={accountHref}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ead9d1] bg-white text-[#2e221d] hover:bg-[#f8f3ef] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                  aria-label="Account"
                >
                  <IconUser />
                </Link>

                {/* Desktop: Shop */}
                <Link
                  href="/shop"
                  className="hidden lg:inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium text-[#2e221d] hover:text-[#7a5244] hover:bg-[#f8f3ef] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                >
                  Shop
                </Link>

                {/* Tablet/Desktop: Categories ▾ Compact Category Picker trigger */}
                <button
                  ref={megaMenuButtonRef}
                  type="button"
                  onClick={() => setMegaMenuOpen((prev) => !prev)}
                  aria-expanded={megaMenuOpen}
                  aria-controls="desktop-category-picker"
                  className={`hidden md:inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244] ${
                    megaMenuOpen
                      ? "bg-[#2e221d] text-white"
                      : "text-[#2e221d] hover:text-[#7a5244] hover:bg-[#f8f3ef]"
                  }`}
                >
                  <span>Categories ▾</span>
                </button>
              </div>

              {/* CENTER SECTION:
                  Logo + PURE HAVEN BD */}
              <div className="flex items-center justify-center shrink-0 px-1">
                <SiteBrand />
              </div>

              {/* RIGHT SECTION:
                  Desktop: Contact, Track Order, Wishlist, Cart, Search
                  Mobile: 📞 Contact, 🛒 Cart, 🔍 Search */}
              <div className="flex items-center gap-1 sm:gap-2.5 lg:gap-3 justify-end min-w-0">
                {/* Desktop Contact text */}
                <Link
                  href="/contact"
                  className="hidden lg:inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium text-[#2e221d] hover:text-[#7a5244] hover:bg-[#f8f3ef] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                >
                  Contact
                </Link>

                {/* Mobile Contact icon */}
                <Link
                  href="/contact"
                  className="lg:hidden grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ead9d1] bg-white text-[#2e221d] hover:bg-[#f8f3ef] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                  aria-label="Contact"
                >
                  <IconPhone />
                </Link>

                {/* Desktop Track Order */}
                <Link
                  href="/track-order"
                  className="hidden lg:inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium text-[#2e221d] hover:text-[#7a5244] hover:bg-[#f8f3ef] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                >
                  Track Order
                </Link>

                {/* Desktop Wishlist */}
                <Link
                  href="/wishlist"
                  className="hidden lg:grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#ead9d1] bg-white text-[#2e221d] hover:bg-[#f8f3ef] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                  aria-label="Wishlist"
                >
                  <IconHeart />
                </Link>

                {/* Cart (All viewports) */}
                <Link
                  href="/cart"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ead9d1] bg-white text-[#2e221d] hover:bg-[#f8f3ef] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                  aria-label="Cart"
                >
                  <IconCart />
                </Link>

                {/* Search: FAR-RIGHT action */}
                <form
                  onSubmit={submitSearch}
                  className={`flex h-9 items-center overflow-hidden rounded-full border border-[#ead9d1] bg-white transition-all duration-300 ${
                    searchOpen ? "w-[120px] sm:w-[220px] md:w-[260px]" : "w-9"
                  }`}
                >
                  {searchOpen ? (
                    <input
                      autoFocus
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="Search..."
                      className="min-w-0 flex-1 bg-transparent px-2.5 text-xs text-[#2e221d] outline-none"
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
                      } else {
                        setSearchOpen(false);
                      }
                    }}
                    className="grid h-9 w-9 shrink-0 place-items-center text-[#2e221d] hover:text-[#7a5244] transition"
                    aria-label="Search"
                  >
                    <IconSearch />
                  </button>
                </form>
              </div>
            </div>

            {/* Desktop Categories Panel — Aligned to Main Navbar Container */}
            {megaMenuOpen ? (
              <div
                id="desktop-category-picker"
                ref={megaMenuRef}
                data-testid="desktop-category-picker"
                className="hidden md:block absolute inset-x-0 top-[calc(100%+8px)] z-[9999] w-full rounded-2xl border border-[#ead9d1] bg-[#fffaf7]/98 backdrop-blur-md p-3.5 sm:p-4 shadow-xl transition-all duration-200"
              >
                {/* Category controls begin immediately — no internal heading */}
                <div
                  className="grid gap-2 sm:gap-2.5"
                  style={{
                    gridTemplateColumns: `repeat(${gridConfig.cols}, minmax(0, 1fr))`,
                  }}
                >
                  {gridConfig.displayItems.map((category) => (
                    <Link
                      key={category.id}
                      href={`/shop?category=${encodeURIComponent(category.slug)}`}
                      onClick={() => setMegaMenuOpen(false)}
                      className="flex items-center justify-center rounded-xl border border-[#ead9d1] bg-white px-3 py-2.5 sm:py-3 text-center text-xs sm:text-sm font-semibold text-[#2e221d] hover:bg-[#f8f3ef] hover:border-[#d8bfb2] hover:shadow-sm hover:-translate-y-[1px] transition shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244] truncate"
                    >
                      <span className="truncate">{category.name}</span>
                    </Link>
                  ))}

                  {gridConfig.hasOverflow ? (
                    <Link
                      href="/categories"
                      onClick={() => setMegaMenuOpen(false)}
                      className="flex items-center justify-center rounded-xl border border-[#7a5244] bg-[#f8f3ef] px-3 py-2.5 sm:py-3 text-center text-xs sm:text-sm font-semibold text-[#7a5244] hover:bg-[#f0e4db] hover:border-[#5a3a2e] hover:text-[#5a3a2e] hover:shadow-sm hover:-translate-y-[1px] transition shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                    >
                      <span>See All Categories →</span>
                    </Link>
                  ) : null}
                </div>

                {/* Bottom-center collapse control anchored at panel bottom edge without extra white strip */}
                <button
                  type="button"
                  onClick={() => {
                    setMegaMenuOpen(false);
                    megaMenuButtonRef.current?.focus();
                  }}
                  aria-label="Collapse categories"
                  className="absolute left-1/2 -bottom-3.5 -translate-x-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#ead9d1] bg-[#fffaf7] text-[#7a5244] hover:bg-[#f8f3ef] hover:border-[#d8bfb2] hover:text-[#2e221d] transition shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244] z-10"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* Storefront Menu: Light overlay on mobile (<768px); Left-pushed sidebar on tablet/desktop (>=768px) */}
      {menuOpen ? (
        <>
          {/* Light overlay on mobile only (< 768px). Strictly no overlay or blur on tablet/desktop */}
          <div
            data-testid="storefront-menu-backdrop"
            className="md:hidden fixed inset-0 z-[9989] bg-black/20"
            onClick={closeMenu}
            aria-hidden="true"
          />

          <aside
            id="storefront-menu-sidebar"
            ref={sidebarRef}
            data-testid="storefront-menu-sidebar"
            className="fixed top-0 bottom-0 left-0 z-[9990] h-screen w-[85vw] max-w-[300px] md:w-[260px] lg:w-[280px] overflow-y-auto bg-[#fffaf7] border-r border-[#ead9d1] p-5 text-[#2e221d] shadow-xl md:shadow-md transition-transform duration-200 ease-out"
            aria-label="Storefront navigation menu"
          >
            <div className="flex items-center justify-between pb-4 border-b border-[#ead9d1]">
              <span className="text-sm font-bold tracking-[0.2em] text-[#161616] uppercase">
                PURE HAVEN BD
              </span>
              <button
                type="button"
                onClick={closeMenu}
                className="grid h-9 w-9 place-items-center rounded-full border border-[#ead9d1] bg-white text-xl text-[#2e221d] hover:bg-[#f8f3ef] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
                aria-label="Close menu"
              >
                ×
              </button>
            </div>

            {/* Account greeting card: auth-aware destination */}
            <Link
              href={accountHref}
              onClick={closeMenu}
              className="mt-4 mb-4 flex items-center gap-3.5 rounded-2xl border border-[#ead9d1] bg-white p-3.5 text-[#2e221d] hover:bg-[#f8f3ef] transition shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244]"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#2e221d] text-white text-sm">
                👤
              </div>
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-semibold leading-tight truncate">
                  {isLoggedIn ? "My Account" : "Hello there!"}
                </div>
                <div className="mt-0.5 text-[11px] text-[#7a5244] truncate">
                  {isLoggedIn ? "Manage orders & profile" : "Signin / Register"}
                </div>
              </div>
            </Link>

            {/* Shop & Top-Level Categories */}
            <div className="rounded-2xl border border-[#ead9d1] bg-white p-4 shadow-2xs">
              <Link
                href="/shop"
                onClick={closeMenu}
                className="block border-b border-[#f0e3dc] py-2.5 font-semibold text-[#2e221d] hover:text-[#7a5244] transition"
              >
                Shop
              </Link>

              <div className="pt-2">
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#8b5a45]">
                    Categories
                  </span>
                  <Link
                    href="/categories"
                    onClick={closeMenu}
                    className="flex items-center gap-1 text-xs font-semibold text-[#8b5a45] hover:text-[#2e221d] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244] rounded-xs group"
                  >
                    <span>All</span>
                    <span className="text-[11px] transition-transform group-hover:translate-x-0.5" aria-hidden="true">
                      →
                    </span>
                  </Link>
                </div>

                <div className="divide-y divide-[#f5ede8]">
                  {sortedActiveCategories.map((category) => (
                    <Link
                      key={category.id}
                      href={`/shop?category=${encodeURIComponent(category.slug)}`}
                      onClick={closeMenu}
                      className="block py-2.5 text-xs sm:text-sm font-medium text-[#2e221d] hover:text-[#7a5244] transition"
                    >
                      {category.name}
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Links Section */}
            <div className="mt-4 rounded-2xl border border-[#ead9d1] bg-white p-4 shadow-2xs">
              <p className="pb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#8b5a45]">
                Quick Links
              </p>
              <div className="grid gap-2.5 pt-1 text-xs sm:text-sm font-medium">
                <Link href="/contact" onClick={closeMenu} className="hover:text-[#7a5244] transition">
                  Contact
                </Link>
                <Link href="/track-order" onClick={closeMenu} className="hover:text-[#7a5244] transition">
                  Track Order
                </Link>
                <Link href="/wishlist" onClick={closeMenu} className="hover:text-[#7a5244] transition">
                  Wishlist
                </Link>
                <Link href="/cart" onClick={closeMenu} className="hover:text-[#7a5244] transition">
                  Cart
                </Link>
                <Link href={accountHref} onClick={closeMenu} className="hover:text-[#7a5244] transition">
                  Account
                </Link>
              </div>
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}
