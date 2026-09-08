/**
 * Pure persistence normalization for product gallery and image references.
 * Enforces allowed image URI schemes and directory roots for stored assets.
 * Does NOT perform display-level fallback substitution.
 */

export function normalizeProductImageReference(value: unknown):
  | { ok: true; url: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Image reference must be a string." };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: "Image reference cannot be empty." };
  }

  // Reject dangerous / non-persisted client schemes
  if (/^(javascript|data|blob|file|ftp):/i.test(trimmed)) {
    return { ok: false, error: `Invalid image URI scheme in reference: '${trimmed.slice(0, 20)}...'` };
  }

  // Prevent directory traversal
  if (trimmed.includes("..")) {
    return { ok: false, error: `Directory traversal is not allowed: '${trimmed}'` };
  }

  // Handle external HTTPS URLs
  if (/^https:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:") {
        return { ok: false, error: "External image URLs must use the https protocol." };
      }
      if (parsed.username || parsed.password) {
        return { ok: false, error: "External image URLs must not contain authentication credentials." };
      }
      if (!parsed.hostname || parsed.hostname.includes(" ")) {
        return { ok: false, error: "External image URL contains an invalid hostname." };
      }
      return { ok: true, url: trimmed };
    } catch {
      return { ok: false, error: `Malformed HTTPS URL: '${trimmed}'` };
    }
  }

  // Reject unencrypted HTTP external URLs
  if (/^http:\/\//i.test(trimmed)) {
    return { ok: false, error: "Insecure http image URLs are not permitted. Use https." };
  }

  // Handle approved local asset root paths ONLY:
  // Must start strictly with /uploads/products/ or /images/
  if (trimmed.startsWith("/uploads/products/") || trimmed.startsWith("/images/")) {
    return { ok: true, url: trimmed };
  }

  return {
    ok: false,
    error: `Invalid product image reference: '${trimmed}'. Approved paths must reside under /uploads/products/, /images/, or be valid HTTPS URLs.`,
  };
}

import type { ProductImageSourceKind } from "../media/domain";

export function classifyLegacyProductImageUrl(url: string): "LEGACY_LOCAL" | "LEGACY_EXTERNAL" {
  const norm = normalizeProductImageReference(url);
  if (!norm.ok) {
    throw new Error("PRODUCT_IMAGE_REFERENCE_UNSUPPORTED");
  }
  if (norm.url.startsWith("/uploads/products/") || norm.url.startsWith("/images/")) {
    return "LEGACY_LOCAL";
  }
  if (norm.url.startsWith("https://")) {
    return "LEGACY_EXTERNAL";
  }
  throw new Error("PRODUCT_IMAGE_REFERENCE_UNSUPPORTED");
}

export function resolveBridgeSourceKind(row: {
  sourceKind: ProductImageSourceKind | null;
  url: string;
}): ProductImageSourceKind {
  return row.sourceKind ?? classifyLegacyProductImageUrl(row.url);
}
