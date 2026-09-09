import type { Prisma } from "../../generated/prisma/client";
import {
  normalizeProductImageReference,
  classifyLegacyProductImageUrl,
} from "./galleryPersistence";
import { productMediaAttachmentService } from "../media/productMediaAttachmentService";

export type ProductGalleryWriteItem =
  | Readonly<{ kind: "managed"; managedMediaId: string; altText?: string }>
  | Readonly<{ kind: "legacy-existing"; productImageId: number; altText?: string }>;

export function isManagedItem(
  value: unknown
): value is { kind: "managed"; managedMediaId: string; altText?: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "managed" &&
    typeof v.managedMediaId === "string" &&
    v.managedMediaId.trim().length > 0
  );
}

export function isLegacyExistingItem(
  value: unknown
): value is { kind: "legacy-existing"; productImageId: number; altText?: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const idNum = Number(v.productImageId);
  return (
    v.kind === "legacy-existing" &&
    Number.isInteger(idNum) &&
    idNum > 0
  );
}

export function parseProductGalleryWriteItem(value: unknown): ProductGalleryWriteItem {
  if (isManagedItem(value)) {
    const v = value as Record<string, unknown>;
    return {
      kind: "managed",
      managedMediaId: (v.managedMediaId as string).trim(),
      altText: typeof v.altText === "string" ? v.altText.trim() : undefined,
    };
  }
  if (isLegacyExistingItem(value)) {
    const v = value as Record<string, unknown>;
    return {
      kind: "legacy-existing",
      productImageId: Number(v.productImageId),
      altText: typeof v.altText === "string" ? v.altText.trim() : undefined,
    };
  }
  throw new GalleryWriteError(
    "PRODUCT_GALLERY_ITEM_INVALID: Invalid gallery write item structure",
    400
  );
}

