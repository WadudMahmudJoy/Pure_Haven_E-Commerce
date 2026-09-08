import { createHash } from "node:crypto";

export type ProductImageProcessingProfile = Readonly<{
  version: string;
  enabledDeliveryFormats: readonly ("webp" | "avif")[];
  widths: readonly number[];
  webpQuality: number;
  avifQuality: number | null;
  inputPixelLimit: number;
  inputAxisLimit: number;
  masterLongEdgeLimit: number;
  masterPixelLimit: number;
  masterStrategy: Readonly<{
    opaque: "lossless-webp" | "lossless-tiff";
    alpha: "lossless-webp" | "lossless-png";
  }>;
}>;

export const PRODUCT_IMAGE_PROFILE_V1: ProductImageProcessingProfile = {
  version: "product-image-v1",
  enabledDeliveryFormats: ["webp", "avif"],
  widths: [320, 640, 960, 1280, 1600, 2048],
  webpQuality: 88,
  avifQuality: 65,
  inputPixelLimit: 40_000_000,
  inputAxisLimit: 12_000,
  masterLongEdgeLimit: 5_120,
  masterPixelLimit: 24_000_000,
  masterStrategy: {
    opaque: "lossless-webp",
    alpha: "lossless-webp",
  },
};

/**
 * Serializes only semantic image processing settings in a canonical, key-order-independent format.
 * Strictly excludes operational/environment metadata such as storage buckets, endpoints, credentials,
 * and hostnames so that profileDefinitionHash represents pure media transformation semantics.
 */
export function canonicalizeProcessingProfile(profile: ProductImageProcessingProfile): string {
  const canonicalObj = {
    avifQuality: profile.avifQuality,
    enabledDeliveryFormats: [...profile.enabledDeliveryFormats],
    inputAxisLimit: profile.inputAxisLimit,
    inputPixelLimit: profile.inputPixelLimit,
    masterLongEdgeLimit: profile.masterLongEdgeLimit,
    masterPixelLimit: profile.masterPixelLimit,
    masterStrategy: {
      alpha: profile.masterStrategy.alpha,
      opaque: profile.masterStrategy.opaque,
    },
    version: profile.version,
    webpQuality: profile.webpQuality,
    widths: [...profile.widths],
  };
  return JSON.stringify(canonicalObj);
}

export function hashProcessingProfile(profile: ProductImageProcessingProfile): string {
  return createHash("sha256").update(canonicalizeProcessingProfile(profile)).digest("hex");
}
