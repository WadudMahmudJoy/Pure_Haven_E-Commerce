import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ProductCardCarousel from "../components/ui/ProductCardCarousel";
import type { PublicResponsiveImageDto } from "../lib/media/publicMediaDto";
import type { PublicProductMediaProjection } from "../lib/catalog/types";

// Mock DTOs for testing ProductCard responsive rendering
const mockAvifAndWebpDto: PublicResponsiveImageDto = {
  mediaId: "media-uuid-1",
  width: 1200,
  height: 1200,
  fallbackSrc: "https://media.purehaven.test/public/media-uuid-1/rendition-800.webp",
  sources: [
    {
      type: "image/avif",
      srcSet: "https://media.purehaven.test/public/media-uuid-1/rendition-400.avif 400w, https://media.purehaven.test/public/media-uuid-1/rendition-800.avif 800w",
    },
    {
      type: "image/webp",
      srcSet: "https://media.purehaven.test/public/media-uuid-1/rendition-400.webp 400w, https://media.purehaven.test/public/media-uuid-1/rendition-800.webp 800w",
    },
  ],
};

const mockWebpOnlyDto: PublicResponsiveImageDto = {
  mediaId: "media-uuid-2",
  width: 800,
  height: 800,
  fallbackSrc: "https://media.purehaven.test/public/media-uuid-2/rendition-640.webp",
  sources: [
    {
      type: "image/webp",
      srcSet: "https://media.purehaven.test/public/media-uuid-2/rendition-320.webp 320w, https://media.purehaven.test/public/media-uuid-2/rendition-640.webp 640w",
    },
  ],
};

