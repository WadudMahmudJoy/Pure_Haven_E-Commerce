import type { ProductGalleryWriteItem } from "./galleryWrite";

export type AdminManagedUploadStatus =
  | "Uploading"
  | "Processing"
  | "Ready"
  | "Retry"
  | "Invalid";

export type AdminGalleryManagedItem = Readonly<{
  id: string;
  kind: "managed";
  managedMediaId: string;
  previewUrl: string;
  url?: string;
  temporaryObjectUrl?: string;
  status: AdminManagedUploadStatus;
  failureCode?: string;
  idempotencyKey: string;
  file?: File;
  altText?: string;
}>;

export type AdminGalleryLegacyItem = Readonly<{
  id: string;
  kind: "legacy-existing";
  productImageId: number;
  previewUrl: string;
  url?: string;
  sourceKind: "LEGACY_LOCAL" | "LEGACY_EXTERNAL";
  altText?: string;
}>;

export type AdminGalleryLegacyFallbackItem = Readonly<{
  id: string;
  url: string;
  previewUrl?: string;
  kind?: "legacy-fallback";
  managedMediaId?: string | null;
  productImageId?: number | null;
  sourceKind?: "MANAGED" | "LEGACY_LOCAL" | "LEGACY_EXTERNAL";
  altText?: string | null;
}>;

export type AdminGalleryItem =
  | AdminGalleryManagedItem
  | AdminGalleryLegacyItem
  | AdminGalleryLegacyFallbackItem;

const RETRYABLE_UPLOAD_FAILURE_CODES = new Set([
  "MEDIA_STORAGE_UNAVAILABLE",
  "MEDIA_STORAGE_TIMEOUT",
  "MEDIA_RATE_LIMITED",
  "MEDIA_PROCESSING_INTERRUPTED",
]);

export function toAdminManagedUploadStatus(status: {
  mediaId?: string;
  state: string;
  attachable: boolean;
  failureCode?: string | null;
  previewUrl?: string | null;
}): AdminManagedUploadStatus {
  if (
    status.attachable &&
    (status.state === "READY" || status.state === "CLEANUP_PENDING")
  ) {
    return "Ready";
  }
  if (status.state === "PENDING" || status.state === "PROCESSING") {
    return "Processing";
  }
  if (status.state === "FAILED") {
    return RETRYABLE_UPLOAD_FAILURE_CODES.has(status.failureCode ?? "")
      ? "Retry"
      : "Invalid";
  }
  return "Invalid";
}

export function applyManagedUploadStatus(
  item: AdminGalleryManagedItem,
  next: {
    mediaId?: string;
    state: string;
    attachable: boolean;
    previewUrl?: string | null;
    failureCode?: string | null;
  },
  revokeFn?: (url: string) => void
): AdminGalleryManagedItem {
  const status = toAdminManagedUploadStatus(next);
  if (status === "Ready") {
    if (!next.previewUrl) {
      throw new Error(
        "READY_MEDIA_PREVIEW_REQUIRED: Media marked Ready is missing previewUrl"
      );
    }
    const temporaryObjectUrl = item.temporaryObjectUrl;
    if (temporaryObjectUrl) {
      if (revokeFn) {
        revokeFn(temporaryObjectUrl);
      } else if (
        typeof URL !== "undefined" &&
        typeof URL.revokeObjectURL === "function"
      ) {
        URL.revokeObjectURL(temporaryObjectUrl);
      }
    }
    return {
      ...item,
      status: "Ready",
      previewUrl: next.previewUrl,
      url: next.previewUrl,
      temporaryObjectUrl: undefined,
      failureCode: undefined,
    };
  }
  return {
    ...item,
    status,
    failureCode: next.failureCode ?? undefined,
  };
}

export function boundedStatusPollDelays(budgetMs: number = 30000): number[] {
  const delays: number[] = [];
  let elapsed = 0;
  let currentDelay = 500;
  while (elapsed < budgetMs) {
    delays.push(currentDelay);
    elapsed += currentDelay;
    currentDelay = Math.min(Math.round(currentDelay * 1.5), 3000);
  }
  return delays;
}

export function canSaveProduct(items: AdminGalleryItem[]): boolean {
  if (!items || items.length === 0 || items.length > 4) {
    return false;
  }
  return items.every((it) => {
    if ("kind" in it && it.kind === "managed") {
      return it.status === "Ready";
    }
    return true;
  });
}

/**
 * Moves gallery item at index up (towards position 0 / Primary).
 * Returns a new array with items swapped, or a shallow copy if index is 0 or out of bounds.
 */
export function moveGalleryItemUp<T extends AdminGalleryItem>(
  items: T[],
  index: number
): T[] {
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
export function moveGalleryItemDown<T extends AdminGalleryItem>(
  items: T[],
  index: number
): T[] {
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
export function canAddGalleryItem(items: AdminGalleryItem[]): boolean {
  return items.length >= 1 && items.length < 4;
}

/**
 * Validates whether an image can be removed from the gallery (minimum 1 image required).
 */
export function canRemoveGalleryItem(items: AdminGalleryItem[]): boolean {
  return items.length >= 2;
}

/**
 * Serializes gallery items into the product write contract payload:
 *   - images: ordered URLs reflecting current UI sequence
 *   - image: position 0 URL (Primary compatibility mirror)
 *   - gallery: optional structured items when managed or relational legacy items exist
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

  const getItemUrl = (it: AdminGalleryItem) => {
    if ("previewUrl" in it && it.previewUrl) return it.previewUrl;
    if ("url" in it && it.url) return it.url;
    return "";
  };

  const hasStructured = items.some(
    (it) =>
      ("kind" in it && (it.kind === "managed" || it.kind === "legacy-existing")) ||
      ("managedMediaId" in it && Boolean(it.managedMediaId)) ||
      ("productImageId" in it && Boolean(it.productImageId))
  );

  const images = items.map(getItemUrl);
  const base = {
    images,
    image: images[0],
  };

  if (!hasStructured) {
    return base;
  }

  return {
    ...base,
    gallery: items.map((it) => {
      if ("kind" in it && it.kind === "managed") {
        return {
          kind: "managed" as const,
          managedMediaId: it.managedMediaId,
          ...(it.altText ? { altText: it.altText } : {}),
        };
      }
      if ("kind" in it && it.kind === "legacy-existing") {
        return {
          kind: "legacy-existing" as const,
          productImageId: it.productImageId,
          ...(it.altText ? { altText: it.altText } : {}),
        };
      }
      if ("managedMediaId" in it && it.managedMediaId) {
        return {
          kind: "managed" as const,
          managedMediaId: it.managedMediaId,
          ...(it.altText ? { altText: it.altText } : {}),
        };
      }
      if ("productImageId" in it && it.productImageId) {
        return {
          kind: "legacy-existing" as const,
          productImageId: it.productImageId,
          ...(it.altText ? { altText: it.altText } : {}),
        };
      }
      throw new Error(
        "Cannot serialize structured item without managedMediaId or productImageId."
      );
    }),
  };
}
