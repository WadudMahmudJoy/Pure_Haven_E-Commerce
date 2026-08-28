import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePublicCatalogParams,
  parseAdminCatalogParams,
  CatalogQueryParamError,
  MAX_PUBLIC_PAGE,
  MAX_ADMIN_PAGE,
} from "../lib/catalog/queryParams";

describe("Task 1 — Catalog Query Params Unit Tests", () => {
  describe("Public Catalog Parameter Normalization", () => {
    it("normalizes empty/missing inputs to exact public defaults", () => {
      const parsed = parsePublicCatalogParams({});
      assert.strictEqual(parsed.page, 1);
      assert.strictEqual(parsed.pageSize, 24);
      assert.strictEqual(parsed.sort, "latest");
      assert.strictEqual(parsed.category, null);
      assert.strictEqual(parsed.subcategory, null);
      assert.strictEqual(parsed.q, null);
      assert.strictEqual(parsed.skip, 0);
      assert.strictEqual(parsed.invalidFilter, false);
    });

    it("clamps public pageSize correctly (default 24, max 48)", () => {
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "48" }).pageSize, 48);
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "49" }).pageSize, 48);
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "500" }).pageSize, 48);
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "0" }).pageSize, 24);
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "-10" }).pageSize, 24);
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "invalid" }).pageSize, 24);
    });

    it("rejects non-base-10 public pageSize representations and falls back to default 24", () => {
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "4e1" }).pageSize, 24);
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "0x20" }).pageSize, 24);
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "24.5" }).pageSize, 24);
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "24abc" }).pageSize, 24);
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "Infinity" }).pageSize, 24);
      assert.strictEqual(parsePublicCatalogParams({ pageSize: "+24" }).pageSize, 24);
    });

    it("normalizes public page numbers and computes safe skip", () => {
      const page2 = parsePublicCatalogParams({ page: "2", pageSize: "24" });
      assert.strictEqual(page2.page, 2);
      assert.strictEqual(page2.skip, 24);

      const page0 = parsePublicCatalogParams({ page: "0" });
      assert.strictEqual(page0.page, 1);
      assert.strictEqual(page0.skip, 0);

      const pageNegative = parsePublicCatalogParams({ page: "-5" });
      assert.strictEqual(pageNegative.page, 1);
      assert.strictEqual(pageNegative.skip, 0);

      const pageNonNumber = parsePublicCatalogParams({ page: "abc" });
      assert.strictEqual(pageNonNumber.page, 1);
      assert.strictEqual(pageNonNumber.skip, 0);
    });

    it("rejects non-base-10 public page representations and normalizes to 1", () => {
      assert.strictEqual(parsePublicCatalogParams({ page: "1e2" }).page, 1);
      assert.strictEqual(parsePublicCatalogParams({ page: "0x10" }).page, 1);
      assert.strictEqual(parsePublicCatalogParams({ page: "2.5" }).page, 1);
      assert.strictEqual(parsePublicCatalogParams({ page: "2abc" }).page, 1);
      assert.strictEqual(parsePublicCatalogParams({ page: "Infinity" }).page, 1);
      assert.strictEqual(parsePublicCatalogParams({ page: "+5" }).page, 1);
    });

    it("rejects public page > MAX_PUBLIC_PAGE (10,000) with CatalogQueryParamError", () => {
      assert.throws(
        () => parsePublicCatalogParams({ page: String(MAX_PUBLIC_PAGE + 1) }),
        (err: unknown) => {
          return (
            err instanceof CatalogQueryParamError &&
            err.code === "INVALID_PAGE" &&
            err.message.includes("10000")
          );
        }
      );
    });

    it("normalizes sorting mode to allowed values or defaults to latest", () => {
      assert.strictEqual(parsePublicCatalogParams({ sort: "latest" }).sort, "latest");
      assert.strictEqual(parsePublicCatalogParams({ sort: "price-asc" }).sort, "price-asc");
      assert.strictEqual(parsePublicCatalogParams({ sort: "price-desc" }).sort, "price-desc");
      assert.strictEqual(parsePublicCatalogParams({ sort: "PRICE-ASC" }).sort, "price-asc");
      assert.strictEqual(parsePublicCatalogParams({ sort: "unknown" }).sort, "latest");
      assert.strictEqual(parsePublicCatalogParams({ sort: "popularity" }).sort, "latest");
    });

    it("validates and normalizes category slugs safely", () => {
      const valid = parsePublicCatalogParams({ category: "Skin-Care" });
      assert.strictEqual(valid.category, "skin-care");
      assert.strictEqual(valid.invalidFilter, false);

      const invalidChars = parsePublicCatalogParams({ category: "skin/care" });
      assert.strictEqual(invalidChars.category, null);
      assert.strictEqual(invalidChars.invalidFilter, true);

      const asterisk = parsePublicCatalogParams({ category: "*" });
      assert.strictEqual(asterisk.category, null);
      assert.strictEqual(asterisk.invalidFilter, true);

      const whitespace = parsePublicCatalogParams({ category: "   " });
      assert.strictEqual(whitespace.category, null);
      assert.strictEqual(whitespace.invalidFilter, false); // empty string is treated as no category
    });

    it("handles subcategory with and without valid parent category", () => {
      const validBoth = parsePublicCatalogParams({
        category: "skincare",
        subcategory: "Face-Serum",
      });
      assert.strictEqual(validBoth.category, "skincare");
      assert.strictEqual(validBoth.subcategory, "face-serum");
      assert.strictEqual(validBoth.invalidFilter, false);

      const subWithoutCat = parsePublicCatalogParams({ subcategory: "face-serum" });
      assert.strictEqual(subWithoutCat.category, null);
      assert.strictEqual(subWithoutCat.subcategory, null);
      assert.strictEqual(subWithoutCat.invalidFilter, true);

      const invalidSubSyntax = parsePublicCatalogParams({
        category: "skincare",
        subcategory: "serum/*",
      });
      assert.strictEqual(invalidSubSyntax.category, "skincare");
      assert.strictEqual(invalidSubSyntax.subcategory, null);
      assert.strictEqual(invalidSubSyntax.invalidFilter, true);
    });

    it("trims and bounds search query q (max 80 chars)", () => {
      const trimmed = parsePublicCatalogParams({ q: "  moisturizer  " });
      assert.strictEqual(trimmed.q, "moisturizer");

      const empty = parsePublicCatalogParams({ q: "   " });
      assert.strictEqual(empty.q, null);

      const longQuery = "a".repeat(120);
      const bounded = parsePublicCatalogParams({ q: longQuery });
      assert.strictEqual(bounded.q?.length, 80);
      assert.strictEqual(bounded.q, "a".repeat(80));
    });
  });

  describe("Admin Catalog Parameter Normalization", () => {
    it("normalizes admin defaults", () => {
      const parsed = parseAdminCatalogParams({});
      assert.strictEqual(parsed.page, 1);
      assert.strictEqual(parsed.pageSize, 20);
      assert.strictEqual(parsed.filter, "all");
      assert.strictEqual(parsed.q, null);
      assert.strictEqual(parsed.skip, 0);
    });

    it("clamps admin pageSize to default 20 and max 50", () => {
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "20" }).pageSize, 20);
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "50" }).pageSize, 50);
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "100" }).pageSize, 50);
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "0" }).pageSize, 20);
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "invalid" }).pageSize, 20);
    });

    it("rejects non-base-10 admin pageSize representations and falls back to default 20", () => {
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "4e1" }).pageSize, 20);
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "0x20" }).pageSize, 20);
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "20.5" }).pageSize, 20);
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "20abc" }).pageSize, 20);
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "Infinity" }).pageSize, 20);
      assert.strictEqual(parseAdminCatalogParams({ pageSize: "+20" }).pageSize, 20);
    });

    it("rejects non-base-10 admin page representations and normalizes to 1", () => {
      assert.strictEqual(parseAdminCatalogParams({ page: "1e2" }).page, 1);
      assert.strictEqual(parseAdminCatalogParams({ page: "0x10" }).page, 1);
      assert.strictEqual(parseAdminCatalogParams({ page: "2.5" }).page, 1);
      assert.strictEqual(parseAdminCatalogParams({ page: "2abc" }).page, 1);
      assert.strictEqual(parseAdminCatalogParams({ page: "Infinity" }).page, 1);
      assert.strictEqual(parseAdminCatalogParams({ page: "+5" }).page, 1);
    });

    it("rejects admin page > MAX_ADMIN_PAGE (10,000) with CatalogQueryParamError", () => {
      assert.throws(
        () => parseAdminCatalogParams({ page: String(MAX_ADMIN_PAGE + 1) }),
        (err: unknown) => {
          return (
            err instanceof CatalogQueryParamError &&
            err.code === "INVALID_PAGE"
          );
        }
      );
    });

    it("normalizes admin filter values", () => {
      assert.strictEqual(parseAdminCatalogParams({ filter: "all" }).filter, "all");
      assert.strictEqual(parseAdminCatalogParams({ filter: "hot" }).filter, "hot");
      assert.strictEqual(parseAdminCatalogParams({ filter: "upcoming" }).filter, "upcoming");
      assert.strictEqual(parseAdminCatalogParams({ filter: "discount" }).filter, "discount");
      assert.strictEqual(parseAdminCatalogParams({ filter: "badge" }).filter, "badge");
      assert.strictEqual(parseAdminCatalogParams({ filter: "unknown" }).filter, "all");
    });
  });

  describe("Safe Skip Arithmetic", () => {
    it("calculates safe skip for normal accepted page and pageSize", () => {
      const parsed = parsePublicCatalogParams({ page: "10", pageSize: "24" });
      assert.strictEqual(parsed.skip, 216);
      assert.strictEqual(Number.isSafeInteger(parsed.skip), true);
    });
  });
});
