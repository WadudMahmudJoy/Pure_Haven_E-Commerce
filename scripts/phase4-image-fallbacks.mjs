import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import path from "path";

const root = process.cwd();
const backupDir = path.join(root, "_phase4_backup_image_fallbacks");
mkdirSync(backupDir, { recursive: true });

const files = [
  "components/ui/ProductCard.tsx",
  "components/product/ProductDetailsClient.tsx",
  "app/shop/page.tsx",
  "components/home/CategorySection.tsx",
  "components/home/HomePromoGrid.tsx",
];

for (const file of files) {
  const full = path.join(root, file);
  if (existsSync(full)) {
    copyFileSync(full, path.join(backupDir, file.replace(/[\\/]/g, "__")));
  }
}

function read(file) {
  return readFileSync(path.join(root, file), "utf8").replace(/^\uFEFF/, "");
}

function write(file, content) {
  writeFileSync(path.join(root, file), content, "utf8");
}

function addImport(source, afterLine, importLine) {
  if (source.includes(importLine)) return source;
  if (!source.includes(afterLine)) {
    throw new Error(`Import marker not found: ${afterLine}`);
  }
  return source.replace(afterLine, `${afterLine}\n${importLine}`);
}

function mustReplace(file, source, search, replacement) {
  if (!source.includes(search)) {
    throw new Error(`Pattern not found in ${file}:\n${search.slice(0, 260)}`);
  }
  return source.replace(search, replacement);
}

mkdirSync(path.join(root, "lib"), { recursive: true });
mkdirSync(path.join(root, "components", "ui"), { recursive: true });

write("lib/imagePaths.ts", `export const DEFAULT_PRODUCT_IMAGE = "/images/categories/cosmetics.jpg";

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

  value = value.replace(/\\\\/g, "/");

  if (/^(https?:)?\\/\\//i.test(value)) return value;
  if (/^(data|blob):/i.test(value)) return value;

  if (value.startsWith("public/")) {
    value = value.slice("public".length);
  }

  if (value.startsWith("./")) {
    value = value.slice(2);
  }

  if (value.startsWith("/")) return value;

  if (value.startsWith("uploads/") || value.startsWith("images/")) {
    return \`/\${value}\`;
  }

  return \`/uploads/products/\${value}\`;
}
`);

write("components/ui/SafeImage.tsx", `"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";
import { fallbackImageForCategory, normalizeImageSrc } from "@/lib/imagePaths";

type SafeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
  category?: string | null;
  fallbackSrc?: string | null;
};

export default function SafeImage({
  src,
  category,
  fallbackSrc,
  alt,
  onError,
  ...props
}: SafeImageProps) {
  const fallback = useMemo(
    () => normalizeImageSrc(fallbackSrc || fallbackImageForCategory(category), { category }),
    [fallbackSrc, category]
  );

  const resolvedSrc = useMemo(
    () => normalizeImageSrc(src, { category, fallbackSrc: fallback }),
    [src, category, fallback]
  );

  const [currentSrc, setCurrentSrc] = useState(resolvedSrc);

  useEffect(() => {
    setCurrentSrc(resolvedSrc);
  }, [resolvedSrc]);

  function handleError(event: SyntheticEvent<HTMLImageElement, Event>) {
    if (currentSrc !== fallback) {
      setCurrentSrc(fallback);
      return;
    }

    event.currentTarget.style.opacity = "0";
    onError?.(event);
  }

  return (
    <img
      {...props}
      src={currentSrc}
      alt={alt || "Image"}
      loading={props.loading || "lazy"}
      decoding={props.decoding || "async"}
      referrerPolicy={props.referrerPolicy || "no-referrer"}
      onError={handleError}
    />
  );
}
`);

/**
 * ProductCard image fallback.
 */
{
  const file = "components/ui/ProductCard.tsx";
  let source = read(file);

  source = addImport(
    source,
    `import { useWishlist } from "@/components/wishlist/WishlistContext";`,
    `import SafeImage from "@/components/ui/SafeImage";`
  );

  source = addImport(
    source,
    `import SafeImage from "@/components/ui/SafeImage";`,
    `import { normalizeImageSrc } from "@/lib/imagePaths";`
  );

  source = mustReplace(
    file,
    source,
`  const imageSrc =
    image && image.trim() !== ""
      ? image
      : "https://via.placeholder.com/600x600?text=No+Image";`,
`  const imageSrc = normalizeImageSrc(image, {
    category,
  });`
  );

  source = mustReplace(
    file,
    source,
`            <img
              src={imageSrc}
              alt={name}
              className="aspect-square w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              onError={(e) => {
                e.currentTarget.src =
                  "https://via.placeholder.com/600x600?text=No+Image";
              }}
            />`,
`            <SafeImage
              src={imageSrc}
              alt={name}
              category={category}
              className="aspect-square w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />`
  );

  write(file, source);
}

