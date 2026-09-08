import type { Prisma } from "../../generated/prisma/client";
import {
  normalizeProductImageReference,
  classifyLegacyProductImageUrl,
} from "./galleryPersistence";

export type GalleryWriteIntent =
  | {
      kind: "gallery";
      images: string[];
    }
  | {
      kind: "legacy-image";
      image: string;
    }
  | {
      kind: "metadata-only";
    };

export function parseGalleryWriteIntent(body: Record<string, unknown>):
  | { ok: true; intent: GalleryWriteIntent }
  | { ok: false; statusCode: 400; message: string } {
  const hasImagesField = Object.prototype.hasOwnProperty.call(body, "images");
  const hasLegacyImageField = Object.prototype.hasOwnProperty.call(body, "image");

  if (hasImagesField) {
    if (!Array.isArray(body.images)) {
      return {
        ok: false,
        statusCode: 400,
        message: "Gallery 'images' must be an array of image URL strings.",
      };
    }

    if (body.images.length === 0) {
      return {
        ok: false,
        statusCode: 400,
        message: "Gallery 'images' array cannot be empty (must contain 1 to 4 images).",
      };
    }

    if (body.images.length > 4) {
      return {
        ok: false,
        statusCode: 400,
        message: "Gallery 'images' array exceeds maximum allowed length of 4.",
      };
    }

    const normalizedImages: string[] = [];
    for (const rawImg of body.images) {
      const norm = normalizeProductImageReference(rawImg);
      if (!norm.ok) {
        return {
          ok: false,
          statusCode: 400,
          message: norm.error,
        };
      }
      normalizedImages.push(norm.url);
    }

    const uniqueSet = new Set(normalizedImages);
    if (uniqueSet.size !== normalizedImages.length) {
      return {
        ok: false,
        statusCode: 400,
        message: "Duplicate image URLs are not permitted in product gallery.",
      };
    }

    if (hasLegacyImageField) {
      const normLegacy = normalizeProductImageReference(body.image);
      if (!normLegacy.ok) {
        return {
          ok: false,
          statusCode: 400,
          message: normLegacy.error,
        };
      }

      if (normLegacy.url !== normalizedImages[0]) {
        return {
          ok: false,
          statusCode: 400,
          message: "Conflicting image authority: legacy 'image' does not match gallery primary 'images[0]'.",
        };
      }
    }

    return {
      ok: true,
      intent: {
        kind: "gallery",
        images: normalizedImages,
      },
    };
  }

  if (hasLegacyImageField) {
    const normLegacy = normalizeProductImageReference(body.image);
    if (!normLegacy.ok) {
      return {
        ok: false,
        statusCode: 400,
        message: normLegacy.error,
      };
    }

    return {
      ok: true,
      intent: {
        kind: "legacy-image",
        image: normLegacy.url,
      },
    };
  }

  return {
    ok: true,
    intent: {
      kind: "metadata-only",
    },
  };
}

export class GalleryWriteError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "GalleryWriteError";
    this.statusCode = statusCode;
  }
}

export async function applyGalleryMutation(
  tx: Prisma.TransactionClient,
  params: { productId: number; intent: GalleryWriteIntent }
): Promise<{ primaryImageOverride?: string }> {
  const { productId, intent } = params;

  if (intent.kind === "gallery") {
    // Atomically replace full gallery
    await tx.productImage.deleteMany({
      where: { productId },
    });

    for (let i = 0; i < intent.images.length; i++) {
      await tx.productImage.create({
        data: {
          productId,
          url: intent.images[i],
          sortOrder: i + 1,
          sourceKind: classifyLegacyProductImageUrl(intent.images[i]),
        },
      });
    }

    return { primaryImageOverride: intent.images[0] };
  }

  if (intent.kind === "legacy-image") {
    // Bounded read of existing gallery
    const existingImages = await tx.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: "asc" },
    });

    for (const secondary of existingImages.filter((img) => img.sortOrder >= 2)) {
      const normalizedExisting = normalizeProductImageReference(secondary.url);
      if (normalizedExisting.ok && normalizedExisting.url === intent.image) {
        throw new GalleryWriteError(
          "Duplicate image URL: legacy primary image matches an existing secondary gallery image.",
          400
        );
      }
      if (secondary.url.trim() === intent.image) {
        throw new GalleryWriteError(
          "Duplicate image URL: legacy primary image matches an existing secondary gallery image.",
          400
        );
      }
    }

    const pos1 = existingImages.find((img) => img.sortOrder === 1);
    if (pos1) {
      await tx.productImage.update({
        where: { id: pos1.id },
        data: {
          url: intent.image,
          sourceKind: classifyLegacyProductImageUrl(intent.image),
        },
      });
    } else {
      await tx.productImage.create({
        data: {
          productId,
          url: intent.image,
          sortOrder: 1,
          sourceKind: classifyLegacyProductImageUrl(intent.image),
        },
      });
    }

    return { primaryImageOverride: intent.image };
  }

  // metadata-only: zero ProductImage queries or mutations
  return {};
}
