"use client";

import { useEffect, useState } from "react";

type Subcategory = {
  id: number | string;
  name: string;
  slug: string;
};

type Category = {
  id: number | string;
  name: string;
  slug: string;
  subcategories?: Subcategory[];
};

function HomeIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10.5V21h14V10.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="6" height="6" />
      <rect x="14" y="4" width="6" height="6" />
      <rect x="4" y="14" width="6" height="6" />
      <rect x="14" y="14" width="6" height="6" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6h15l-2 8H8L6 6Z" />
      <path d="M6 6 5 3H2" />
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20 16.5 16.5" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.7-4 4.5-6 8-6s6.3 2 8 6" />
    </svg>
  );
}

export default function SafeMobileBottomNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [openCategory, setOpenCategory] = useState("");

  useEffect(() => {
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
              subcategories: item.subcategories || item.subCategories || [],
            }))
          );
        }
      } catch {
        setCategories([]);
      }
    }

    loadCategories();
  }, []);

  function closeMenu() {
    setMenuOpen(false);
    setOpenCategory("");
  }

  return (
    <>
      <nav id="ph-real-bottom-nav" className="ph-real-bottom-nav">
        <a href="/" className="ph-real-bottom-nav-item">
          <span className="ph-real-bottom-nav-icon"><HomeIcon /></span>
          <span className="ph-real-bottom-nav-label">HOME</span>
        </a>

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="ph-real-bottom-nav-item"
        >
          <span className="ph-real-bottom-nav-icon"><MenuIcon /></span>
          <span className="ph-real-bottom-nav-label">MENU</span>
        </button>

        <a href="/cart" className="ph-real-bottom-nav-item">
          <span className="ph-real-bottom-nav-icon"><CartIcon /></span>
          <span className="ph-real-bottom-nav-label">CART</span>
        </a>

        <a href="/shop?focus=search" className="ph-real-bottom-nav-item">
          <span className="ph-real-bottom-nav-icon"><SearchIcon /></span>
          <span className="ph-real-bottom-nav-label">SEARCH</span>
        </a>

        <a href="/login" className="ph-real-bottom-nav-item">
          <span className="ph-real-bottom-nav-icon"><AccountIcon /></span>
          <span className="ph-real-bottom-nav-label">ACCOUNT</span>
        </a>
      </nav>

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
              href="/login"
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
          </aside>
        </div>
      ) : null}
    </>
  );
}
