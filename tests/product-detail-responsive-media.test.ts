import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ProductDetailsClient from "../components/product/ProductDetailsClient";
import { CartProvider } from "../components/cart/CartContext";
import type { PublicResponsiveImageDto } from "../lib/media/publicMediaDto";
import type { PublicProductMediaProjection } from "../lib/catalog/types";

// High-DPI mock DTO with 400w, 800w, 1200w, 1500w renditions
const mockHighDpiMediaDto: PublicResponsiveImageDto = {
  mediaId: "media-detail-1",
  width: 1500,
  height: 1500,
  fallbackSrc: "https://media.purehaven.test/public/media-detail-1/rendition-800.webp",
  sources: [
    {
      type: "image/avif",
      srcSet:
        "https://media.purehaven.test/public/media-detail-1/rendition-400.avif 400w, " +
        "https://media.purehaven.test/public/media-detail-1/rendition-800.avif 800w, " +
        "https://media.purehaven.test/public/media-detail-1/rendition-1200.avif 1200w, " +
        "https://media.purehaven.test/public/media-detail-1/rendition-1500.avif 1500w",
    },
    {
      type: "image/webp",
      srcSet:
        "https://media.purehaven.test/public/media-detail-1/rendition-400.webp 400w, " +
        "https://media.purehaven.test/public/media-detail-1/rendition-800.webp 800w, " +
        "https://media.purehaven.test/public/media-detail-1/rendition-1200.webp 1200w, " +
        "https://media.purehaven.test/public/media-detail-1/rendition-1500.webp 1500w",
    },
  ],
};

function renderPDP(
  product: React.ComponentProps<typeof ProductDetailsClient>["product"]
): string {
  return renderToStaticMarkup(
    React.createElement(
      CartProvider,
      null,
      React.createElement(ProductDetailsClient, { product })
    )
  );
}

describe("Task 22: Product Detail Responsive / High-DPI Managed Media Delivery", () => {
  it("1. Managed media renders <picture> with AVIF before WebP on PDP", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "managed",
          media: mockHighDpiMediaDto,
          altText: "High-DPI Facial Cleanser Detail",
        },
      ],
      primarySrc: mockHighDpiMediaDto.fallbackSrc,
      primaryKind: "managed",
    };

    const html = renderPDP({
      id: 201,
      name: "High-DPI Facial Cleanser",
      price: 1250,
      image: mockHighDpiMediaDto.fallbackSrc,
      images: [mockHighDpiMediaDto.fallbackSrc],
      category: "Skincare",
      media: projection,
    });

    assert.match(html, /<picture\b/i, "Must render <picture> element for managed media on PDP");
    assert.match(html, /type="image\/avif"/i, "Must include AVIF source");
    assert.match(html, /type="image\/webp"/i, "Must include WebP source");

    const avifPos = html.indexOf('type="image/avif"');
    const webpPos = html.indexOf('type="image/webp"');
    assert.ok(avifPos !== -1 && webpPos !== -1);
    assert.ok(avifPos < webpPos, "AVIF source must precede WebP source in PDP <picture>");
  });

  it("2. High-DPI renditions include all available widths up to 1500w and sizes attribute", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "managed",
          media: mockHighDpiMediaDto,
          altText: "High-DPI Facial Cleanser Detail",
        },
      ],
      primarySrc: mockHighDpiMediaDto.fallbackSrc,
      primaryKind: "managed",
    };

    const html = renderPDP({
      id: 201,
      name: "High-DPI Facial Cleanser",
      price: 1250,
      image: mockHighDpiMediaDto.fallbackSrc,
      images: [mockHighDpiMediaDto.fallbackSrc],
      category: "Skincare",
      media: projection,
    });

    // Verify 1200w and 1500w high-DPI renditions exist in srcset
    assert.match(html, /1200w/);
    assert.match(html, /1500w/);

    // PDP sizes attribute: "(max-width: 768px) 100vw, 50vw"
    assert.match(html, /sizes="\(max-width: 768px\) 100vw, 50vw"/);
  });

  it("3. Main PDP image has eager loading and high fetchpriority for LCP", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "managed",
          media: mockHighDpiMediaDto,
          altText: "High-DPI Facial Cleanser Detail",
        },
      ],
      primarySrc: mockHighDpiMediaDto.fallbackSrc,
      primaryKind: "managed",
    };

    const html = renderPDP({
      id: 201,
      name: "High-DPI Facial Cleanser",
      price: 1250,
      image: mockHighDpiMediaDto.fallbackSrc,
      images: [mockHighDpiMediaDto.fallbackSrc],
      category: "Skincare",
      media: projection,
    });

    assert.match(html, /loading="eager"/);
    assert.match(html, /fetchpriority="high"/i);
  });

  it("4. Zero master / private / staging URL leakage on PDP", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "managed",
          media: mockHighDpiMediaDto,
          altText: "Cleanser",
        },
      ],
      primarySrc: mockHighDpiMediaDto.fallbackSrc,
      primaryKind: "managed",
    };

    const html = renderPDP({
      id: 201,
      name: "High-DPI Facial Cleanser",
      price: 1250,
      image: mockHighDpiMediaDto.fallbackSrc,
      images: [mockHighDpiMediaDto.fallbackSrc],
      category: "Skincare",
      media: projection,
    });

    assert.strictEqual(html.includes("canonical-master"), false);
    assert.strictEqual(html.includes("PRIVATE_SOURCE"), false);
    assert.strictEqual(html.includes("staging/"), false);
    assert.strictEqual(html.includes("master.webp"), false);
  });

  it("5. Variant image presentation override takes precedence over managed media", () => {
    const projection: PublicProductMediaProjection = {
      gallery: [
        {
          kind: "managed",
          media: mockHighDpiMediaDto,
          altText: "Base Managed",
        },
      ],
      primarySrc: mockHighDpiMediaDto.fallbackSrc,
      primaryKind: "managed",
    };

    const html = renderPDP({
      id: 202,
      name: "Variant Cleanser",
      price: 1250,
      image: mockHighDpiMediaDto.fallbackSrc,
      images: [mockHighDpiMediaDto.fallbackSrc],
      category: "Skincare",
      media: projection,
      variants: [
        {
          id: 1,
          label: "50ml Travel Size",
          price: 650,
          stock: 5,
          image: "/uploads/products/travel-size.jpg",
        },
      ],
    });

    // Selected variant has custom image, so main display must show variant image via SafeImage, NOT the managed gallery <picture>
    assert.doesNotMatch(html, /<picture\b/i, "Variant override should not render base managed <picture>");
    assert.match(html, /src="\/uploads\/products\/travel-size\.jpg"/);
  });

  it("6. Pure legacy product preserves SafeImage behavior without <picture>", () => {
    const html = renderPDP({
      id: 203,
      name: "Legacy Toner",
      price: 850,
      image: "/uploads/products/legacy-toner.jpg",
      images: ["/uploads/products/legacy-toner.jpg"],
      category: "Skincare",
    });

    assert.doesNotMatch(html, /<picture\b/i);
    assert.match(html, /src="\/uploads\/products\/legacy-toner\.jpg"/);
  });
});
