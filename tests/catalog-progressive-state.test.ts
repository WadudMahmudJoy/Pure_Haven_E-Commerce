import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deduplicateProducts,
  computeRestorationTarget,
  nextRequestGeneration,
  isCurrentGeneration,
  createProgressiveQueryUrl,
} from "../lib/catalog/progressiveCatalogState";
import type { PublicProductCardDTO } from "../lib/catalog/types";

function createMockCard(id: number, name: string): PublicProductCardDTO {
  return {
    id,
    name,
    price: 100,
    compareAtPrice: null,
    image: "/test.png",
    images: ["/test.png"],
    category: "Skincare",
    categoryName: "Skincare",
    subcategoryName: null,
    stock: 10,
    isHotDeal: false,
    isUpcoming: false,
    badgeText: null,
    badgeTone: "sale",
    hasVariants: false,
  };
}

describe("Task 1 — Progressive Catalog State Unit Tests", () => {
  describe("Deduplication by Product ID", () => {
    it("appends new incoming items and preserves ordering while discarding duplicate IDs", () => {
      const existing: PublicProductCardDTO[] = [
        createMockCard(1, "Product 1"),
        createMockCard(2, "Product 2"),
        createMockCard(3, "Product 3"),
      ];

      const incoming: PublicProductCardDTO[] = [
        createMockCard(3, "Product 3 (Duplicate)"),
        createMockCard(4, "Product 4"),
        createMockCard(5, "Product 5"),
      ];

      const merged = deduplicateProducts(existing, incoming);
      assert.strictEqual(merged.length, 5);
      assert.deepStrictEqual(
        merged.map((p) => p.id),
        [1, 2, 3, 4, 5]
      );
      // Ensures the original item with id 3 is preserved
      assert.strictEqual(merged[2].name, "Product 3");
    });
  });

  describe("Restoration Target Calculation", () => {
    it("returns exact targetPage without normalization for page <= 10", () => {
      const page1 = computeRestorationTarget(1, 10);
      assert.strictEqual(page1.targetPage, 1);
      assert.strictEqual(page1.shouldNormalizeUrl, false);

      const page3 = computeRestorationTarget(3, 10);
      assert.strictEqual(page3.targetPage, 3);
      assert.strictEqual(page3.shouldNormalizeUrl, false);

      const page10 = computeRestorationTarget(10, 10);
      assert.strictEqual(page10.targetPage, 10);
      assert.strictEqual(page10.shouldNormalizeUrl, false);
    });

    it("clamps targetPage to 10 and sets shouldNormalizeUrl to true for page > 10", () => {
      const page15 = computeRestorationTarget(15, 10);
      assert.strictEqual(page15.targetPage, 10);
      assert.strictEqual(page15.shouldNormalizeUrl, true);

      const page100 = computeRestorationTarget(100, 10);
      assert.strictEqual(page100.targetPage, 10);
      assert.strictEqual(page100.shouldNormalizeUrl, true);
    });
  });

  describe("Race & Request Generation Safety", () => {
    it("increments request generation counter deterministically", () => {
      const gen1 = 1;
      const gen2 = nextRequestGeneration(gen1);
      assert.strictEqual(gen2, 2);
    });

    it("identifies stale vs current generation responses", () => {
      const currentGen = 3;
      assert.strictEqual(isCurrentGeneration(3, currentGen), true);
      assert.strictEqual(isCurrentGeneration(2, currentGen), false);
      assert.strictEqual(isCurrentGeneration(1, currentGen), false);
    });
  });

  describe("Progressive Query URL Construction", () => {
    it("builds query URL string preserving category, subcategory, search, sort, page and explicit pageSize=24", () => {
      const url = createProgressiveQueryUrl({
        category: "skincare",
        subcategory: "serum",
        q: "cream",
        sort: "price-asc",
        page: 2,
      });

      assert.ok(url.startsWith("/api/products?"), "URL must start with /api/products?");
      const query = url.split("?")[1] ?? "";
      const params = new URLSearchParams(query);

      assert.strictEqual(params.get("view"), "public");
      assert.strictEqual(params.get("pageSize"), "24");
      assert.strictEqual(params.get("category"), "skincare");
      assert.strictEqual(params.get("subcategory"), "serum");
      assert.strictEqual(params.get("q"), "cream");
      assert.strictEqual(params.get("sort"), "price-asc");
      assert.strictEqual(params.get("page"), "2");
    });

    it("omits empty or null filter parameters from the URL while preserving view and pageSize", () => {
      const url = createProgressiveQueryUrl({
        category: "skincare",
        subcategory: null,
        q: null,
        sort: "latest",
        page: 1,
      });

      assert.ok(url.startsWith("/api/products?"));
      const query = url.split("?")[1] ?? "";
      const params = new URLSearchParams(query);

      assert.strictEqual(params.get("view"), "public");
      assert.strictEqual(params.get("pageSize"), "24");
      assert.strictEqual(params.get("category"), "skincare");
      assert.strictEqual(params.get("sort"), "latest");
      assert.strictEqual(params.get("page"), "1");
      assert.strictEqual(params.has("subcategory"), false);
      assert.strictEqual(params.has("q"), false);
    });
  });
});