export type GalleryWriteIntent =
  | {
      kind: "structured-gallery";
      items: ProductGalleryWriteItem[];
    }
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
  const hasGalleryField = Object.prototype.hasOwnProperty.call(body, "gallery");
  const hasImagesField = Object.prototype.hasOwnProperty.call(body, "images");
  const hasLegacyImageField = Object.prototype.hasOwnProperty.call(body, "image");

  if (hasGalleryField) {
    if (!Array.isArray(body.gallery)) {
      return {
        ok: false,
        statusCode: 400,
        message: "Gallery must be an array of gallery write items.",
      };
    }

    if (body.gallery.length === 0) {
      return {
        ok: false,
        statusCode: 400,
        message: "Gallery array cannot be empty (must contain 1 to 4 items).",
      };
    }

    if (body.gallery.length > 4) {
      return {
        ok: false,
        statusCode: 400,
        message: "Gallery array exceeds maximum allowed length of 4.",
      };
    }

    const items: ProductGalleryWriteItem[] = [];
    for (const raw of body.gallery) {
      try {
        items.push(parseProductGalleryWriteItem(raw));
      } catch (err) {
        return {
          ok: false,
          statusCode: 400,
          message: err instanceof Error ? err.message : "PRODUCT_GALLERY_ITEM_INVALID",
        };
      }
    }

    const seenManaged = new Set<string>();
    const seenLegacy = new Set<number>();
    for (const it of items) {
      if (it.kind === "managed") {
        if (seenManaged.has(it.managedMediaId)) {
          return {
            ok: false,
            statusCode: 400,
            message: "Duplicate managedMediaId in gallery is not permitted.",
          };
        }
        seenManaged.add(it.managedMediaId);
      } else {
        if (seenLegacy.has(it.productImageId)) {
          return {
            ok: false,
            statusCode: 400,
            message: "Duplicate productImageId in gallery is not permitted.",
          };
        }
        seenLegacy.add(it.productImageId);
      }
    }

    return {
      ok: true,
      intent: {
        kind: "structured-gallery",
        items,
      },
    };
  }

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

    // Check if images is array of structured items
    if (body.images.length > 0 && typeof body.images[0] === "object" && body.images[0] !== null) {
      const items: ProductGalleryWriteItem[] = [];
      for (const raw of body.images) {
        try {
          items.push(parseProductGalleryWriteItem(raw));
        } catch (err) {
          return {
            ok: false,
            statusCode: 400,
            message: err instanceof Error ? err.message : "PRODUCT_GALLERY_ITEM_INVALID",
          };
        }
      }
      return {
        ok: true,
        intent: {
          kind: "structured-gallery",
          items,
        },
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

  if (intent.kind === "structured-gallery") {
    const existingImages = await tx.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: "asc" },
    });
    const previousManagedIds = existingImages
      .map((img) => img.managedMediaId)
      .filter((id): id is string => Boolean(id));

    const resolvedItems: Array<{
      sourceKind: "MANAGED" | "LEGACY_LOCAL" | "LEGACY_EXTERNAL";
      managedMediaId: string | null;
      url: string;
      altText?: string | null;
    }> = [];

    for (const item of intent.items) {
      if (item.kind === "managed") {
        try {
          const { compatibilityUrl } = await productMediaAttachmentService.validateAndAttachMedia(
            tx,
            item.managedMediaId
          );
          resolvedItems.push({
            sourceKind: "MANAGED",
            managedMediaId: item.managedMediaId,
            url: compatibilityUrl,
            altText: item.altText ?? null,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new GalleryWriteError(msg, 400);
        }
      } else if (item.kind === "legacy-existing") {
        const existingRow = existingImages.find((img) => img.id === item.productImageId);
        if (!existingRow) {
          throw new GalleryWriteError(
            `PRODUCT_IMAGE_OWNERSHIP_MISMATCH: ProductImage ${item.productImageId} does not belong to product ${productId}`,
            400
          );
        }
        if (existingRow.sourceKind === "MANAGED") {
          throw new GalleryWriteError(
            `PRODUCT_IMAGE_OWNERSHIP_MISMATCH: Cannot retain managed image ${item.productImageId} as legacy-existing`,
            400
          );
        }
        resolvedItems.push({
          sourceKind: existingRow.sourceKind as "LEGACY_LOCAL" | "LEGACY_EXTERNAL",
          managedMediaId: null,
          url: existingRow.url,
          altText: item.altText ?? existingRow.altText ?? null,
        });
      }
    }

    // Replace ProductImage rows
    await tx.productImage.deleteMany({
      where: { productId },
    });

    for (let i = 0; i < resolvedItems.length; i++) {
      await tx.productImage.create({
        data: {
          productId,
          url: resolvedItems[i].url,
          sortOrder: i + 1,
          sourceKind: resolvedItems[i].sourceKind,
          managedMediaId: resolvedItems[i].managedMediaId,
          altText: resolvedItems[i].altText,
        },
      });
    }

    // Detached media handling
    const desiredManagedIds = resolvedItems
      .map((it) => it.managedMediaId)
      .filter((id): id is string => Boolean(id));
    const detachedManagedIds = previousManagedIds.filter((id) => !desiredManagedIds.includes(id));
    if (detachedManagedIds.length > 0) {
      await productMediaAttachmentService.handleDetachedMedia(tx, detachedManagedIds);
    }

    const primaryUrl = resolvedItems[0].url;
    return { primaryImageOverride: primaryUrl };
  }

  if (intent.kind === "gallery") {
    const existingImages = await tx.productImage.findMany({
      where: { productId },
    });
    const previousManagedIds = existingImages
      .map((img) => img.managedMediaId)
      .filter((id): id is string => Boolean(id));

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

    if (previousManagedIds.length > 0) {
      await productMediaAttachmentService.handleDetachedMedia(tx, previousManagedIds);
    }

    return { primaryImageOverride: intent.images[0] };
  }

  if (intent.kind === "legacy-image") {
    // Bounded read of existing gallery
    const existingImages = await tx.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: "asc" },
    });

    if (existingImages.some((img) => img.sourceKind === "MANAGED")) {
      throw new GalleryWriteError(
        "LEGACY_PRIMARY_IMAGE_MUTATION_NOT_ALLOWED_FOR_MANAGED_GALLERY",
        400
      );
    }

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
