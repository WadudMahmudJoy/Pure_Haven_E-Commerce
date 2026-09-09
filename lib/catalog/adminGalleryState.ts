import type { ProductGalleryWriteItem } from "./galleryWrite";

export type AdminGalleryItem = {
  id: string;
  url: string;
  managedMediaId?: string | null;
  productImageId?: number | null;
  sourceKind?: "MANAGED" | "LEGACY_LOCAL" | "LEGACY_EXTERNAL";
  altText?: string | null;
};

/**
 * Moves gallery item at index up (towards position 0 / Primary).
 * Returns a new array with items swapped, or a shallow copy if index is 0 or out of bounds.
 */
export function moveGalleryItemUp(
  items: AdminGalleryItem[],
  index: number
): AdminGalleryItem[] {
  if (index <= 0 || index >= items.length) {
    return [...items];
  }
  const copy = [...items];
  const temp = copy[index - 1];
  copy[index - 1] = copy[index];
  copy[index] = temp;
  return copy;
}

/**
 * Moves gallery item at index down (towards the end).
 * Returns a new array with items swapped, or a shallow copy if index is last or out of bounds.
 */
export function moveGalleryItemDown(
  items: AdminGalleryItem[],
  index: number
): AdminGalleryItem[] {
  if (index < 0 || index >= items.length - 1) {
    return [...items];
  }
  const copy = [...items];
  const temp = copy[index + 1];
  copy[index + 1] = copy[index];
  copy[index] = temp;
  return copy;
}

/**
 * Validates whether another image can be added to the gallery (max 4 images).
 */
export function canAddGalleryItem(
  items: AdminGalleryItem[]
): boolean {
  return items.length >= 1 && items.length < 4;
}

/**
 * Validates whether an image can be removed from the gallery (minimum 1 image required).
 */
export function canRemoveGalleryItem(
  items: AdminGalleryItem[]
): boolean {
  return items.length >= 2;
}

/**
 * Serializes gallery items into the product write contract payload:
 *   - images: ordered URLs reflecting current UI sequence
 *   - image: position 0 URL (Primary compatibility mirror)
 * Fails closed on empty array.
 */
export function serializeGalleryPayload(
  items: AdminGalleryItem[]
): {
  images: string[];
  image: string;
  gallery?: ProductGalleryWriteItem[];
} {
  if (!items || items.length === 0) {
    throw new Error("Cannot serialize empty gallery payload.");
  }
  const hasStructured = items.some((it) => Boolean(it.managedMediaId || it.productImageId));
  const base = {
    images: items.map((item) => item.url),
    image: items[0].url,
  };
  if (!hasStructured) {
    return base;
  }
  return {
    ...base,
    gallery: items.map((it) => {
      if (it.managedMediaId) {
        return {
          kind: "managed" as const,
          managedMediaId: it.managedMediaId,
          ...(it.altText ? { altText: it.altText } : {}),
        };
      }
      if (it.productImageId) {
        return {
          kind: "legacy-existing" as const,
          productImageId: it.productImageId,
          ...(it.altText ? { altText: it.altText } : {}),
        };
      }
      throw new Error("Cannot serialize structured item without managedMediaId or productImageId.");
    }),
  };
}
