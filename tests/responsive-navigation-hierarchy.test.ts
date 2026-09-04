import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicCategory } from "@/lib/defaultCategories";
import {
  DESKTOP_NAV_PRIMARY_BUDGET,
  sortAndSplitNavCategories,
} from "@/components/layout/navbarNavigation";
import Navbar, { type NavbarProps } from "@/components/layout/Navbar";

describe("Task 8 — Responsive Navigation Hierarchy & Category Sorting", () => {
  // ---------------------------------------------------------------------------
  // 1. Pure Helper Contract: sortAndSplitNavCategories
  // ---------------------------------------------------------------------------
  describe("Pure Helper Contract: sortAndSplitNavCategories", () => {
    it("A. SORT ORDER: active categories sorted by sortOrder ASC, id ASC regardless of input order", () => {
      const outOfOrder: PublicCategory[] = [
        { id: 40, name: "Perfume", slug: "perfume", sortOrder: 2, isActive: true, subcategories: [] },
        { id: 30, name: "Haircare", slug: "haircare", sortOrder: 1, isActive: true, subcategories: [] },
        { id: 20, name: "Skincare", slug: "skincare", sortOrder: 1, isActive: true, subcategories: [] },
      ];

      const { primaryCategories } = sortAndSplitNavCategories(outOfOrder);
      const actualIds = primaryCategories.map((c) => c.id);

      assert.deepStrictEqual(
        actualIds,
        [20, 30, 40],
        "Categories must be sorted by sortOrder ASC, then id ASC"
      );
    });

    it("B. INPUT IMMUTABILITY: original categories array ordering is unchanged", () => {
      const input: PublicCategory[] = [
        { id: 40, name: "D", slug: "d", sortOrder: 2, subcategories: [] },
        { id: 10, name: "A", slug: "a", sortOrder: 1, subcategories: [] },
      ];
      const cloned = [...input];

      sortAndSplitNavCategories(input);
      assert.deepStrictEqual(input, cloned, "Original input array must not be mutated");
    });

    it("C. INACTIVE FILTER: isActive === false categories excluded", () => {
      const input: PublicCategory[] = [
        { id: 1, name: "Active", slug: "active", isActive: true, subcategories: [] },
        { id: 2, name: "Disabled", slug: "disabled", isActive: false, subcategories: [] },
        { id: 3, name: "Implicit Active", slug: "implicit", subcategories: [] },
      ];

      const { primaryCategories, overflowCategories } = sortAndSplitNavCategories(input);
      const allResultIds = [...primaryCategories, ...overflowCategories].map((c) => c.id);

      assert.ok(!allResultIds.includes(2), "Inactive categories must be excluded");
      assert.ok(allResultIds.includes(1), "Active category must be included");
      assert.ok(allResultIds.includes(3), "Implicit active category must be included");
    });

    it("D. BUDGET 4: six active categories produce primary 4 + overflow 2", () => {
      const input: PublicCategory[] = [
        { id: 6, name: "F", slug: "f", sortOrder: 6, subcategories: [] },
        { id: 1, name: "A", slug: "a", sortOrder: 1, subcategories: [] },
        { id: 4, name: "D", slug: "d", sortOrder: 4, subcategories: [] },
        { id: 2, name: "B", slug: "b", sortOrder: 2, subcategories: [] },
        { id: 5, name: "E", slug: "e", sortOrder: 5, subcategories: [] },
        { id: 3, name: "C", slug: "c", sortOrder: 3, subcategories: [] },
      ];

      const { primaryCategories, overflowCategories } = sortAndSplitNavCategories(input, 4);

      assert.strictEqual(primaryCategories.length, 4);
      assert.strictEqual(overflowCategories.length, 2);
      assert.deepStrictEqual(primaryCategories.map((c) => c.id), [1, 2, 3, 4]);
      assert.deepStrictEqual(overflowCategories.map((c) => c.id), [5, 6]);
    });

    it("E. <=4: four or fewer active categories produce overflowCategories.length === 0", () => {
      const input: PublicCategory[] = [
        { id: 1, name: "A", slug: "a", sortOrder: 1, subcategories: [] },
        { id: 2, name: "B", slug: "b", sortOrder: 2, subcategories: [] },
        { id: 3, name: "C", slug: "c", sortOrder: 3, subcategories: [] },
      ];

      const { primaryCategories, overflowCategories } = sortAndSplitNavCategories(input, 4);
      assert.strictEqual(primaryCategories.length, 3);
      assert.strictEqual(overflowCategories.length, 0);
    });

    it("F. CONCRETE ITEM PRESERVATION: returned categories preserve original PublicCategory data including subcategories", () => {
      const sub = [{ id: 101, name: "Sub 1", slug: "sub-1", isActive: true }];
      const input: PublicCategory[] = [
        { id: 1, name: "Skincare", slug: "skincare", sortOrder: 1, image: "/skin.jpg", isActive: true, subcategories: sub },
      ];

      const { primaryCategories } = sortAndSplitNavCategories(input);
      assert.strictEqual(primaryCategories[0].id, 1);
      assert.strictEqual(primaryCategories[0].name, "Skincare");
      assert.strictEqual(primaryCategories[0].slug, "skincare");
      assert.strictEqual(primaryCategories[0].image, "/skin.jpg");
      assert.strictEqual(primaryCategories[0].subcategories, sub);
    });

    it("G. TIE BREAK: same sortOrder sorts lower id first", () => {
      const input: PublicCategory[] = [
        { id: 99, name: "B", slug: "b", sortOrder: 5, subcategories: [] },
        { id: 12, name: "A", slug: "a", sortOrder: 5, subcategories: [] },
      ];

      const { primaryCategories } = sortAndSplitNavCategories(input);
      assert.deepStrictEqual(primaryCategories.map((c) => c.id), [12, 99]);
    });

    it("H. DEFAULT BUDGET: calling helper without second argument uses exactly DESKTOP_NAV_PRIMARY_BUDGET (4)", () => {
      assert.strictEqual(DESKTOP_NAV_PRIMARY_BUDGET, 4);

      const input: PublicCategory[] = [
        { id: 1, name: "A", slug: "a", sortOrder: 1, subcategories: [] },
        { id: 2, name: "B", slug: "b", sortOrder: 2, subcategories: [] },
        { id: 3, name: "C", slug: "c", sortOrder: 3, subcategories: [] },
        { id: 4, name: "D", slug: "d", sortOrder: 4, subcategories: [] },
        { id: 5, name: "E", slug: "e", sortOrder: 5, subcategories: [] },
      ];

      const { primaryCategories, overflowCategories } = sortAndSplitNavCategories(input);
      assert.strictEqual(primaryCategories.length, 4);
      assert.strictEqual(overflowCategories.length, 1);
    });

    it("fail-closed: invalid budget input throws an Error", () => {
      assert.throws(() => sortAndSplitNavCategories([], -1), /Invalid navigation category budget/);
      assert.throws(() => sortAndSplitNavCategories([], 2.5), /Invalid navigation category budget/);
      assert.throws(() => sortAndSplitNavCategories([], "4" as unknown as number), /Invalid navigation category budget/);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Navbar Desktop & Mobile Rendering Contract
  // ---------------------------------------------------------------------------
  describe("Navbar Component Rendering & Responsive Navigation Contract", () => {
    const testCategories: PublicCategory[] = [
      {
        id: 1,
        name: "Skincare",
        slug: "skincare",
        sortOrder: 1,
        isActive: true,
        subcategories: [
          { id: 11, name: "Serum", slug: "serum", isActive: true },
          { id: 12, name: "Inactive Sub", slug: "inactive-sub", isActive: false },
          { id: 13, name: "Toner", slug: "toner", isActive: true },
        ],
      },
      {
        id: 2,
        name: "Haircare",
        slug: "haircare",
        sortOrder: 2,
        isActive: true,
        subcategories: [],
      },
      {
        id: 3,
        name: "Cosmetics",
        slug: "cosmetics",
        sortOrder: 3,
        isActive: true,
        subcategories: [
          { id: 31, name: "Lipstick", slug: "lipstick", isActive: true },
        ],
      },
      {
        id: 4,
        name: "Perfume",
        slug: "perfume",
        sortOrder: 4,
        isActive: true,
        subcategories: [],
      },
      {
        id: 5,
        name: "Food",
        slug: "food",
        sortOrder: 5,
        isActive: true,
        subcategories: [
          { id: 51, name: "Honey", slug: "honey", isActive: true },
        ],
      },
      {
        id: 99,
        name: "Inactive Category",
        slug: "inactive-category",
        sortOrder: 0,
        isActive: false,
        subcategories: [],
      },
    ];

    it("A. DESKTOP_NAV_PRIMARY_BUDGET constant is exactly 4", () => {
      assert.strictEqual(DESKTOP_NAV_PRIMARY_BUDGET, 4);
    });

    it("B. Navbar desktop uses lg breakpoint (hidden lg:inline-flex), not md ownership", () => {
      const navbarSource = fs.readFileSync(
        path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
        "utf8"
      );

      assert.ok(navbarSource.includes("hidden lg:inline-flex"));
      assert.ok(!navbarSource.includes("md:flex"));
      assert.ok(!navbarSource.includes("window.innerWidth"));
    });

    it("C. primary category names are Next.js Link routes with /shop?category={slug}", () => {
      const html = renderToStaticMarkup(
        React.createElement<NavbarProps>(Navbar, {
          initialCategories: testCategories,
          disableSelfFetch: true,
          initialMegaMenuOpen: true,
        })
      );

      // Primary categories: skincare, haircare, cosmetics, perfume
      assert.ok(html.includes('href="/shop?category=skincare"'));
      assert.ok(html.includes('href="/shop?category=haircare"'));
      assert.ok(html.includes('href="/shop?category=cosmetics"'));
      assert.ok(html.includes('href="/shop?category=perfume"'));
    });

    it("D. Categories ▾ mega menu renders active categories into the mega-menu", () => {
      const html = renderToStaticMarkup(
        React.createElement<NavbarProps>(Navbar, {
          initialCategories: testCategories,
          disableSelfFetch: true,
          initialMegaMenuOpen: true,
        })
      );

      // Categories ▾ trigger exists
      assert.ok(html.includes("Categories ▾"));

      // Category Food is rendered
      assert.ok(html.includes('href="/shop?category=food"'));

      // Inactive category is excluded
      assert.ok(!html.includes('href="/shop?category=inactive-category"'));
    });

    it("E. More button is removed from desktop nav (approved pre-Phase-6 cleanup)", () => {
      const html = renderToStaticMarkup(
        React.createElement<NavbarProps>(Navbar, {
          initialCategories: testCategories,
          disableSelfFetch: true,
        })
      );

      assert.ok(!html.includes('aria-label="More categories"'));
      assert.ok(!html.includes('>More</span>'));
    });

    it("F. Compact Category Picker renders direct category Link and omits subcategory links", () => {
      const html = renderToStaticMarkup(
        React.createElement<NavbarProps>(Navbar, {
          initialCategories: testCategories,
          disableSelfFetch: true,
          initialMegaMenuOpen: true,
        })
      );

      // Food category links directly
      assert.ok(html.includes('href="/shop?category=food"'));
      // Subcategories are strictly omitted from compact category picker
      assert.ok(!html.includes('subcategory=honey'));
    });

    it("G. drawer and compact category picker render direct top-level category links", () => {
      const navbarSource = fs.readFileSync(
        path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
        "utf8"
      );

      // Verify direct category link structure in sidebar
      assert.ok(navbarSource.includes('href={`/shop?category=${encodeURIComponent(category.slug)}`}'));
      assert.ok(navbarSource.includes('onClick={closeMenu}'));
    });

    it("H. drawer renders PURE HAVEN BD, close button, and store links", () => {
      const navbarSource = fs.readFileSync(
        path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
        "utf8"
      );

      assert.ok(navbarSource.includes('PURE HAVEN BD'));
      assert.ok(navbarSource.includes('aria-label="Close menu"'));
      assert.ok(navbarSource.includes('href="/shop"'));
    });

    it("I. drawer categories omit subcategory disclosure accordions", () => {
      const navbarSource = fs.readFileSync(
        path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
        "utf8"
      );

      assert.ok(
        !navbarSource.includes("displaySubs"),
        "Drawer must not render displaySubs"
      );
      assert.ok(
        !navbarSource.includes("hasActiveSubs"),
        "Drawer must not render hasActiveSubs disclosure logic"
      );
    });

    it("J. inactive categories and subcategories are strictly excluded from navigation paths", () => {
      const html = renderToStaticMarkup(
        React.createElement<NavbarProps>(Navbar, {
          initialCategories: testCategories,
          disableSelfFetch: true,
          initialMegaMenuOpen: true,
        })
      );

      assert.ok(!html.includes('inactive-sub'), "Inactive subcategory must not be in rendered markup");
      assert.ok(!html.includes('subcategory='), "Navbar compact category picker must not render subcategory links");
    });

    it("K. SafeMobileBottomNav remains untouched in repository layout architecture", () => {
      const bottomNavSource = fs.readFileSync(
        path.join(process.cwd(), "components", "layout", "SafeMobileBottomNav.tsx"),
        "utf8"
      );

      assert.ok(bottomNavSource.includes("export default function SafeMobileBottomNav()"));
    });

    it("L. search preservation: retains pre-Task-8 trimmed-query redirect and no native GET form attributes", () => {
      const navbarSource = fs.readFileSync(
        path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
        "utf8"
      );

      // Verify exact pre-Task-8 contract is retained
      assert.ok(navbarSource.includes("e.preventDefault()"), "Must call e.preventDefault()");
      assert.ok(navbarSource.includes("searchText.trim()"), "Must trim search query");
      assert.ok(navbarSource.includes("window.location.href"), "Must use window.location.href");
      assert.ok(navbarSource.includes("/shop?q="), "Must navigate to /shop?q=");
      assert.ok(navbarSource.includes("encodeURIComponent(q)"), "Must encode query parameter");

      // Verify Task-8 native GET additions are NOT present
      assert.ok(!navbarSource.includes('action="/shop"'), "Must NOT use native form action");
      assert.ok(!navbarSource.includes('method="GET"'), "Must NOT use native GET method");
      assert.ok(!navbarSource.includes('name="q"'), "Must NOT use native name='q' attribute");
    });

    it("M. responsive breakpoint contract: desktop controls use lg: breakpoint, menu trigger has aria-label and no md:hidden dead zone", () => {
      const navbarSource = fs.readFileSync(
        path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
        "utf8"
      );

      // Desktop nav controls own >= 1024px
      assert.ok(navbarSource.includes("lg:inline-flex"), "Desktop controls must use lg:inline-flex");

      // Verify no 768-1023 dead zone (trigger must not hide at md)
      const triggerIdx = navbarSource.indexOf('aria-label="Open menu"');
      assert.ok(triggerIdx !== -1, "Menu trigger button must exist");
      const triggerSnippet = navbarSource.slice(triggerIdx - 200, triggerIdx + 50);
      assert.ok(!triggerSnippet.includes("md:hidden"), "Mobile menu trigger must NOT hide at md");
    });
  });
});
