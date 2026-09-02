export type AdminGalleryItem = {
  id: string;
  url: string;
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
} {
  if (!items || items.length === 0) {
    throw new Error("Cannot serialize empty gallery payload.");
  }
  return {
    images: items.map((item) => item.url),
    image: items[0].url,
  };
}
