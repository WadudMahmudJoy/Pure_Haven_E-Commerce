import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  DefaultImageProcessor,
  type CanonicalMasterInput,
} from "../lib/media/imageProcessor";
import {
  PRODUCT_IMAGE_PROFILE_V1,
  type ProductImageProcessingProfile,
} from "../lib/media/processingProfile";
import { createPhase6MediaFixture } from "./helpers/mediaFixtures";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Task 14: Responsive Rendition Generation (WebP + AVIF)", () => {
  const processor = new DefaultImageProcessor();

  async function createMaster(width: number, height: number, kind: "photo" | "transparent" = "photo"): Promise<CanonicalMasterInput> {
    const rawFixture = await createPhase6MediaFixture(kind, width, height);
    const masterLossless = await sharp(rawFixture).webp({ lossless: true }).toBuffer();
    const bytes = new Uint8Array(masterLossless);
    return {
      bytes,
      mimeType: "image/webp",
      width,
      height,
      sha256: sha256(bytes),
    };
  }

  it("generates exactly useful subset of widths for 1500px master without upscaling", async () => {
    const master1500 = await createMaster(1500, 1000);
    const renditions = await processor.generateDeliveryRenditions(master1500, PRODUCT_IMAGE_PROFILE_V1);

    assert.ok(renditions.length > 0, "Should generate renditions");

    const webpRenditions = renditions.filter((r) => r.mimeType === "image/webp");
    const avifRenditions = renditions.filter((r) => r.mimeType === "image/avif");

    const expectedWidths = [320, 640, 960, 1280, 1500];
    assert.deepEqual(
      webpRenditions.map((r) => r.width).sort((a, b) => a - b),
      expectedWidths
    );
    assert.deepEqual(
      avifRenditions.map((r) => r.width).sort((a, b) => a - b),
      expectedWidths
    );

    // Ensure no upscaled widths (1600, 2048) exist
    assert.equal(renditions.some((r) => r.width > 1500), false);
  });

  it("enforces role=RENDITION and accessClass=PUBLIC_DELIVERY on all renditions", async () => {
    const master = await createMaster(800, 600);
    const renditions = await processor.generateDeliveryRenditions(master, PRODUCT_IMAGE_PROFILE_V1);

    for (const rendition of renditions) {
      assert.equal(rendition.role, "RENDITION");
      assert.equal(rendition.accessClass, "PUBLIC_DELIVERY");
      assert.ok(rendition.variantKey.length > 0);
      assert.equal(rendition.sha256, sha256(rendition.bytes));
      // Master bytes must never appear in renditions
      assert.notEqual(rendition.sha256, master.sha256);
    }
  });

  it("generates only WebP when AVIF is not in enabledDeliveryFormats", async () => {
    const webpOnlyProfile: ProductImageProcessingProfile = {
      ...PRODUCT_IMAGE_PROFILE_V1,
      version: "product-image-webp-only",
      enabledDeliveryFormats: ["webp"],
      avifQuality: null,
    };

    const master = await createMaster(1000, 800);
    const renditions = await processor.generateDeliveryRenditions(master, webpOnlyProfile);

    assert.ok(renditions.length > 0);
    assert.ok(renditions.every((r) => r.mimeType === "image/webp"));
    assert.equal(renditions.some((r) => r.mimeType === "image/avif"), false);
  });

  it("does not upscale small images smaller than ladder rungs", async () => {
    // 200px master: smaller than lowest rung 320
    const smallMaster = await createMaster(200, 150);
    const renditions = await processor.generateDeliveryRenditions(smallMaster, PRODUCT_IMAGE_PROFILE_V1);

    assert.ok(renditions.length > 0);
    for (const rendition of renditions) {
      assert.ok(rendition.width <= 200, `Width ${rendition.width} must not exceed master width 200`);
    }
  });

  it("preserves transparency in renditions for alpha masters", async () => {
    const transparentMaster = await createMaster(400, 400, "transparent");
    const renditions = await processor.generateDeliveryRenditions(transparentMaster, PRODUCT_IMAGE_PROFILE_V1);

    for (const rendition of renditions) {
      const meta = await sharp(rendition.bytes).metadata();
      assert.equal(meta.hasAlpha, true, `Rendition ${rendition.variantKey} must preserve alpha`);
    }
  });

  it("preserves aspect ratio across all generated widths", async () => {
    // Aspect ratio 1200 / 800 = 1.5
    const master = await createMaster(1200, 800);
    const renditions = await processor.generateDeliveryRenditions(master, PRODUCT_IMAGE_PROFILE_V1);

    for (const rendition of renditions) {
      const expectedHeight = Math.round((rendition.width * 800) / 1200);
      assert.ok(
        Math.abs(rendition.height - expectedHeight) <= 1,
        `Height ${rendition.height} should match expected ${expectedHeight} within 1px`
      );
    }
  });
});
