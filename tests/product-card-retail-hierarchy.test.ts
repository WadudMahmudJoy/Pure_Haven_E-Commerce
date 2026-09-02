import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  resolveEyebrow,
  resolveCardBadge,
  resolveCardCTA,
  formatCardPrice,
} from "../components/ui/productCardPresentation";

describe("Task 6 — ProductCard Retail Hierarchy & Presentation Contract", () => {
  // ---------------------------------------------------------------------------
  // 1. CTA Contract & Single OOS Authority
  // ---------------------------------------------------------------------------
  it("A. CTA OOS: when out of stock, label is 'Add to Cart' and disabled is true (no duplicate OOS text)", () => {
    const cta = resolveCardCTA({
      isOutOfStock: true,
      reachedStockLimit: false,
      justAddedToCart: false,
    });

    assert.strictEqual(
      cta.label,
      "Add to Cart",
      "CTA must NEVER repeat 'Out of Stock'; OOS wording belongs only to the top badge"
    );
    assert.strictEqual(cta.disabled, true, "CTA must be disabled when out of stock");
  });

  it("B. CTA Limit: when stock limit reached and not OOS, label is 'Limit Reached' and disabled is true", () => {
    const cta = resolveCardCTA({
      isOutOfStock: false,
      reachedStockLimit: true,
      justAddedToCart: false,
    });

    assert.strictEqual(cta.label, "Limit Reached");
    assert.strictEqual(cta.disabled, true);
  });

  it("C. CTA Added: when just added to cart and neither higher priority applies, label is 'Added'", () => {
    const cta = resolveCardCTA({
      isOutOfStock: false,
      reachedStockLimit: false,
      justAddedToCart: true,
    });

    assert.strictEqual(cta.label, "Added");
    assert.strictEqual(cta.disabled, false);
  });

  it("D. CTA Default: when in stock, not at limit, not just added, label is 'Add to Cart' and enabled", () => {
    const cta = resolveCardCTA({
      isOutOfStock: false,
      reachedStockLimit: false,
      justAddedToCart: false,
    });

    assert.strictEqual(cta.label, "Add to Cart");
    assert.strictEqual(cta.disabled, false);
  });

  // ---------------------------------------------------------------------------
  // 2. Single Badge Priority Contract (OOS > Promo > Low Stock > null)
  // ---------------------------------------------------------------------------
  it("E. BADGE — OOS: out of stock returns 'Out of Stock' badge", () => {
    const badge = resolveCardBadge({
      stock: 0,
      isOutOfStock: true,
      isLowStock: false,
    });

    assert.ok(badge);
    assert.strictEqual(badge.label, "Out of Stock");
    assert.ok(badge.className.includes("red"));
  });

  it("F. BADGE PRIORITY: OOS takes strict precedence over promotional badges", () => {
    const badge = resolveCardBadge({
      stock: 0,
      isOutOfStock: true,
      isLowStock: false,
      isHotDeal: true,
      badgeText: "50% OFF",
    });

    assert.ok(badge);
    assert.strictEqual(
      badge.label,
      "Out of Stock",
      "OOS must win over promotional badges"
    );
  });

  it("G. PROMO PRIORITY: promotional badges take precedence over low stock", () => {
    const badge = resolveCardBadge({
      stock: 3,
      isOutOfStock: false,
      isLowStock: true,
      badgeText: "20% OFF",
      badgeTone: "sale",
    });

    assert.ok(badge);
    assert.strictEqual(badge.label, "20% OFF");
  });

  it("H. LOW STOCK: 0 < stock <= 5 with no promo returns 'Low Stock' badge", () => {
    const badge = resolveCardBadge({
      stock: 2,
      isOutOfStock: false,
      isLowStock: true,
    });

    assert.ok(badge);
    assert.strictEqual(badge.label, "Low Stock");
    assert.ok(badge.className.includes("amber"));
  });

  it("I. NO BADGE: in-stock with no promo or low-stock returns null", () => {
    const badge = resolveCardBadge({
      stock: 50,
      isOutOfStock: false,
      isLowStock: false,
    });

    assert.strictEqual(badge, null);
  });

  // ---------------------------------------------------------------------------
  // 3. Eyebrow Presentation Contract (subcategoryName > categoryName > null)
  // ---------------------------------------------------------------------------
  it("J. EYEBROW SUBCATEGORY: subcategoryName takes precedence over categoryName", () => {
    assert.strictEqual(
      resolveEyebrow("Skincare", "Face Serums"),
      "Face Serums"
    );
  });

  it("K. EYEBROW CATEGORY: categoryName is used as fallback when subcategoryName is absent", () => {
    assert.strictEqual(
      resolveEyebrow("Skincare", null),
      "Skincare"
    );
    assert.strictEqual(
      resolveEyebrow("Skincare", undefined),
      "Skincare"
    );
  });

  it("L. EYEBROW EMPTY: empty or whitespace-only values produce proper fallback or null", () => {
    assert.strictEqual(resolveEyebrow("Skincare", "   "), "Skincare");
    assert.strictEqual(resolveEyebrow(null, null), null);
    assert.strictEqual(resolveEyebrow("   ", "   "), null);
    assert.strictEqual(resolveEyebrow("", ""), null);
  });

  // ---------------------------------------------------------------------------
  // 4. BDT Price Contract (৳ U+09F3)
  // ---------------------------------------------------------------------------
  it("M. PRICE: formatCardPrice formats with literal Bangladesh Taka sign U+09F3 and no dollar sign", () => {
    const formatted = formatCardPrice(1250);
    assert.strictEqual(formatted, "\u09F31250");
    assert.ok(!formatted.includes("$"), "Price must not contain dollar sign");
  });

  // ---------------------------------------------------------------------------
  // 5. Source Contract & Caller Wiring Verification
  // ---------------------------------------------------------------------------
  describe("Source Contract & Caller Wiring", () => {
    const cardPath = path.join(process.cwd(), "components", "ui", "ProductCard.tsx");
    const cardSource = fs.readFileSync(cardPath, "utf8");

    const gridPath = path.join(process.cwd(), "components", "shop", "ProgressiveProductGrid.tsx");
    const gridSource = fs.readFileSync(gridPath, "utf8");

    it("N. SOURCE CONTRACT — NUMERIC STOCK: removes customer-visible numeric stock text", () => {
      assert.ok(
        !cardSource.includes("Stock: {"),
        "ProductCard must not render customer-facing 'Stock: {stock}'"
      );
      assert.ok(
        !cardSource.includes("Stock: "),
        "ProductCard must not render customer-facing 'Stock: ' label"
      );
    });

    it("O. SOURCE CONTRACT — OOS DUPLICATION: CTA branch does not render 'Out of Stock'", () => {
      assert.ok(
        !cardSource.includes('? "Out of Stock"'),
        "CTA button must not repeat 'Out of Stock'"
      );
    });

    it("P. CALLER CUTOVER: ProgressiveProductGrid forwards images, categoryName, subcategoryName", () => {
      assert.ok(
        gridSource.includes("images={product.images}"),
        "ProgressiveProductGrid must forward images"
      );
      assert.ok(
        gridSource.includes("categoryName={product.categoryName}"),
        "ProgressiveProductGrid must forward categoryName"
      );
      assert.ok(
        gridSource.includes("subcategoryName={product.subcategoryName}"),
        "ProgressiveProductGrid must forward subcategoryName"
      );
    });

    it("Q. CART ISOLATION: Cart item payload retains exact original shape", () => {
      // Must include standard fields: id, name, price, image: imageSrc, category, stock
      assert.ok(cardSource.includes("addToCart({"));
      assert.ok(!cardSource.includes("categoryName:"));
      assert.ok(!cardSource.includes("subcategoryName:"));
      assert.ok(!cardSource.includes("images:"));
    });

    it("R. WISHLIST ISOLATION: Wishlist payload retains exact original shape", () => {
      assert.ok(cardSource.includes("toggleWishlist({"));
      assert.ok(!cardSource.includes("toggleWishlist({\n      id,\n      name,\n      price,\n      image: imageSrc,\n      category,\n      images"));
    });

    // Task-7 carousel behavior is verified by tests/product-card-carousel.test.ts.
  });
});
