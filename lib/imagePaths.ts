export const DEFAULT_PRODUCT_IMAGE = "/images/categories/cosmetics.jpg";

const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  cosmetics: "/images/categories/cosmetics.jpg",
  skincare: "/images/categories/skincare.jpg",
  haircare: "/images/categories/haircare.jpg",
  perfume: "/images/categories/perfume.jpg",
  food: "/images/categories/essentials.jpg",
  "mens-products": "/images/categories/bodycare.jpg",
  "baby-products": "/images/categories/essentials.jpg",
};

export function imageSlug(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function fallbackImageForCategory(category?: string | null) {
  const key = imageSlug(category);
  return CATEGORY_FALLBACK_IMAGES[key] || DEFAULT_PRODUCT_IMAGE;
}

export function normalizeImageSrc(
  src?: string | null,
  options?: {
    category?: string | null;
    fallbackSrc?: string | null;
  }
) {
  const fallback = options?.fallbackSrc
    ? normalizeImagePath(options.fallbackSrc)
    : fallbackImageForCategory(options?.category);

  const value = normalizeImagePath(src);

  if (!value) return fallback;
  return value;
}

function normalizeImagePath(src?: string | null) {
  let value = typeof src === "string" ? src.trim() : "";

  if (!value) return "";

  value = value.replace(/\\/g, "/");

  if (/^(https?:)?\/\//i.test(value)) return value;
  if (/^(data|blob):/i.test(value)) return value;

  if (value.startsWith("public/")) {
    value = value.slice("public".length);
  }

  if (value.startsWith("./")) {
    value = value.slice(2);
  }

  if (value.startsWith("/")) return value;

  if (value.startsWith("uploads/") || value.startsWith("images/")) {
    return `/${value}`;
  }

  return `/uploads/products/${value}`;
}
