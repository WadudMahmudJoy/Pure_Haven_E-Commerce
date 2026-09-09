import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  validateProductImageUploadEnvelope,
  DefaultImageProcessor,
  type ProductImageSourceInput,
} from "../lib/media/imageProcessor";
import { PRODUCT_IMAGE_PROFILE_V1 } from "../lib/media/processingProfile";
import { createPhase6MediaFixture } from "./helpers/mediaFixtures";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Task 13: Media Admission Validation & Canonical Master Security", () => {
  const processor = new DefaultImageProcessor();
  const profile = PRODUCT_IMAGE_PROFILE_V1;

  describe("validateProductImageUploadEnvelope (Lightweight Preliminary Admission)", () => {
    it("accepts valid JPEG and normalizes MIME aliases", async () => {
      const jpegBytes = await sharp({
        create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 100, b: 50 } },
      }).jpeg().toBuffer();

      const res1 = validateProductImageUploadEnvelope({
        bytes: new Uint8Array(jpegBytes),
        declaredMimeType: "image/jpeg",
      });
      assert.deepEqual(res1, { normalizedMimeType: "image/jpeg", detectedContainer: "jpeg" });

      const res2 = validateProductImageUploadEnvelope({
        bytes: new Uint8Array(jpegBytes),
        declaredMimeType: "IMAGE/JPG",
      });
      assert.deepEqual(res2, { normalizedMimeType: "image/jpeg", detectedContainer: "jpeg" });
    });

    it("accepts valid PNG bytes", async () => {
      const pngBytes = await createPhase6MediaFixture("photo", 32, 32);
      const res = validateProductImageUploadEnvelope({
        bytes: pngBytes,
        declaredMimeType: "image/png",
      });
      assert.deepEqual(res, { normalizedMimeType: "image/png", detectedContainer: "png" });
    });

    it("accepts valid WebP bytes", async () => {
      const webpBytes = await sharp({
        create: { width: 32, height: 32, channels: 3, background: { r: 50, g: 150, b: 200 } },
      }).webp().toBuffer();

      const res = validateProductImageUploadEnvelope({
        bytes: new Uint8Array(webpBytes),
        declaredMimeType: "image/webp",
      });
      assert.deepEqual(res, { normalizedMimeType: "image/webp", detectedContainer: "webp" });
    });

    it("accepts valid AVIF bytes", async () => {
      const avifBytes = await sharp({
        create: { width: 32, height: 32, channels: 3, background: { r: 120, g: 180, b: 60 } },
      }).avif().toBuffer();

      const res = validateProductImageUploadEnvelope({
        bytes: new Uint8Array(avifBytes),
        declaredMimeType: "image/avif",
      });
      assert.deepEqual(res, { normalizedMimeType: "image/avif", detectedContainer: "avif" });
    });

    it("rejects unsupported declared MIME types", async () => {
      const pngBytes = await createPhase6MediaFixture("photo", 16, 16);
      assert.throws(
        () => validateProductImageUploadEnvelope({ bytes: pngBytes, declaredMimeType: "image/gif" }),
        /UNSUPPORTED_FORMAT/
      );
      assert.throws(
        () => validateProductImageUploadEnvelope({ bytes: pngBytes, declaredMimeType: "image/svg+xml" }),
        /UNSUPPORTED_FORMAT/
      );
      assert.throws(
        () => validateProductImageUploadEnvelope({ bytes: pngBytes, declaredMimeType: "application/pdf" }),
        /UNSUPPORTED_FORMAT/
      );
    });

    it("rejects unsupported container formats (GIF, SVG, BMP, TIFF, random bytes)", async () => {
      const gifBytes = Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;");
      assert.throws(
        () => validateProductImageUploadEnvelope({ bytes: new Uint8Array(gifBytes), declaredMimeType: "image/jpeg" }),
        /UNSUPPORTED_FORMAT|FORMAT_MISMATCH/
      );

      const svgBytes = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10'/></svg>");
      assert.throws(
        () => validateProductImageUploadEnvelope({ bytes: new Uint8Array(svgBytes), declaredMimeType: "image/png" }),
        /UNSUPPORTED_FORMAT|FORMAT_MISMATCH/
      );

      const randomBytes = Buffer.from("not an image at all but some random text content");
      assert.throws(
        () => validateProductImageUploadEnvelope({ bytes: new Uint8Array(randomBytes), declaredMimeType: "image/jpeg" }),
        /UNSUPPORTED_FORMAT|UNKNOWN_CONTAINER/
      );
    });

    it("rejects declared MIME vs detected container mismatches", async () => {
      const jpegBytes = await sharp({
        create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
      }).jpeg().toBuffer();

      assert.throws(
        () => validateProductImageUploadEnvelope({ bytes: new Uint8Array(jpegBytes), declaredMimeType: "image/png" }),
        /FORMAT_MISMATCH/
      );
      assert.throws(
        () => validateProductImageUploadEnvelope({ bytes: new Uint8Array(jpegBytes), declaredMimeType: "image/webp" }),
        /FORMAT_MISMATCH/
      );
    });

    it("rejects animated containers during preliminary admission", async () => {
      // Synthetic APNG (PNG signature followed by IHDR then acTL chunk)
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      // acTL chunk: 4-byte len (8), 4-byte 'acTL', 8-byte data, 4-byte CRC
      const actlChunk = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x08]),
        Buffer.from("acTL", "ascii"),
        Buffer.alloc(8),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
      ]);
      const fakeApng = Buffer.concat([pngHeader, Buffer.alloc(25), actlChunk]);

      assert.throws(
        () => validateProductImageUploadEnvelope({ bytes: new Uint8Array(fakeApng), declaredMimeType: "image/png" }),
        /ANIMATED_MEDIA_UNSUPPORTED/
      );

      // Synthetic animated WebP: RIFF....WEBPVP8X with animation flag set (bit 1 of flags byte at offset 20)
      const riffHeader = Buffer.from("RIFF....WEBPVP8X", "ascii");
      const vp8xData = Buffer.alloc(10);
      vp8xData[4] = 0x02; // animation bit set
      const fakeAnimWebp = Buffer.concat([riffHeader, vp8xData]);

      assert.throws(
        () => validateProductImageUploadEnvelope({ bytes: new Uint8Array(fakeAnimWebp), declaredMimeType: "image/webp" }),
        /ANIMATED_MEDIA_UNSUPPORTED/
      );
    });
  });

  describe("ImageProcessor.processInitialProductImage (Real Decode & Master Normalization)", () => {
    it("successfully decodes JPEG and generates canonical MASTER with lossless WebP", async () => {
      const jpegBuffer = await sharp({
        create: { width: 100, height: 80, channels: 3, background: { r: 210, g: 150, b: 75 } },
      }).jpeg().toBuffer();

      const input: ProductImageSourceInput = {
        bytes: new Uint8Array(jpegBuffer),
        declaredMimeType: "image/jpeg",
      };

      const result = await processor.processInitialProductImage(input, profile);
      const master = result.canonicalMaster;

      assert.equal(master.role, "MASTER");
      assert.equal(master.accessClass, "PRIVATE_SOURCE");
      assert.equal(master.variantKey, "master");
      assert.equal(master.mimeType, "image/webp");
      assert.equal(master.width, 100);
      assert.equal(master.height, 80);
      assert.equal(master.sha256, sha256(master.bytes));

      // Verify the generated bytes decode cleanly as lossless WebP
      const masterMeta = await sharp(master.bytes).metadata();
      assert.equal(masterMeta.format, "webp");
      assert.equal(masterMeta.width, 100);
      assert.equal(masterMeta.height, 80);
    });

    it("preserves alpha transparency in canonical master", async () => {
      const transparentPng = await createPhase6MediaFixture("transparent", 64, 64);
      const input: ProductImageSourceInput = {
        bytes: transparentPng,
        declaredMimeType: "image/png",
      };

      const result = await processor.processInitialProductImage(input, profile);
      const master = result.canonicalMaster;

      assert.equal(master.role, "MASTER");
      assert.equal(master.accessClass, "PRIVATE_SOURCE");
      assert.equal(master.mimeType, "image/webp");

      const masterMeta = await sharp(master.bytes).metadata();
      assert.equal(masterMeta.hasAlpha, true);
    });

    it("rejects corrupted or truncated raster buffers during real decode", async () => {
      const fullJpeg = await sharp({
        create: { width: 40, height: 40, channels: 3, background: { r: 10, g: 20, b: 30 } },
      }).jpeg().toBuffer();
      // Has valid JPEG SOI and JFIF APP0 headers, but truncated stream
      const truncatedJpeg = fullJpeg.subarray(0, 30);
      const input: ProductImageSourceInput = {
        bytes: new Uint8Array(truncatedJpeg),
        declaredMimeType: "image/jpeg",
      };

      await assert.rejects(
        () => processor.processInitialProductImage(input, profile),
        /MALFORMED_IMAGE|DECODE_FAILED/
      );
    });

    it("rejects images exceeding axis limits", async () => {
      const mockProfile = {
        ...profile,
        inputAxisLimit: 200,
      };

      const largeAxisBuffer = await sharp({
        create: { width: 250, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } },
      }).png().toBuffer();

      const input: ProductImageSourceInput = {
        bytes: new Uint8Array(largeAxisBuffer),
        declaredMimeType: "image/png",
      };

      await assert.rejects(
        () => processor.processInitialProductImage(input, mockProfile),
        /IMAGE_DIMENSIONS_EXCEEDED/
      );
    });

    it("rejects images exceeding pixel limits", async () => {
      const mockProfile = {
        ...profile,
        inputPixelLimit: 1000,
      };

      const largePixelsBuffer = await sharp({
        create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } },
      }).png().toBuffer(); // 2500 pixels > 1000

      const input: ProductImageSourceInput = {
        bytes: new Uint8Array(largePixelsBuffer),
        declaredMimeType: "image/png",
      };

      await assert.rejects(
        () => processor.processInitialProductImage(input, mockProfile),
        /IMAGE_DIMENSIONS_EXCEEDED/
      );
    });

    it("downscales canonical master if input exceeds masterLongEdgeLimit without upscaling small inputs", async () => {
      const mockProfile = {
        ...profile,
        masterLongEdgeLimit: 120,
      };

      // 200x100 input -> should be downscaled so max(w,h) == 120, i.e. 120x60
      const largeMasterBuffer = await sharp({
        create: { width: 200, height: 100, channels: 3, background: { r: 50, g: 100, b: 150 } },
      }).png().toBuffer();

      const input: ProductImageSourceInput = {
        bytes: new Uint8Array(largeMasterBuffer),
        declaredMimeType: "image/png",
      };

      const result = await processor.processInitialProductImage(input, mockProfile);
      assert.equal(result.canonicalMaster.width, 120);
      assert.equal(result.canonicalMaster.height, 60);

      // Smaller input: 80x40 -> should remain 80x40, NEVER upscaled to 120
      const smallBuffer = await sharp({
        create: { width: 80, height: 40, channels: 3, background: { r: 50, g: 100, b: 150 } },
      }).png().toBuffer();

      const smallResult = await processor.processInitialProductImage({
        bytes: new Uint8Array(smallBuffer),
        declaredMimeType: "image/png",
      }, mockProfile);

      assert.equal(smallResult.canonicalMaster.width, 80);
      assert.equal(smallResult.canonicalMaster.height, 40);
    });

    it("auto-orients image and strips metadata", async () => {
      // Create image with EXIF orientation 6 (90 degrees CW)
      const rotatedBuffer = await sharp({
        create: { width: 60, height: 40, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer();

      const input: ProductImageSourceInput = {
        bytes: new Uint8Array(rotatedBuffer),
        declaredMimeType: "image/jpeg",
      };

      const result = await processor.processInitialProductImage(input, profile);
      const masterMeta = await sharp(result.canonicalMaster.bytes).metadata();

      // Sharp rotate() transposes 60x40 to 40x60 and resets orientation
      assert.equal(result.canonicalMaster.width, 40);
      assert.equal(result.canonicalMaster.height, 60);
      // EXIF metadata should be stripped
      assert.equal(masterMeta.orientation, undefined);
    });

    it("normalizes colorspace to sRGB", async () => {
      const iccBuffer = await createPhase6MediaFixture("icc-profile", 40, 40);
      const input: ProductImageSourceInput = {
        bytes: iccBuffer,
        declaredMimeType: "image/png",
      };

      const result = await processor.processInitialProductImage(input, profile);
      const masterMeta = await sharp(result.canonicalMaster.bytes).metadata();
      assert.equal(masterMeta.space, "srgb");
    });
  });
});
