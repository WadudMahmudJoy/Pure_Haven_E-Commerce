import { createHash } from "node:crypto";
import sharp, { type Sharp, type Metadata } from "sharp";
import type { ProductImageProcessingProfile } from "./processingProfile";

export type ProductImageSourceInput = Readonly<{
  bytes: Uint8Array;
  declaredMimeType: string;
}>;

export type ProductImageUploadEnvelopeValidation = Readonly<{
  normalizedMimeType: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
  detectedContainer: "jpeg" | "png" | "webp" | "avif";
}>;

export type CanonicalMasterInput = Readonly<{
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  sha256: string;
}>;

export type ProcessedMediaObject = Readonly<{
  role: "MASTER" | "RENDITION";
  accessClass: "PRIVATE_SOURCE" | "PUBLIC_DELIVERY";
  variantKey: string;
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  sha256: string;
}>;

export type ProcessedProductImage = Readonly<{
  canonicalMaster: ProcessedMediaObject;
  renditions: readonly ProcessedMediaObject[];
}>;

export interface ImageProcessor {
  processInitialProductImage(
    input: ProductImageSourceInput,
    profile: ProductImageProcessingProfile
  ): Promise<ProcessedProductImage>;

  generateDeliveryRenditions(
    master: CanonicalMasterInput,
    profile: ProductImageProcessingProfile
  ): Promise<readonly ProcessedMediaObject[]>;
}

function normalizeMime(raw: string): "image/jpeg" | "image/png" | "image/webp" | "image/avif" {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "image/jpeg";
  if (normalized === "image/png") return "image/png";
  if (normalized === "image/webp") return "image/webp";
  if (normalized === "image/avif") return "image/avif";
  throw new Error(`UNSUPPORTED_FORMAT: Declared MIME type '${raw}' is not supported for product images`);
}

function detectContainer(bytes: Uint8Array): "jpeg" | "png" | "webp" | "avif" {
  if (bytes.length < 3) {
    throw new Error("UNSUPPORTED_FORMAT: Buffer too small to identify container signature");
  }

  // Obvious unsupported formats:
  // GIF: GIF87a or GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    throw new Error("UNSUPPORTED_FORMAT: GIF format is unsupported");
  }

  // BMP: 'BM'
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    throw new Error("UNSUPPORTED_FORMAT: BMP format is unsupported");
  }

  // TIFF: 'II*\0' or 'MM\0*'
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    throw new Error("UNSUPPORTED_FORMAT: TIFF format is unsupported");
  }

  // SVG: text signature
  const headerText = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 100))).toString("utf8");
  if (/^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(headerText)) {
    throw new Error("UNSUPPORTED_FORMAT: SVG format is unsupported");
  }

  // JPEG: 0xFF, 0xD8, 0xFF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  // PNG: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    const buf = Buffer.from(bytes);
    if (buf.includes(Buffer.from("acTL"))) {
      throw new Error("ANIMATED_MEDIA_UNSUPPORTED: APNG animation is unsupported");
    }
    return "png";
  }

  // WebP: 'RIFF' .... 'WEBP'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const buf = Buffer.from(bytes);
    // Check for VP8X header at byte 12
    if (bytes.length >= 21 && buf.toString("ascii", 12, 16) === "VP8X") {
      const flags = bytes[20];
      // Bit 1 (0x02) indicates Animation
      if ((flags & 0x02) !== 0) {
        throw new Error("ANIMATED_MEDIA_UNSUPPORTED: Animated WebP is unsupported");
      }
    }
    if (buf.includes(Buffer.from("ANIM"))) {
      throw new Error("ANIMATED_MEDIA_UNSUPPORTED: Animated WebP is unsupported");
    }
    return "webp";
  }

  // AVIF: ISOBMFF box with 'ftyp'
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70 // 'ftyp'
  ) {
    const buf = Buffer.from(bytes);
    const boxSize = buf.readUInt32BE(0);
    const majorBrand = buf.toString("ascii", 8, 12);

    const brands = [majorBrand];
    const brandLimit = Math.min(boxSize > 0 ? boxSize : bytes.length, bytes.length);
    for (let o = 16; o + 4 <= brandLimit; o += 4) {
      brands.push(buf.toString("ascii", o, o + 4));
    }

    if (majorBrand === "avis" || buf.includes(Buffer.from("avis"))) {
      throw new Error("ANIMATED_MEDIA_UNSUPPORTED: Animated AVIF sequence is unsupported");
    }

    if (brands.includes("avif") || majorBrand === "avif" || brands.includes("mif1")) {
      return "avif";
    }
  }

  throw new Error("UNSUPPORTED_FORMAT: Unrecognized image container signature");
}

