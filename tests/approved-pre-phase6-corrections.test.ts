import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicCategory } from "@/lib/defaultCategories";
import Navbar, { type NavbarProps } from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import AdminNav from "@/components/admin/AdminNav";
import SiteBrand from "@/components/site/SiteBrand";

const testCategories: PublicCategory[] = [
  {
    id: 1,
    name: "Cosmetics",
    slug: "cosmetics",
    sortOrder: 1,
    isActive: true,
    subcategories: [
      { id: 11, name: "Lipstick", slug: "lipstick", isActive: true },
      { id: 12, name: "Foundation", slug: "foundation", isActive: true },
      { id: 13, name: "Disabled Sub", slug: "disabled-sub", isActive: false },
    ],
  },
  {
    id: 2,
    name: "Skincare",
    slug: "skincare",
    sortOrder: 2,
    isActive: true,
    subcategories: [
      { id: 21, name: "Serum", slug: "serum", isActive: true },
    ],
  },
  {
    id: 99,
    name: "Inactive Category",
    slug: "inactive-category",
    sortOrder: 99,
    isActive: false,
    subcategories: [],
  },
];

describe("Approved Pre-Phase-6 Bounded Corrections Test Suite", () => {
  // 1. exact Categories ▾ label
  it("1. exact 'Categories ▾' label is present in desktop navbar", () => {
    const html = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
      })
    );

    assert.ok(html.includes("Categories ▾"), "Must contain exact 'Categories ▾' text");
    assert.ok(!html.includes("Categories⌄"), "Must not use 'Categories⌄'");
    assert.ok(!html.includes(">CATEGORIES<"), "Must not use uppercase in desktop trigger");
  });

  // 2. exact PURE HAVEN BD brand
  it("2. exact 'PURE HAVEN BD' brand is rendered in SiteBrand and Navbar", () => {
    const brandHtml = renderToStaticMarkup(React.createElement(SiteBrand));
    assert.ok(brandHtml.includes("PURE HAVEN BD"), "SiteBrand must contain 'PURE HAVEN BD'");
    assert.ok(!brandHtml.includes(">PURE<"), "SiteBrand must not isolate 'PURE' as top word");

    const navHtml = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
      })
    );
    assert.ok(navHtml.includes("PURE HAVEN BD"), "Navbar must contain 'PURE HAVEN BD'");
  });

  // 3. account action icon-only
  it("3. account action in navbar is icon-only with aria-label='Account'", () => {
    const html = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
      })
    );

    assert.ok(html.includes('aria-label="Account"'), "Must have aria-label='Account'");
    
    // Check that desktop navbar controls do not display text beside the icon
    const navbarSource = fs.readFileSync(
      path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
      "utf8"
    );
    assert.ok(!navbarSource.includes("Create Account</span>"), "Must not have Create Account beside icon");
    assert.ok(!navbarSource.includes("Sign In</span>"), "Must not have Sign In beside icon");
    assert.ok(!navbarSource.includes("My Account</span>"), "Must not have My Account beside icon");
  });

  // 4 & 5. logged-out / logged-in account destination
  it("4 & 5. account destination defaults to /user-login when logged out and supports /customer/dashboard when authenticated", () => {
    const html = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
      })
    );
    // Initial server render is logged out
    assert.ok(html.includes('href="/user-login"'), "Logged-out account must point to /user-login");
    
    const navbarSource = fs.readFileSync(
      path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
      "utf8"
    );
    assert.ok(navbarSource.includes('isLoggedIn ? "/customer/dashboard" : "/user-login"'));
  });

  // 6. visible mobile Contact action
  it("6. visible mobile Contact action with aria-label='Contact' exists", () => {
    const html = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
      })
    );
    assert.ok(html.includes('aria-label="Contact"'), "Mobile Contact action must have aria-label='Contact'");
    assert.ok(html.includes('href="/contact"'), "Contact action must link to /contact");
  });

  // 7. desktop Contact
  it("7. desktop Contact link exists with exact text 'Contact'", () => {
    const html = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
      })
    );
    assert.ok(html.includes('>Contact</'), "Must contain desktop 'Contact' text link");
  });

  // 8. Shop link
  it("8. Shop link routes to /shop and exists on desktop and drawer", () => {
    const html = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
      })
    );
    assert.ok(html.includes('href="/shop"'), "Must link to /shop");
    assert.ok(html.includes('>Shop<') || html.includes('>Shop</'), "Must display 'Shop'");
  });

  // 9. database-driven categories
  it("9. active categories are rendered into mega menu and drawer", () => {
    const html = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
        initialMegaMenuOpen: true,
      })
    );
    assert.ok(html.includes("Cosmetics"), "Must contain Cosmetics");
    assert.ok(html.includes("Skincare"), "Must contain Skincare");
    assert.ok(!html.includes("Inactive Category"), "Must NOT contain inactive category");
  });

  // 10. compact category picker and drawer do NOT render subcategories or View All links
  it("10. compact category picker and drawer do NOT render subcategories or View All links", () => {
    const html = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
        initialMegaMenuOpen: true,
      })
    );
    assert.ok(!html.includes("View All"), "Must NOT contain View All in category picker");
    assert.ok(!html.includes("Lipstick"), "Must NOT contain subcategories in category picker");
    const navbarSource = fs.readFileSync(
      path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
      "utf8"
    );
    assert.ok(!navbarSource.includes("displaySubs"), "Must NOT contain displaySubs in category picker");
  });

  // 11. parent category direct navigation in SafeMobileBottomNav
  it("11. SafeMobileBottomNav category link navigates directly to /shop?category={slug}", () => {
    const bottomNavSource = fs.readFileSync(
      path.join(process.cwd(), "components", "layout", "SafeMobileBottomNav.tsx"),
      "utf8"
    );
    // Must NOT have e.preventDefault() on category link
    assert.ok(!bottomNavSource.includes("e.preventDefault()"));
    assert.ok(bottomNavSource.includes('href={`/shop?category=${encodeURIComponent(category.slug)}`}'));
  });

  // 12. SafeMobileBottomNav menu renders top-level category links directly without nested accordions
  it("12. SafeMobileBottomNav menu renders top-level category links directly without nested accordions", () => {
    const bottomNavSource = fs.readFileSync(
      path.join(process.cwd(), "components", "layout", "SafeMobileBottomNav.tsx"),
      "utf8"
    );
    assert.ok(!bottomNavSource.includes("hasSub"), "Must NOT retain subcategory disclosure accordions in SafeMobileBottomNav");
    assert.ok(bottomNavSource.includes("categories.map"), "Must map top-level categories directly");
  });

  // 13 & 14. category and subcategory chip URL state
  it("13 & 14. app/shop/page.tsx renders subcategory chips with category and subcategory query params", () => {
    const shopSource = fs.readFileSync(
      path.join(process.cwd(), "app", "shop", "page.tsx"),
      "utf8"
    );
    assert.ok(shopSource.includes("shopHref({ category: activeCategory.slug, sort, q: query })"), "Must link All chip to category");
    assert.ok(shopSource.includes("shopHref({\n                      category: activeCategory.slug,\n                      subcategory: item.slug"), "Must link subcategory chip");
  });

  // 15. active chip state
  it("15. active subcategory chip has distinctive selected styling", () => {
    const shopSource = fs.readFileSync(
      path.join(process.cwd(), "app", "shop", "page.tsx"),
      "utf8"
    );
    assert.ok(shopSource.includes('!subcategory\n                    ? "bg-[#2e221d] !text-white'), "All chip must have active style when !subcategory");
    assert.ok(shopSource.includes('isSelected\n                        ? "bg-[#2e221d] !text-white'), "Subcategory chip must have active style when selected");
  });

  // 16. zero-active-subcategory rendering
  it("16. category with zero active subcategories omits chip bar", () => {
    const shopSource = fs.readFileSync(
      path.join(process.cwd(), "app", "shop", "page.tsx"),
      "utf8"
    );
    assert.ok(shopSource.includes("activeCategory && subcategories.length > 0 ? ("));
  });

  // 17. no duplicate Shop by Subcategory
  it("17. app/shop/page.tsx does NOT contain duplicate 'Shop by Subcategory' carousel", () => {
    const shopSource = fs.readFileSync(
      path.join(process.cwd(), "app", "shop", "page.tsx"),
      "utf8"
    );
    assert.ok(!shopSource.includes("Shop by Subcategory"), "Must NOT contain old duplicate carousel 'Shop by Subcategory'");
  });

  // 18. /admin/login footer link
  it("18. Footer contains subtle discoverable Admin Login link to /admin/login", () => {
    const footerHtml = renderToStaticMarkup(React.createElement(Footer));
    assert.ok(footerHtml.includes('href="/admin/login"'), "Footer must link to /admin/login");
    assert.ok(footerHtml.includes("Admin Login"), "Footer must contain 'Admin Login' text");
  });

  // 19. no customer-navbar Admin Login
  it("19. Customer navbar does NOT contain Admin Login", () => {
    const navHtml = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
      })
    );
    assert.ok(!navHtml.includes("/admin/login"), "Navbar must NOT contain /admin/login");
    assert.ok(!navHtml.includes("Admin Login"), "Navbar must NOT contain 'Admin Login'");
  });

  // 20. Payment Verification in shared AdminNav
  it("20. AdminNav contains exact visible label 'Payment Verification' linking to /admin/payments", () => {
    const adminNavHtml = renderToStaticMarkup(React.createElement(AdminNav));
    assert.ok(adminNavHtml.includes('href="/admin/payments"'), "AdminNav must link to /admin/payments");
    assert.ok(adminNavHtml.includes("Payment Verification"), "AdminNav must display 'Payment Verification'");
  });

  // 21. /admin/payments page uses/reuses shared AdminNav
  it("21. app/admin/payments/page.tsx imports and renders shared AdminNav", () => {
    const paymentsPageSource = fs.readFileSync(
      path.join(process.cwd(), "app", "admin", "payments", "page.tsx"),
      "utf8"
    );
    assert.ok(paymentsPageSource.includes('import AdminNav from "@/components/admin/AdminNav";'), "Must import AdminNav");
    assert.ok(paymentsPageSource.includes("<AdminNav />"), "Must render <AdminNav />");
    assert.ok(!paymentsPageSource.includes('const navClass ='), "Must NOT use isolated local navClass");
  });

  // 22. Storefront Left Pushed Sidebar geometry and responsive body class contract
  it("22. Storefront Left Pushed Sidebar contract: body.ph-menu-open shifts content on md+ without modal backdrop", () => {
    const globalsCss = fs.readFileSync(
      path.join(process.cwd(), "app", "globals.css"),
      "utf8"
    );
    assert.ok(globalsCss.includes("body.ph-menu-open"), "globals.css must define body.ph-menu-open rules");
    assert.ok(globalsCss.includes("padding-left: 260px"), "Must define tablet padding-left: 260px");
    assert.ok(globalsCss.includes("padding-left: 280px"), "Must define desktop padding-left: 280px");

    const navbarSource = fs.readFileSync(
      path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
      "utf8"
    );
    assert.ok(navbarSource.includes('document.body.classList.add("ph-menu-open")'), "Navbar must toggle ph-menu-open on body");
    assert.ok(navbarSource.includes('id="storefront-menu-sidebar"'), "Sidebar must have semantic id storefront-menu-sidebar");
    assert.ok(navbarSource.includes('md:hidden fixed inset-0'), "Light overlay must be md:hidden (only on mobile, strictly absent on md+)");
  });

  // 23. Compact Category Picker contract
  it("23. Compact Category Picker contract: floating bounded panel, top-level categories only, canonical URLs", () => {
    const html = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
        initialMegaMenuOpen: true,
      })
    );
    assert.ok(html.includes('id="desktop-category-picker"'), "Must render #desktop-category-picker");
    assert.ok(html.includes('href="/shop?category=cosmetics"'), "Must link directly to canonical category URL");
    assert.ok(html.includes('href="/shop?category=skincare"'), "Must link directly to canonical category URL");
    assert.ok(!html.includes('subcategory='), "Must NOT contain any subcategory links inside compact category picker");
  });

  // 24. Categories Panel navbar container alignment, no internal heading, bottom collapse control
  it("24. Categories panel aligns across main navbar container, omits internal heading, and includes bottom-center collapse control", () => {
    const html = renderToStaticMarkup(
      React.createElement<NavbarProps>(Navbar, {
        initialCategories: testCategories,
        disableSelfFetch: true,
        initialMegaMenuOpen: true,
      })
    );
    assert.ok(html.includes('hidden md:block'), "Panel must be visible on tablet and desktop via hidden md:block");
    assert.ok(html.includes('hidden md:inline-flex'), "Categories trigger must be visible on tablet and desktop via hidden md:inline-flex");
    assert.ok(html.includes('inset-x-0'), "Panel must align across main navbar container using inset-x-0");
    assert.ok(html.includes('w-full'), "Panel must span w-full of the navbar container");
    assert.ok(!html.includes('>CATEGORIES<'), "Panel must NOT have internal CATEGORIES heading");
    assert.ok(html.includes('aria-label="Collapse categories"'), "Must contain bottom-center collapse control with aria-label='Collapse categories'");
  });

  // 25. computeCategoryGrid pure logic: fixed responsive columns, max 3 rows, See All on overflow
  it("25. computeCategoryGrid pure solver enforces fixed responsive columns, max 3 rows, and conditional See All Categories →", async () => {
    const { computeCategoryGrid } = await import("@/components/layout/Navbar");

    // Case A: 6 categories on desktop: exactly 6 columns, all 6 in first row, no balancing reduction
    const sixCats = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      name: `Category ${i + 1}`,
      slug: `category-${i + 1}`,
      sortOrder: i + 1,
      isActive: true,
      subcategories: [],
    }));
    const resA = computeCategoryGrid(sixCats, 6);
    assert.equal(resA.hasOverflow, false);
    assert.equal(resA.cols, 6);
    assert.equal(resA.displayItems.length, 6);

    // Case B: 7 categories on desktop: exactly 6 columns (Row 1: 6, Row 2: 1)
    const sevenCats = Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      name: `Category ${i + 1}`,
      slug: `category-${i + 1}`,
      sortOrder: i + 1,
      isActive: true,
      subcategories: [],
    }));
    const resB = computeCategoryGrid(sevenCats, 6);
    assert.equal(resB.hasOverflow, false);
    assert.equal(resB.cols, 6);
    assert.equal(resB.displayItems.length, 7);

    // Case C: 18 categories fits exactly in 3 rows of 6 columns, no overflow
    const eighteenCats = Array.from({ length: 18 }, (_, i) => ({
      id: i + 1,
      name: `Category ${i + 1}`,
      slug: `category-${i + 1}`,
      sortOrder: i + 1,
      isActive: true,
      subcategories: [],
    }));
    const resC = computeCategoryGrid(eighteenCats, 6);
    assert.equal(resC.hasOverflow, false);
    assert.equal(resC.cols, 6);
    assert.equal(resC.displayItems.length, 18);

    // Case D: 19 categories exceeds 18-slot capacity: exactly 17 categories + See All slot, NEVER row 4
    const nineteenCats = Array.from({ length: 19 }, (_, i) => ({
      id: i + 1,
      name: `Category ${i + 1}`,
      slug: `category-${i + 1}`,
      sortOrder: i + 1,
      isActive: true,
      subcategories: [],
    }));
    const resD = computeCategoryGrid(nineteenCats, 6);
    assert.equal(resD.hasOverflow, true);
    assert.equal(resD.cols, 6);
    assert.equal(resD.displayItems.length, 17); // 17 items + 1 See All slot = 18 slots (exactly 3 rows of 6)

    // Case E: Tablet fixture with 4 categories: exactly 1 row of 4 columns
    const fourCats = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      name: `Category ${i + 1}`,
      slug: `category-${i + 1}`,
      sortOrder: i + 1,
      isActive: true,
      subcategories: [],
    }));
    const resE = computeCategoryGrid(fourCats, 4);
    assert.equal(resE.hasOverflow, false);
    assert.equal(resE.cols, 4);
    assert.equal(resE.displayItems.length, 4);

    // Case F: Tablet fixture with 5 categories: 4 columns (Row 1: 4, Row 2: 1)
    const fiveCats = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      name: `Category ${i + 1}`,
      slug: `category-${i + 1}`,
      sortOrder: i + 1,
      isActive: true,
      subcategories: [],
    }));
    const resF = computeCategoryGrid(fiveCats, 4);
    assert.equal(resF.hasOverflow, false);
    assert.equal(resF.cols, 4);
    assert.equal(resF.displayItems.length, 5);

    // Case G: Tablet overflow: 15 categories exceeds 12 slots -> 11 categories + See All in slot 12
    const fifteenCats = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      name: `Category ${i + 1}`,
      slug: `category-${i + 1}`,
      sortOrder: i + 1,
      isActive: true,
      subcategories: [],
    }));
    const resG = computeCategoryGrid(fifteenCats, 4);
    assert.equal(resG.hasOverflow, true);
    assert.equal(resG.cols, 4);
    assert.equal(resG.displayItems.length, 11); // 11 items + 1 See All slot = 12 slots (3 rows of 4)

    // Case H: Mobile responsive capacity: 2 columns x 3 rows = 6 slots
    const eightCats = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      name: `Category ${i + 1}`,
      slug: `category-${i + 1}`,
      sortOrder: i + 1,
      isActive: true,
      subcategories: [],
    }));
    const resH = computeCategoryGrid(eightCats, 2);
    assert.equal(resH.hasOverflow, true);
    assert.equal(resH.cols, 2);
    assert.equal(resH.displayItems.length, 5); // 5 items + 1 See All slot = 6 slots (3 rows of 2)
  });

  // 26. Category card hover styling: restrained ivory hover, no solid dark background
  it("26. Category card hover styling removes solid dark treatment in favor of restrained ivory hover", () => {
    const navbarSource = fs.readFileSync(
      path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
      "utf8"
    );
    // Find category card Link inside desktop-category-picker
    const pickerSection = navbarSource.slice(
      navbarSource.indexOf('id="desktop-category-picker"')
    );
    assert.ok(
      !pickerSection.includes("hover:bg-[#2e221d]"),
      "Navbar category cards must NOT turn solid dark (#2e221d) on hover"
    );
    assert.ok(
      !pickerSection.includes("hover:text-white"),
      "Navbar category cards must NOT turn text white on hover"
    );
    assert.ok(
      pickerSection.includes("hover:bg-[#f8f3ef]"),
      "Navbar category cards must use restrained ivory hover (hover:bg-[#f8f3ef])"
    );
    assert.ok(
      pickerSection.includes("hover:border-[#d8bfb2]"),
      "Navbar category cards must use subtle warm border on hover (hover:border-[#d8bfb2])"
    );
  });

  // 27. Dedicated /categories route
  it("26. /categories route exists, renders top-level category cards, and omits product grid", () => {
    const categoriesSource = fs.readFileSync(
      path.join(process.cwd(), "app", "categories", "page.tsx"),
      "utf8"
    );
    assert.ok(categoriesSource.includes("Categories"), "Must display Categories heading");
    assert.ok(categoriesSource.includes("Home / Categories") || categoriesSource.includes("Home"), "Must have breadcrumb");
    assert.ok(categoriesSource.includes("/shop?category="), "Must link categories to canonical shop URLs");
    assert.ok(!categoriesSource.includes("ProgressiveProductGrid"), "Must NOT render ProgressiveProductGrid");
    assert.ok(!categoriesSource.includes("product-grid"), "Must NOT render product grid");
  });

  // 27. Selected All chip high contrast fix
  it("27. Selected All chip on /shop includes !text-white with high contrast against dark background", () => {
    const shopSource = fs.readFileSync(
      path.join(process.cwd(), "app", "shop", "page.tsx"),
      "utf8"
    );
    assert.ok(shopSource.includes("!text-white"), "Shop page must include !text-white on selected chips");
    assert.ok(shopSource.includes("bg-[#2e221d]"), "Selected chips must have dark background #2e221d");
  });

  // 28. Left sidebar CATEGORIES heading with All → link to /categories
  it("28. Left sidebar CATEGORIES heading has visible All → link to /categories in the category section", () => {
    const navbarSource = fs.readFileSync(
      path.join(process.cwd(), "components", "layout", "Navbar.tsx"),
      "utf8"
    );
    // Ensure sidebar has Categories heading and All → link to /categories
    assert.ok(navbarSource.includes('href="/categories"'), "Navbar sidebar must link to /categories");
    assert.ok(navbarSource.includes("Categories"), "Navbar sidebar must retain Categories section heading");
    assert.ok(navbarSource.includes("All"), "Navbar sidebar must contain visible 'All' control");
    assert.ok(navbarSource.includes("→"), "Navbar sidebar must contain right-arrow icon next to All");
    // Ensure All → link is not placed inside Quick Links
    const categoriesIdx = navbarSource.indexOf('href="/categories"');
    const quickLinksIdx = navbarSource.indexOf("Quick Links");
    assert.ok(categoriesIdx < quickLinksIdx, "Categories All → link must be before Quick Links");
  });

  // 29. /categories explicit 6 / 4 / 2 grid and controlled empty/failure states
  it("29. /categories enforces 6 / 4 / 2 responsive grid and controlled empty/failure states", () => {
    const categoriesSource = fs.readFileSync(
      path.join(process.cwd(), "app", "categories", "page.tsx"),
      "utf8"
    );
    assert.ok(
      categoriesSource.includes("grid-cols-2 md:grid-cols-4 lg:grid-cols-6"),
      "/categories must use 2 cols on mobile, 4 on tablet, 6 on desktop"
    );
    assert.ok(
      !categoriesSource.includes("line-clamp-2"),
      "/categories must NOT artificially truncate category names with line-clamp-2"
    );
    assert.ok(
      categoriesSource.includes("break-words"),
      "/categories must allow natural text wrapping with break-words"
    );
    assert.ok(
      categoriesSource.includes("Browse all product categories."),
      "Must use neutral approved copy"
    );
    assert.ok(
      !categoriesSource.includes("curated collection of authentic"),
      "Must NOT use unsupported promotional claims"
    );
    assert.ok(
      categoriesSource.includes("Unable to load categories at this time."),
      "Must provide controlled failure state on database error"
    );
  });
});