describe("Task 21: ProductCard Responsive Managed Media Delivery", () => {
  it("1. Managed media with AVIF+WebP renders <picture> with AVIF before WebP", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "managed",
          media: mockAvifAndWebpDto,
          altText: "Hydrating Cleanser Main",
        },
      ],
      primarySrc: mockAvifAndWebpDto.fallbackSrc,
      primaryKind: "managed",
    };

    const html = renderToStaticMarkup(
      React.createElement(ProductCardCarousel, {
        productId: 101,
        productName: "Hydrating Cleanser",
        category: "Skincare",
        images: [mockAvifAndWebpDto.fallbackSrc],
        media: projection,
      })
    );

    assert.match(html, /<picture\b/i, "Must render a <picture> element for managed media");
    assert.match(html, /type="image\/avif"/i, "Must contain AVIF source");
    assert.match(html, /type="image\/webp"/i, "Must contain WebP source");

    // Authoritative order: AVIF must precede WebP in the markup
    const avifPos = html.indexOf('type="image/avif"');
    const webpPos = html.indexOf('type="image/webp"');
    assert.ok(avifPos !== -1 && webpPos !== -1, "Both AVIF and WebP sources must exist");
    assert.ok(avifPos < webpPos, "AVIF source must appear BEFORE WebP source in <picture>");
  });

  it("2. WebP-only managed media renders only WebP source in <picture>", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "managed",
          media: mockWebpOnlyDto,
          altText: "Gentle Toner",
        },
      ],
      primarySrc: mockWebpOnlyDto.fallbackSrc,
      primaryKind: "managed",
    };

    const html = renderToStaticMarkup(
      React.createElement(ProductCardCarousel, {
        productId: 102,
        productName: "Gentle Toner",
        category: "Skincare",
        images: [mockWebpOnlyDto.fallbackSrc],
        media: projection,
      })
    );

    assert.match(html, /<picture\b/i);
    assert.doesNotMatch(html, /type="image\/avif"/i, "Must NOT emit AVIF source when DTO lacks AVIF");
    assert.match(html, /type="image\/webp"/i, "Must emit WebP source");
  });

  it("3. Srcset uses only real available widths and appropriate sizes attribute", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "managed",
          media: mockAvifAndWebpDto,
          altText: "Hydrating Cleanser",
        },
      ],
      primarySrc: mockAvifAndWebpDto.fallbackSrc,
      primaryKind: "managed",
    };

    const html = renderToStaticMarkup(
      React.createElement(ProductCardCarousel, {
        productId: 101,
        productName: "Hydrating Cleanser",
        category: "Skincare",
        images: [mockAvifAndWebpDto.fallbackSrc],
        media: projection,
      })
    );

    // Verify srcset contains real widths from DTO
    assert.match(html, /400w/);
    assert.match(html, /800w/);
    assert.doesNotMatch(html, /1500w/, "Must not invent widths not present in DTO");

    // Verify sizes attribute is rendered on source and img
    assert.match(html, /sizes="\(max-width: 640px\) 50vw, \(max-width: 1024px\) 33vw, 25vw"/);
  });

  it("4. Primary and fallback src is PUBLIC_DELIVERY WebP, never master or private", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "managed",
          media: mockAvifAndWebpDto,
          altText: "Hydrating Cleanser",
        },
      ],
      primarySrc: mockAvifAndWebpDto.fallbackSrc,
      primaryKind: "managed",
    };

    const html = renderToStaticMarkup(
      React.createElement(ProductCardCarousel, {
        productId: 101,
        productName: "Hydrating Cleanser",
        category: "Skincare",
        images: [mockAvifAndWebpDto.fallbackSrc],
        media: projection,
      })
    );

    // img src must be the public fallback
    assert.match(html, /src="https:\/\/media\.purehaven\.test\/public\/media-uuid-1\/rendition-800\.webp"/);

    // Negative tests: zero private/master data in DOM
    assert.strictEqual(html.includes("canonical-master"), false);
    assert.strictEqual(html.includes("PRIVATE_SOURCE"), false);
    assert.strictEqual(html.includes("staging/"), false);
    assert.strictEqual(html.includes("master.webp"), false);
  });

  it("5. Secondary gallery images remain structurally lazy (absent from initial DOM)", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "managed",
          media: mockAvifAndWebpDto,
          altText: "Cleanser Slide 1",
        },
        {
          kind: "managed",
          media: mockWebpOnlyDto,
          altText: "Cleanser Slide 2",
        },
      ],
      primarySrc: mockAvifAndWebpDto.fallbackSrc,
      primaryKind: "managed",
    };

    const html = renderToStaticMarkup(
      React.createElement(ProductCardCarousel, {
        productId: 101,
        productName: "Hydrating Cleanser",
        category: "Skincare",
        images: [mockAvifAndWebpDto.fallbackSrc, mockWebpOnlyDto.fallbackSrc],
        media: projection,
      })
    );

    // Slide 0 must be mounted
    assert.ok(html.includes("media-uuid-1"), "Slide 0 must be in DOM");

    // Slide 1 must NOT be in initial DOM
    assert.ok(!html.includes("media-uuid-2"), "Slide 1 must NOT be in initial DOM (lazy)");

    // Exactly one picture/img rendered initially
    const pictureCount = (html.match(/<picture\b/g) || []).length;
    assert.strictEqual(pictureCount, 1, "Exactly one <picture> element must be rendered initially");
  });

  it("6. Priority flag applies eager loading and high fetchpriority to primary slide only", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "managed",
          media: mockAvifAndWebpDto,
          altText: "Priority Cleanser",
        },
      ],
      primarySrc: mockAvifAndWebpDto.fallbackSrc,
      primaryKind: "managed",
    };

    const htmlPriority = renderToStaticMarkup(
      React.createElement(ProductCardCarousel, {
        productId: 101,
        productName: "Priority Cleanser",
        category: "Skincare",
        images: [mockAvifAndWebpDto.fallbackSrc],
        media: projection,
        priority: true,
      })
    );

    assert.match(htmlPriority, /loading="eager"/);
    assert.match(htmlPriority, /fetchpriority="high"/i);

    const htmlLazy = renderToStaticMarkup(
      React.createElement(ProductCardCarousel, {
        productId: 101,
        productName: "Lazy Cleanser",
        category: "Skincare",
        images: [mockAvifAndWebpDto.fallbackSrc],
        media: projection,
        priority: false,
      })
    );

    assert.match(htmlLazy, /loading="lazy"/);
    assert.doesNotMatch(htmlLazy, /fetchpriority="high"/i);
  });

  it("7. Mixed gallery: legacy items preserve SafeImage path and normalization", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "legacy",
          src: "/uploads/products/legacy-cream.jpg",
          altText: "Legacy Cream",
        },
        {
          kind: "managed",
          media: mockAvifAndWebpDto,
          altText: "Managed Cream",
        },
      ],
      primarySrc: "/uploads/products/legacy-cream.jpg",
      primaryKind: "legacy",
    };

    const html = renderToStaticMarkup(
      React.createElement(ProductCardCarousel, {
        productId: 103,
        productName: "Legacy Cream",
        category: "Skincare",
        images: ["/uploads/products/legacy-cream.jpg", mockAvifAndWebpDto.fallbackSrc],
        media: projection,
      })
    );

    // Since slide 0 is legacy, it must render through standard img/SafeImage without <picture>
    assert.doesNotMatch(html, /<picture\b/i, "Legacy slide 0 must not render <picture>");
    assert.match(html, /src="\/uploads\/products\/legacy-cream\.jpg"/);
  });

  it("8. Pure legacy product (no media projection) preserves existing SafeImage behavior", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductCardCarousel, {
        productId: 104,
        productName: "Pure Legacy Toner",
        category: "Skincare",
        images: ["/uploads/products/toner.jpg"],
      })
    );

    assert.doesNotMatch(html, /<picture\b/i);
    assert.match(html, /src="\/uploads\/products\/toner\.jpg"/);
  });
});
