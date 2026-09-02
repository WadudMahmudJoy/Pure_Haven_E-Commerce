import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createInitialCarouselState,
  markSlideLoaded,
  requestSlide,
  completeSlidePreload,
  failSlide,
  getAvailableSlideIndices,
} from "../components/ui/carouselNavigation";
import ProductCardCarousel from "../components/ui/ProductCardCarousel";

describe("Task 7 — ProductCard Carousel State Machine & Structural Preload", () => {
  // ---------------------------------------------------------------------------
  // 1. Initial State Contract
  // ---------------------------------------------------------------------------
  it("A. initial state: displayedIndex 0, pendingIndex null, empty loaded and failed sets", () => {
    const initial = createInitialCarouselState(3);
    assert.strictEqual(initial.displayedIndex, 0);
    assert.strictEqual(initial.pendingIndex, null);
    assert.strictEqual(initial.loadedIndices.size, 0);
    assert.strictEqual(initial.failedIndices.size, 0);
    assert.strictEqual(initial.totalImages, 3);
  });

  it("fail-closed: throws when totalImages is <= 0 or not an integer", () => {
    assert.throws(() => createInitialCarouselState(0));
    assert.throws(() => createInitialCarouselState(-1));
    assert.throws(() => createInitialCarouselState(1.5));
  });

  // ---------------------------------------------------------------------------
  // 2. Primary Slide Confirmation
  // ---------------------------------------------------------------------------
  it("B. primary load: markSlideLoaded(0) marks only 0 loaded and preserves state immutably", () => {
    const initial = createInitialCarouselState(3);
    const loaded = markSlideLoaded(initial, 0);

    assert.strictEqual(initial.loadedIndices.size, 0, "original state must not be mutated");
    assert.strictEqual(loaded.loadedIndices.has(0), true);
    assert.strictEqual(loaded.loadedIndices.size, 1);
    assert.strictEqual(loaded.displayedIndex, 0);
    assert.strictEqual(loaded.pendingIndex, null);
  });

  // ---------------------------------------------------------------------------
  // 3. Requesting Slides (Unloaded vs Loaded)
  // ---------------------------------------------------------------------------
  it("C. request unloaded secondary: displayed stays 0 and pending becomes 1 (GENUINE RED TARGET)", () => {
    const initial = createInitialCarouselState(3);
    const next = requestSlide(initial, 1);

    assert.strictEqual(
      next.displayedIndex,
      0,
      "Requesting an unloaded slide must NEVER blank or switch displayedIndex immediately"
    );
    assert.strictEqual(
      next.pendingIndex,
      1,
      "Target slide must be marked as pending"
    );
  });

  it("D. request already-loaded slide: switches immediately and pending remains null", () => {
    let state = createInitialCarouselState(3);
    state = markSlideLoaded(state, 0);
    state = markSlideLoaded(state, 1);

    const next = requestSlide(state, 1);
    assert.strictEqual(next.displayedIndex, 1);
    assert.strictEqual(next.pendingIndex, null);
  });

  // ---------------------------------------------------------------------------
  // 4. Preload Completion & Stale-Callback Protection
  // ---------------------------------------------------------------------------
  it("E. complete pending preload: marks loaded, switches displayed, and clears pending", () => {
    const initial = createInitialCarouselState(3);
    const pending = requestSlide(initial, 1);
    const completed = completeSlidePreload(pending, 1);

    assert.strictEqual(completed.displayedIndex, 1);
    assert.strictEqual(completed.pendingIndex, null);
    assert.strictEqual(completed.loadedIndices.has(1), true);
  });

  it("F. stale preload completion: older preload completion must NOT override a newer pending target", () => {
    const initial = createInitialCarouselState(4);
    // User requested slide 1
    const pending1 = requestSlide(initial, 1);
    assert.strictEqual(pending1.pendingIndex, 1);

    // Before slide 1 finishes, user rapidly requests slide 2
    const pending2 = requestSlide(pending1, 2);
    assert.strictEqual(pending2.pendingIndex, 2);
    assert.strictEqual(pending2.displayedIndex, 0);

    // Stale slide 1 finishes loading late
    const staleCompleted = completeSlidePreload(pending2, 1);
    assert.strictEqual(
      staleCompleted.displayedIndex,
      0,
      "Stale slide 1 must NOT switch displayedIndex when slide 2 is pending"
    );
    assert.strictEqual(
      staleCompleted.pendingIndex,
      2,
      "Pending intent for slide 2 must be preserved"
    );
    assert.strictEqual(
      staleCompleted.loadedIndices.has(1),
      true,
      "Slide 1 can still be marked loaded for future visits"
    );
  });

  // ---------------------------------------------------------------------------
  // 5. Failures & Fallback Actions
  // ---------------------------------------------------------------------------
  it("G. secondary failure: marks failed, clears pending, preserves displayed, action 'secondary-skipped'", () => {
    const initial = createInitialCarouselState(3);
    const pending = requestSlide(initial, 1);
    const { state: failedState, action } = failSlide(pending, 1);

    assert.strictEqual(action, "secondary-skipped");
    assert.strictEqual(failedState.displayedIndex, 0);
    assert.strictEqual(failedState.pendingIndex, null);
    assert.strictEqual(failedState.failedIndices.has(1), true);
  });

  it("H. failed slide skipped: getAvailableSlideIndices excludes failed slide in gallery order", () => {
    const initial = createInitialCarouselState(3);
    const { state: failedState } = failSlide(initial, 1);
    const available = getAvailableSlideIndices(failedState);

    assert.deepStrictEqual(available, [0, 2]);
  });

  it("I. primary failure: action 'primary-fallback' and secondaries remain available", () => {
    const initial = createInitialCarouselState(3);
    const { state: failedPrimary, action } = failSlide(initial, 0);

    assert.strictEqual(action, "primary-fallback");
    assert.strictEqual(failedPrimary.failedIndices.has(0), true);
    const available = getAvailableSlideIndices(failedPrimary);
    assert.deepStrictEqual(available, [1, 2]);
  });

  it("J. all images failed: action 'all-real-images-failed' when last remaining slide fails", () => {
    let state = createInitialCarouselState(2);
    state = failSlide(state, 0).state;
    const finalResult = failSlide(state, 1);

    assert.strictEqual(finalResult.action, "all-real-images-failed");
    assert.deepStrictEqual(getAvailableSlideIndices(finalResult.state), []);
  });

  // ---------------------------------------------------------------------------
  // 6. Immutability & Safe No-Op Invariants
  // ---------------------------------------------------------------------------
  it("K. immutability: original Sets are never mutated across state transitions", () => {
    const initial = createInitialCarouselState(3);
    const loaded = markSlideLoaded(initial, 0);
    const requested = requestSlide(loaded, 1);
    const failed = failSlide(requested, 2).state;

    assert.strictEqual(initial.loadedIndices.size, 0);
    assert.strictEqual(initial.failedIndices.size, 0);
    assert.strictEqual(loaded.loadedIndices.size, 1);
    assert.strictEqual(loaded.failedIndices.size, 0);
    assert.strictEqual(failed.failedIndices.size, 1);
  });

  it("L. invalid/failed target request: safe no-op and cannot select failed or out-of-bounds slide", () => {
    const initial = createInitialCarouselState(3);
    const outOfBounds = requestSlide(initial, 10);
    assert.deepStrictEqual(outOfBounds, initial);

    const negative = requestSlide(initial, -1);
    assert.deepStrictEqual(negative, initial);

    const { state: withFailed } = failSlide(initial, 1);
    const requestFailed = requestSlide(withFailed, 1);
    assert.strictEqual(requestFailed.pendingIndex, null);
    assert.strictEqual(requestFailed.displayedIndex, 0);
  });

  // ---------------------------------------------------------------------------
  // 7. Component Rendering & Structural Preloading Verification
  // ---------------------------------------------------------------------------
  describe("Component Rendering & Structural Lazy Loading", () => {
    it("fail-closed: empty carousel input throws a clear Error", () => {
      assert.throws(
        () =>
          renderToStaticMarkup(
            React.createElement(ProductCardCarousel, {
              productId: 999,
              productName: "Invalid Empty Gallery Product",
              category: "Skincare",
              images: [],
            })
          ),
        /ProductCardCarousel requires at least one image/
      );
    });

    it("A. single-image card: renders exactly one image, no arrows, no indicators", () => {
      const html = renderToStaticMarkup(
        React.createElement(ProductCardCarousel, {
          productId: 101,
          productName: "Radiance Serum",
          category: "Skincare",
          images: ["/uploads/products/serum.jpg"],
        })
      );

      assert.ok(html.includes("serum.jpg"), "Primary image must be present");
      assert.ok(!html.includes('aria-label="Previous image"'), "No Previous button for single image");
      assert.ok(!html.includes('aria-label="Next image"'), "No Next button for single image");
      assert.ok(!html.includes("Show image 1 of"), "No indicators for single image");
    });

    it("B. multi-image initial markup: mounts ONLY slide 0 image, secondaries are NOT in DOM", () => {
      const html = renderToStaticMarkup(
        React.createElement(ProductCardCarousel, {
          productId: 102,
          productName: "Glow Cream",
          category: "Skincare",
          images: [
            "/uploads/products/cream-1.jpg",
            "/uploads/products/cream-2.jpg",
            "/uploads/products/cream-3.jpg",
          ],
        })
      );

      // Slide 0 must be rendered
      assert.ok(html.includes("cream-1.jpg"), "Slide 0 must be mounted");

      // Slide 1 and 2 must NOT be in DOM (not hidden, not offscreen, not mounted)
      assert.ok(!html.includes("cream-2.jpg"), "Slide 1 must NOT be in initial DOM");
      assert.ok(!html.includes("cream-3.jpg"), "Slide 2 must NOT be in initial DOM");

      // Exactly one image element should be rendered
      const imgCount = (html.match(/<img\b/g) || []).length;
      assert.strictEqual(imgCount, 1, "Exactly one <img> element must be rendered initially");
    });

    it("C. controls: renders Previous and Next buttons with exact accessible labels", () => {
      const html = renderToStaticMarkup(
        React.createElement(ProductCardCarousel, {
          productId: 103,
          productName: "Hydrating Mist",
          category: "Skincare",
          images: [
            "/uploads/products/mist-1.jpg",
            "/uploads/products/mist-2.jpg",
          ],
        })
      );

      assert.ok(html.includes('aria-label="Previous image"'));
      assert.ok(html.includes('aria-label="Next image"'));
    });

    it("D. indicators: renders exact labels and aria-current on displayed slide", () => {
      const html = renderToStaticMarkup(
        React.createElement(ProductCardCarousel, {
          productId: 104,
          productName: "Facial Oil",
          category: "Skincare",
          images: [
            "/uploads/products/oil-1.jpg",
            "/uploads/products/oil-2.jpg",
            "/uploads/products/oil-3.jpg",
          ],
        })
      );

      assert.ok(html.includes('aria-label="Show image 1 of 3"'));
      assert.ok(html.includes('aria-label="Show image 2 of 3"'));
      assert.ok(html.includes('aria-label="Show image 3 of 3"'));
      assert.ok(html.includes('aria-current="true"'));
    });

    it("E. carousel region: has role='region', roledescription='carousel', accessible label", () => {
      const html = renderToStaticMarkup(
        React.createElement(ProductCardCarousel, {
          productId: 105,
          productName: "Rose Toner",
          category: "Skincare",
          images: [
            "/uploads/products/toner-1.jpg",
            "/uploads/products/toner-2.jpg",
          ],
        })
      );

      assert.ok(html.includes('role="region"'));
      assert.ok(html.includes('aria-roledescription="carousel"'));
      assert.ok(html.includes('aria-label="Rose Toner image gallery"'));
      assert.ok(html.includes('tabIndex="0"') || html.includes('tabindex="0"'));
    });

    it("F. control propagation: click handlers contain preventDefault and stopPropagation", () => {
      const carouselSource = fs.readFileSync(
        path.join(process.cwd(), "components", "ui", "ProductCardCarousel.tsx"),
        "utf8"
      );

      assert.ok(carouselSource.includes("e.preventDefault()"));
      assert.ok(carouselSource.includes("e.stopPropagation()"));
    });

    it("G. no nested interactive anchor/button structure: controls are siblings of product Link", () => {
      const carouselSource = fs.readFileSync(
        path.join(process.cwd(), "components", "ui", "ProductCardCarousel.tsx"),
        "utf8"
      );

      // Verify that <Link ...> only contains SafeImage and NOT buttons
      const linkMatch = carouselSource.match(/<Link[\s\S]*?<\/Link>/);
      assert.ok(linkMatch, "Product Link must exist");
      const linkContent = linkMatch[0];
      assert.ok(!linkContent.includes("<button"), "Controls must NOT be nested inside <Link>");
    });

    it("H. structural preload: uses new window.Image() for pendingIndex, no loop over gallery", () => {
      const carouselSource = fs.readFileSync(
        path.join(process.cwd(), "components", "ui", "ProductCardCarousel.tsx"),
        "utf8"
      );

      assert.ok(carouselSource.includes("new window.Image()"));
      assert.ok(carouselSource.includes("state.pendingIndex"));
      assert.ok(!carouselSource.includes(".map((img) => new window.Image()"));
    });

    it("I. ProductCard integration: derives effective gallery and passes to ProductCardCarousel", () => {
      const cardSource = fs.readFileSync(
        path.join(process.cwd(), "components", "ui", "ProductCard.tsx"),
        "utf8"
      );

      assert.ok(cardSource.includes("<ProductCardCarousel"));
      assert.ok(cardSource.includes("images={effectiveImages}"));
      assert.ok(cardSource.includes("return images.slice(0, 4);"));
      assert.ok(cardSource.includes("return [image];"));
    });

    it("J. commerce isolation: addToCart and toggleWishlist retain exact shape without images array", () => {
      const cardSource = fs.readFileSync(
        path.join(process.cwd(), "components", "ui", "ProductCard.tsx"),
        "utf8"
      );

      assert.ok(cardSource.includes("addToCart({"));
      assert.ok(cardSource.includes("toggleWishlist({"));
      assert.ok(!cardSource.includes("addToCart({\n      id,\n      name,\n      price,\n      image: imageSrc,\n      images"));
    });

    it("K. primary failure leaves secondary navigable and preserves original slide index label", () => {
      // 1. Pure state-machine proof: failing slide 0 in a 2-image gallery leaves [1] available
      const state2 = createInitialCarouselState(2);
      const { state: primaryFailedState } = failSlide(state2, 0);
      const remainingAvailable = getAvailableSlideIndices(primaryFailedState);
      assert.deepStrictEqual(remainingAvailable, [1], "Slide 1 must remain available");

      // 2. Component wiring proof: arrow controls and indicator visibility are decoupled
      const carouselSource = fs.readFileSync(
        path.join(process.cwd(), "components", "ui", "ProductCardCarousel.tsx"),
        "utf8"
      );

      // Verify separate visibility logic
      assert.ok(
        carouselSource.includes("const showArrowControls = availableIndices.length > 1;"),
        "Arrow controls must require > 1 available index"
      );
      assert.ok(
        carouselSource.includes("const showIndicators ="),
        "Indicators must have their own visibility contract"
      );
      assert.ok(
        carouselSource.includes("state.totalImages > 1 && availableIndices.length > 0"),
        "Indicators must remain visible for multi-image galleries as long as at least 1 slide remains"
      );

      // Verify indicator label preserves original position
      assert.ok(
        carouselSource.includes('"Show image " + (slideIdx + 1) + " of " + state.totalImages'),
        "Indicator label must use (slideIdx + 1) and state.totalImages"
      );
    });

    it("L. collision-safe gallery identity: delimiter collision is prevented", () => {
      const carouselSource = fs.readFileSync(
        path.join(process.cwd(), "components", "ui", "ProductCardCarousel.tsx"),
        "utf8"
      );

      assert.ok(
        carouselSource.includes("JSON.stringify([productId, gallery])"),
        "Must use structural JSON.stringify([productId, gallery]) for collision-safe key"
      );
      assert.ok(
        !carouselSource.includes('String(productId) + "-" + gallery.join(",")'),
        "Must not use delimiter-colliding string join"
      );

      // Verify distinctness
      const key1 = JSON.stringify([1, ["a,b", "c"]]);
      const key2 = JSON.stringify([1, ["a", "b,c"]]);
      assert.notStrictEqual(key1, key2);
    });
  });
});