/**
 * Product details image fallback.
 */
{
  const file = "components/product/ProductDetailsClient.tsx";
  let source = read(file);

  source = addImport(
    source,
    `import { useCart } from "@/components/cart/CartContext";`,
    `import SafeImage from "@/components/ui/SafeImage";`
  );

  source = addImport(
    source,
    `import SafeImage from "@/components/ui/SafeImage";`,
    `import { normalizeImageSrc } from "@/lib/imagePaths";`
  );

  source = mustReplace(
    file,
    source,
`  const activeImage = selectedVariant?.image?.trim()
    ? selectedVariant.image
    : product.image;`,
`  const activeImage = normalizeImageSrc(
    selectedVariant?.image?.trim() ? selectedVariant.image : product.image,
    { category: product.category }
  );`
  );

  source = mustReplace(
    file,
    source,
`              <img
                src={activeImage}
                alt={selectedVariant ? \`\${product.name} \${selectedVariant.label}\` : product.name}
                className="aspect-square w-full object-cover"
              />`,
`              <SafeImage
                src={activeImage}
                alt={selectedVariant ? \`\${product.name} \${selectedVariant.label}\` : product.name}
                category={product.category}
                className="aspect-square w-full object-cover"
              />`
  );

  source = mustReplace(
    file,
    source,
`                  const image = variant.image?.trim() ? variant.image : product.image;`,
`                  const image = normalizeImageSrc(
                    variant.image?.trim() ? variant.image : product.image,
                    { category: product.category }
                  );`
  );

  source = mustReplace(
    file,
    source,
`                      <img src={image} alt={variant.label} className="h-full w-full object-cover" />`,
`                      <SafeImage
                        src={image}
                        alt={variant.label}
                        category={product.category}
                        className="h-full w-full object-cover"
                      />`
  );

  write(file, source);
}

/**
 * Shop subcategory image fallback.
 */
{
  const file = "app/shop/page.tsx";
  let source = read(file);

  source = addImport(
    source,
    `import ProductCard from "@/components/ui/ProductCard";`,
    `import SafeImage from "@/components/ui/SafeImage";`
  );

  source = source.replace(
`const fallbackImage =
  "https://images.unsplash.com/photo-1596462502278-27bfdc403348?q=80&w=1200&auto=format&fit=crop";`,
`const fallbackImage = "/images/categories/cosmetics.jpg";`
  );

  source = mustReplace(
    file,
    source,
`                  <img
                    src={item.image}
                    alt={item.title}
                    className="h-full w-full object-cover"
                  />`,
`                  <SafeImage
                    src={item.image}
                    alt={item.title}
                    category={category}
                    fallbackSrc={categoryImage}
                    className="h-full w-full object-cover"
                  />`
  );

  write(file, source);
}

/**
 * Category section banner image fallback.
 */
{
  const file = "components/home/CategorySection.tsx";
  let source = read(file);

  source = addImport(
    source,
    `} from "@/lib/defaultCategories";`,
    `import SafeImage from "@/components/ui/SafeImage";`
  );

  source = addImport(
    source,
    `import SafeImage from "@/components/ui/SafeImage";`,
    `import { fallbackImageForCategory, normalizeImageSrc } from "@/lib/imagePaths";`
  );

  source = source.replace(
`const defaultFallback =
  "https://images.unsplash.com/photo-1471193945509-9ad0617afabf?q=80&w=1200&auto=format&fit=crop";`,
`const defaultFallback = "/images/categories/cosmetics.jpg";`
  );

  source = mustReplace(
    file,
    source,
`function categoryImage(category: Category, products: Product[]) {
  if (category.image) return category.image;

  return fallbackImages[category.slug] || defaultFallback;
}`,
`function categoryImage(category: Category, products: Product[]) {
  return normalizeImageSrc(category.image || fallbackImageForCategory(category.slug), {
    category: category.slug,
    fallbackSrc: defaultFallback,
  });
}`
  );

  source = mustReplace(
    file,
    source,
`  return product?.image || category.image || fallbackImages[category.slug] || defaultFallback;`,
`  return normalizeImageSrc(
    product?.image || category.image || fallbackImageForCategory(category.slug),
    {
      category: category.slug,
      fallbackSrc: defaultFallback,
    }
  );`
  );

  source = mustReplace(
    file,
    source,
`              <img
                src={item.image}
                alt={item.title}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />`,
`              <SafeImage
                src={item.image}
                alt={item.title}
                fallbackSrc={defaultFallback}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />`
  );

  write(file, source);
}

/**
 * Homepage promo image fallback.
 */
{
  const file = "components/home/HomePromoGrid.tsx";
  let source = read(file);

  source = addImport(
    source,
    `import { useEffect, useMemo, useState } from "react";`,
    `import SafeImage from "@/components/ui/SafeImage";`
  );

  source = mustReplace(
    file,
    source,
`      <img
        src={image}
        alt={title}
        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
      />`,
`      <SafeImage
        src={image}
        alt={title}
        fallbackSrc="/images/categories/cosmetics.jpg"
        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
      />`
  );

  write(file, source);
}

console.log("Phase 4 image fallback patch applied.");
console.log(`Backups saved in: ${backupDir}`);
