import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  moveGalleryItemUp,
  moveGalleryItemDown,
  canAddGalleryItem,
  canRemoveGalleryItem,
  serializeGalleryPayload,
  type AdminGalleryItem,
} from "../lib/catalog/adminGalleryState";

describe("Task 5 — Admin Gallery Edit UI & State Model", () => {
  // ---------------------------------------------------------------------------
  // 1. Pure Helper State Transitions & Bounds
  // ---------------------------------------------------------------------------
  it("A. MOVE UP: swaps item with predecessor and does not mutate input array", () => {
    const original: AdminGalleryItem[] = [
      { id: "1", url: "/uploads/products/a.jpg" },
      { id: "2", url: "/uploads/products/b.jpg" },
      { id: "3", url: "/uploads/products/c.jpg" },
    ];
    const items = [...original];

    const result = moveGalleryItemUp(items, 1);

    assert.deepStrictEqual(result, [
      { id: "2", url: "/uploads/products/b.jpg" },
      { id: "1", url: "/uploads/products/a.jpg" },
      { id: "3", url: "/uploads/products/c.jpg" },
    ]);
    assert.deepStrictEqual(items, original, "Input array must NOT be mutated");
  });

  it("B. MOVE UP BOUNDARY: index 0 and invalid indices return unchanged ordering", () => {
    const items: AdminGalleryItem[] = [
      { id: "1", url: "/uploads/products/a.jpg" },
      { id: "2", url: "/uploads/products/b.jpg" },
    ];

    assert.deepStrictEqual(moveGalleryItemUp(items, 0), items);
    assert.deepStrictEqual(moveGalleryItemUp(items, -1), items);
    assert.deepStrictEqual(moveGalleryItemUp(items, 5), items);
  });

  it("C. MOVE DOWN: swaps item with successor and does not mutate input array", () => {
    const original: AdminGalleryItem[] = [
      { id: "1", url: "/uploads/products/a.jpg" },
      { id: "2", url: "/uploads/products/b.jpg" },
      { id: "3", url: "/uploads/products/c.jpg" },
    ];
    const items = [...original];

    const result = moveGalleryItemDown(items, 0);

    assert.deepStrictEqual(result, [
      { id: "2", url: "/uploads/products/b.jpg" },
      { id: "1", url: "/uploads/products/a.jpg" },
      { id: "3", url: "/uploads/products/c.jpg" },
    ]);
    assert.deepStrictEqual(items, original, "Input array must NOT be mutated");
  });

  it("D. MOVE DOWN BOUNDARY: last index and invalid indices return unchanged ordering", () => {
    const items: AdminGalleryItem[] = [
      { id: "1", url: "/uploads/products/a.jpg" },
      { id: "2", url: "/uploads/products/b.jpg" },
    ];

    assert.deepStrictEqual(moveGalleryItemDown(items, 1), items);
    assert.deepStrictEqual(moveGalleryItemDown(items, 2), items);
    assert.deepStrictEqual(moveGalleryItemDown(items, -1), items);
  });

  it("E. ADD BOUND: canAddGalleryItem is true for 1..3 items and false for 0 or >=4 items", () => {
    const makeItems = (n: number): AdminGalleryItem[] =>
      Array.from({ length: n }, (_, i) => ({
        id: String(i),
        url: `/uploads/products/${i}.jpg`,
      }));

    assert.strictEqual(canAddGalleryItem(makeItems(0)), false, "Empty gallery cannot add");
    assert.strictEqual(canAddGalleryItem(makeItems(1)), true, "Count 1 can add");
    assert.strictEqual(canAddGalleryItem(makeItems(2)), true, "Count 2 can add");
    assert.strictEqual(canAddGalleryItem(makeItems(3)), true, "Count 3 can add");
    assert.strictEqual(canAddGalleryItem(makeItems(4)), false, "Count 4 cannot add");
    assert.strictEqual(canAddGalleryItem(makeItems(5)), false, "Count 5 cannot add");
  });

  it("F. REMOVE BOUND: canRemoveGalleryItem is false for <=1 items and true for >=2 items", () => {
    const makeItems = (n: number): AdminGalleryItem[] =>
      Array.from({ length: n }, (_, i) => ({
        id: String(i),
        url: `/uploads/products/${i}.jpg`,
      }));

    assert.strictEqual(canRemoveGalleryItem(makeItems(0)), false);
    assert.strictEqual(canRemoveGalleryItem(makeItems(1)), false, "Count 1 cannot remove");
    assert.strictEqual(canRemoveGalleryItem(makeItems(2)), true, "Count 2 can remove");
    assert.strictEqual(canRemoveGalleryItem(makeItems(3)), true, "Count 3 can remove");
    assert.strictEqual(canRemoveGalleryItem(makeItems(4)), true, "Count 4 can remove");
  });

  it("G. SERIALIZATION: preserves current UI order and extracts first item as primary image", () => {
    const items: AdminGalleryItem[] = [
      { id: "b", url: "/uploads/products/b.jpg" },
      { id: "a", url: "/uploads/products/a.jpg" },
      { id: "c", url: "/uploads/products/c.jpg" },
    ];

    const payload = serializeGalleryPayload(items);

    assert.deepStrictEqual(payload, {
      images: [
        "/uploads/products/b.jpg",
        "/uploads/products/a.jpg",
        "/uploads/products/c.jpg",
      ],
      image: "/uploads/products/b.jpg",
    });
  });

  it("H. INVALID EMPTY SERIALIZATION: fails closed on empty array", () => {
    assert.throws(
      () => serializeGalleryPayload([]),
      /Cannot serialize/i
    );
  });

  // ---------------------------------------------------------------------------
  // 2. Page Wiring & Structural Contract Tests
  // ---------------------------------------------------------------------------
  describe("Admin Product Edit Page Wiring Contract", () => {
    const editPagePath = path.join(
      process.cwd(),
      "app",
      "admin",
      "products",
      "[id]",
      "edit",
      "page.tsx"
    );
    const source = fs.readFileSync(editPagePath, "utf8");

    it("A. Initializes gallery from product.images with fallback to [product.image]", () => {
      assert.ok(
        source.includes("product.images") &&
          (source.includes("product.image") || source.includes("[product.image]")),
        "Page must initialize gallery using product.images with product.image fallback"
      );
    });

    it("B. Presents position 1 / first item with a Primary badge", () => {
      assert.ok(
        source.includes("Primary"),
        "Page must render a clear 'Primary' badge/label on the first gallery item"
      );
    });

    it("C. Move Up and Move Down controls have accessible aria-labels", () => {
      assert.ok(
        source.includes('aria-label="Move image up"'),
        "Move Up button must have aria-label='Move image up'"
      );
      assert.ok(
        source.includes('aria-label="Move image down"'),
        "Move Down button must have aria-label='Move image down'"
      );
    });

    it("D. Disables Move Up at index 0 and Move Down at last index", () => {
      assert.ok(
        source.includes("index === 0") || source.includes("idx === 0"),
        "Move Up button must be disabled at index 0"
      );
      assert.ok(
        source.includes("gallery.length - 1") || source.includes("items.length - 1"),
        "Move Down button must be disabled at last index"
      );
    });

    it("E. Remove button is disabled when gallery has only 1 item", () => {
      assert.ok(
        source.includes('aria-label="Remove image"') || source.includes("canRemoveGalleryItem"),
        "Remove button must have accessible label and respect removal boundary"
      );
    });

    it("F. Add image control is disabled when gallery has >= 4 items", () => {
      assert.ok(
        source.includes("canAddGalleryItem") || source.includes(">= 4") || source.includes("=== 4"),
        "Add image control must be disabled when gallery reaches 4 items"
      );
    });

    it("G. Uses helper reorder functions rather than duplicate inline swapping", () => {
      assert.ok(
        source.includes("moveGalleryItemUp") && source.includes("moveGalleryItemDown"),
        "Page must import and invoke moveGalleryItemUp and moveGalleryItemDown"
      );
    });

    it("H. Save path uses serializeGalleryPayload and submits ordered images + primary image mirror", () => {
      assert.ok(
        source.includes("serializeGalleryPayload"),
        "Page must use serializeGalleryPayload before submitting"
      );
      assert.ok(
        source.includes("images:") && source.includes("image:"),
        "PUT payload must include images and image"
      );
    });

    it("I. No drag-and-drop library or DnD ordering path introduced", () => {
      const lower = source.toLowerCase();
      assert.ok(!lower.includes("dnd"), "Must not contain dnd dependencies");
      assert.ok(!lower.includes("dragdrop"), "Must not contain dragdrop");
      assert.ok(!lower.includes("draggable"), "Must not contain draggable");
    });

    it("J. Preserves existing authenticated admin-detail fetch path", () => {
      assert.ok(
        source.includes("/api/products?view=admin&id="),
        "Page must retain existing admin view fetch path"
      );
    });

    it("K. Zero initial images fail closed before setGallery", () => {
      assert.ok(
        source.includes("initialImages.length === 0") &&
          source.includes("Product has no valid gallery image"),
        "Page must fail closed when product has 0 images"
      );
    });

    it("L. >4 initial images fail closed before setGallery", () => {
      assert.ok(
        source.includes("initialImages.length > 4") &&
          source.includes("Product gallery exceeds the supported maximum of 4 images"),
        "Page must fail closed when product has >4 images"
      );
    });

    it("M. Remove functional updater checks canRemoveGalleryItem(prev)", () => {
      assert.ok(
        source.includes("canRemoveGalleryItem(prev)"),
        "handleRemoveImage must guard inside setGallery((prev) => ...) with canRemoveGalleryItem(prev)"
      );
    });

    it("N. Successful add functional updater checks canAddGalleryItem(prev)", () => {
      assert.ok(
        source.includes("canAddGalleryItem(prev)"),
        "handleAddImageFile must guard inside setGallery((prev) => ...) with canAddGalleryItem(prev)"
      );
    });

    it("O. Position indicator uses real JSX interpolation and does NOT contain literal #${index + 1}", () => {
      assert.ok(
        !source.includes("#${index + 1}"),
        "Position indicator must not contain literal #${index + 1}"
      );
      assert.ok(
        source.includes("#{index + 1}"),
        "Position indicator must use #{index + 1} interpolation"
      );
    });
  });
});
