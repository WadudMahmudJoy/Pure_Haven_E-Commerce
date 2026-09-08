import assert from "node:assert/strict";
import test from "node:test";
import {
  hashProcessingProfile,
  canonicalizeProcessingProfile,
  PRODUCT_IMAGE_PROFILE_V1,
  type ProductImageProcessingProfile,
} from "../lib/media/processingProfile";

test("PRODUCT_IMAGE_PROFILE_V1 embodies verified calibration values", () => {
  assert.equal(PRODUCT_IMAGE_PROFILE_V1.version, "product-image-v1");
  assert.deepEqual(PRODUCT_IMAGE_PROFILE_V1.enabledDeliveryFormats, ["webp", "avif"]);
  assert.deepEqual(PRODUCT_IMAGE_PROFILE_V1.widths, [320, 640, 960, 1280, 1600, 2048]);
  assert.equal(PRODUCT_IMAGE_PROFILE_V1.webpQuality, 88);
  assert.equal(PRODUCT_IMAGE_PROFILE_V1.avifQuality, 65);
  assert.equal(PRODUCT_IMAGE_PROFILE_V1.inputPixelLimit, 40_000_000);
  assert.equal(PRODUCT_IMAGE_PROFILE_V1.inputAxisLimit, 12_000);
  assert.equal(PRODUCT_IMAGE_PROFILE_V1.masterLongEdgeLimit, 5_120);
  assert.equal(PRODUCT_IMAGE_PROFILE_V1.masterPixelLimit, 24_000_000);
  assert.equal(PRODUCT_IMAGE_PROFILE_V1.masterStrategy.opaque, "lossless-webp");
  assert.equal(PRODUCT_IMAGE_PROFILE_V1.masterStrategy.alpha, "lossless-webp");
});

test("hashProcessingProfile produces deterministic 64-character hex hash", () => {
  const hash1 = hashProcessingProfile(PRODUCT_IMAGE_PROFILE_V1);
  const hash2 = hashProcessingProfile(PRODUCT_IMAGE_PROFILE_V1);
  assert.equal(typeof hash1, "string");
  assert.equal(hash1.length, 64);
  assert.match(hash1, /^[0-9a-f]{64}$/);
  assert.equal(hash1, hash2);
});

test("canonicalizeProcessingProfile is key-order independent for nested objects", () => {
  const p1: ProductImageProcessingProfile = {
    version: "v1",
    enabledDeliveryFormats: ["webp", "avif"],
    widths: [320, 640],
    webpQuality: 88,
    avifQuality: 65,
    inputPixelLimit: 40000000,
    inputAxisLimit: 12000,
    masterLongEdgeLimit: 5120,
    masterPixelLimit: 24000000,
    masterStrategy: {
      opaque: "lossless-webp",
      alpha: "lossless-webp",
    },
  };

  // Same values but initialized with different key order
  const p2: ProductImageProcessingProfile = {
    masterStrategy: {
      alpha: "lossless-webp",
      opaque: "lossless-webp",
    },
    masterPixelLimit: 24000000,
    masterLongEdgeLimit: 5120,
    inputAxisLimit: 12000,
    inputPixelLimit: 40000000,
    avifQuality: 65,
    webpQuality: 88,
    widths: [320, 640],
    enabledDeliveryFormats: ["webp", "avif"],
    version: "v1",
  };

  assert.equal(canonicalizeProcessingProfile(p1), canonicalizeProcessingProfile(p2));
  assert.equal(hashProcessingProfile(p1), hashProcessingProfile(p2));
});

test("hashProcessingProfile changes when any semantic processing property changes", () => {
  const base = PRODUCT_IMAGE_PROFILE_V1;

  const changedFormat: ProductImageProcessingProfile = {
    ...base,
    enabledDeliveryFormats: ["webp"], // WebP only
  };
  assert.notEqual(hashProcessingProfile(base), hashProcessingProfile(changedFormat));

  const changedQuality: ProductImageProcessingProfile = {
    ...base,
    webpQuality: 85,
  };
  assert.notEqual(hashProcessingProfile(base), hashProcessingProfile(changedQuality));

  const changedWidths: ProductImageProcessingProfile = {
    ...base,
    widths: [320, 640, 1280],
  };
  assert.notEqual(hashProcessingProfile(base), hashProcessingProfile(changedWidths));
});