export function validateProductImageUploadEnvelope(
  input: ProductImageSourceInput
): ProductImageUploadEnvelopeValidation {
  const normalizedMimeType = normalizeMime(input.declaredMimeType);
  const detectedContainer = detectContainer(input.bytes);

  const containerToMime: Record<string, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    avif: "image/avif",
  };

  if (containerToMime[detectedContainer] !== normalizedMimeType) {
    throw new Error(
      `FORMAT_MISMATCH: Declared MIME '${input.declaredMimeType}' does not match detected container '${detectedContainer}'`
    );
  }

  return { normalizedMimeType, detectedContainer };
}

export class DefaultImageProcessor implements ImageProcessor {
  async processInitialProductImage(
    input: ProductImageSourceInput,
    profile: ProductImageProcessingProfile
  ): Promise<ProcessedProductImage> {
    // 1. Inexpensive preliminary envelope admission
    validateProductImageUploadEnvelope(input);

    // 2. Real decode with Sharp and defensive security limits
    let sharpInstance: Sharp;
    let metadata: Metadata;
    try {
      sharpInstance = sharp(input.bytes, {
        limitInputPixels: profile.inputPixelLimit,
        animated: false,
        failOn: "error",
      });
      metadata = await sharpInstance.metadata();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/pixel limit|input pixels/i.test(msg)) {
        throw new Error(`IMAGE_DIMENSIONS_EXCEEDED: ${msg}`);
      }
      throw new Error(`MALFORMED_IMAGE_DECODE_FAILED: ${msg}`);
    }

    if (!metadata.width || !metadata.height) {
      throw new Error("IMAGE_DIMENSIONS_MISSING: Could not decode image dimensions");
    }

    if (
      metadata.width > profile.inputAxisLimit ||
      metadata.height > profile.inputAxisLimit
    ) {
      throw new Error(
        `IMAGE_DIMENSIONS_EXCEEDED: Dimension ${metadata.width}x${metadata.height} exceeds axis limit ${profile.inputAxisLimit}`
      );
    }

    if (metadata.width * metadata.height > profile.inputPixelLimit) {
      throw new Error(
        `IMAGE_DIMENSIONS_EXCEEDED: Total pixels ${metadata.width * metadata.height} exceeds limit ${profile.inputPixelLimit}`
      );
    }

    if (metadata.pages && metadata.pages > 1) {
      throw new Error("ANIMATED_MEDIA_UNSUPPORTED: Multi-page media is unsupported");
    }

    // 3. Normalization pipeline: auto-orient, convert colorspace to sRGB, strip metadata
    let normalized = sharp(input.bytes, {
      limitInputPixels: profile.inputPixelLimit,
      animated: false,
      failOn: "error",
    })
      .rotate()
      .toColourspace("srgb");

    // Master sizing: constrain to masterLongEdgeLimit and masterPixelLimit without upscaling
    const maxEdge = Math.max(metadata.width, metadata.height);
    const pixelCount = metadata.width * metadata.height;
    if (maxEdge > profile.masterLongEdgeLimit || pixelCount > profile.masterPixelLimit) {
      normalized = normalized.resize({
        width: profile.masterLongEdgeLimit,
        height: profile.masterLongEdgeLimit,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // 4. Encode canonical master using profile master strategy
    const hasAlpha = Boolean(metadata.hasAlpha);
    const strategy = hasAlpha ? profile.masterStrategy.alpha : profile.masterStrategy.opaque;

    let encodedSharp: Sharp;
    let masterMime: string;

    if (strategy === "lossless-webp") {
      encodedSharp = normalized.webp({ lossless: true, quality: 100 });
      masterMime = "image/webp";
    } else if (strategy === "lossless-png") {
      encodedSharp = normalized.png();
      masterMime = "image/png";
    } else if (strategy === "lossless-tiff") {
      encodedSharp = normalized.tiff({ compression: "lzw" });
      masterMime = "image/tiff";
    } else {
      encodedSharp = normalized.webp({ lossless: true, quality: 100 });
      masterMime = "image/webp";
    }

    let masterBuffer: Buffer;
    let masterMeta: Metadata;
    try {
      masterBuffer = await encodedSharp.toBuffer();
      masterMeta = await sharp(masterBuffer).metadata();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`MALFORMED_IMAGE_DECODE_FAILED: ${msg}`);
    }

    const masterBytes = new Uint8Array(masterBuffer);
    const masterSha256 = createHash("sha256").update(masterBytes).digest("hex");

    const canonicalMaster: ProcessedMediaObject = {
      role: "MASTER",
      accessClass: "PRIVATE_SOURCE",
      variantKey: "master",
      bytes: masterBytes,
      mimeType: masterMime,
      width: masterMeta.width ?? metadata.width,
      height: masterMeta.height ?? metadata.height,
      sha256: masterSha256,
    };

    return {
      canonicalMaster,
      renditions: [],
    };
  }

  async generateDeliveryRenditions(
    _master: CanonicalMasterInput,
    _profile: ProductImageProcessingProfile
  ): Promise<readonly ProcessedMediaObject[]> {
    void _master;
    void _profile;
    return [];
  }
}

export const defaultImageProcessor = new DefaultImageProcessor();
