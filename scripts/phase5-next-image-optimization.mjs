import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import path from "path";

const root = process.cwd();
const backupDir = path.join(root, "_phase5_backup_next_image_optimization");
mkdirSync(backupDir, { recursive: true });

const files = [
  "components/ui/SafeImage.tsx",
  "components/home/HomeHeroSlider.tsx",
  "components/home/HomePromoGrid.tsx",
  "components/product/ProductDetailsClient.tsx",
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

function addImportAfterUseClient(source, importLine) {
  if (source.includes(importLine)) return source;
  if (source.startsWith('"use client";')) {
    return source.replace('"use client";', `"use client";\n\n${importLine}`);
  }
  return `${importLine}\n${source}`;
}

function replaceIfFound(source, search, replacement) {
  return source.includes(search) ? source.replace(search, replacement) : source;
}

write("components/ui/SafeImage.tsx", `"use client";

import Image, { type ImageProps } from "next/image";
import {
  useEffect,
  useMemo,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";
import { fallbackImageForCategory, normalizeImageSrc } from "@/lib/imagePaths";

type SafeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> & {
  src?: string | null;
  category?: string | null;
  fallbackSrc?: string | null;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  quality?: number;
  fill?: boolean;
};

function canUseNextImage(src: string) {
  const value = src.trim().toLowerCase();

  if (!value.startsWith("/")) return false;
  if (value.endsWith(".svg")) return false;
  if (value.startsWith("/api/")) return false;

  return true;
}

export default function SafeImage({
  src,
  category,
  fallbackSrc,
  alt,
  onError,
  className,
  style,
  width = 900,
  height = 900,
  sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw",
  priority = false,
  quality = 75,
  fill = false,
  loading,
  decoding,
  referrerPolicy,
  ...props
}: SafeImageProps) {
  const fallback = useMemo(
    () =>
      normalizeImageSrc(fallbackSrc || fallbackImageForCategory(category), {
        category,
      }),
    [fallbackSrc, category]
  );

  const resolvedSrc = useMemo(
    () =>
      normalizeImageSrc(src, {
        category,
        fallbackSrc: fallback,
      }),
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

  const safeAlt = alt || "Image";

  if (canUseNextImage(currentSrc)) {
    const imageProps = props as Omit<
      ImageProps,
      "src" | "alt" | "width" | "height" | "fill"
    >;

    if (fill) {
      return (
        <Image
          {...imageProps}
          src={currentSrc}
          alt={safeAlt}
          fill
          sizes={sizes || "100vw"}
          quality={quality}
          priority={priority}
          loading={priority ? undefined : loading}
          className={className}
          style={style}
          onError={handleError}
        />
      );
    }

    return (
      <Image
        {...imageProps}
        src={currentSrc}
        alt={safeAlt}
        width={width}
        height={height}
        sizes={sizes}
        quality={quality}
        priority={priority}
        loading={priority ? undefined : loading || "lazy"}
        className={className}
        style={style}
        onError={handleError}
      />
    );
  }

  return (
    <img
      {...props}
      src={currentSrc}
      alt={safeAlt}
      width={width}
      height={height}
      loading={loading || "lazy"}
      decoding={decoding || "async"}
      referrerPolicy={referrerPolicy || "no-referrer"}
      className={className}
      style={style}
      onError={handleError}
    />
  );
}
`);

/**
 * Optimize hero slider images through SafeImage.
 */
{
  const file = "components/home/HomeHeroSlider.tsx";

  if (existsSync(path.join(root, file))) {
    let source = read(file);

    source = addImportAfterUseClient(
      source,
      `import SafeImage from "@/components/ui/SafeImage";`
    );

    source = replaceIfFound(
      source,
      `{safeSlides.map((slide) => (`,
      `{safeSlides.map((slide, index) => (`
    );

    source = replaceIfFound(
      source,
`              <img
                src={slide.image || "/images/categories/cosmetics.jpg"}
                alt={slide.title || "Pure Haven BD slider"}
                className="absolute inset-0 h-full w-full object-cover"
              />`,
`              <SafeImage
                src={slide.image || "/images/categories/cosmetics.jpg"}
                alt={slide.title || "Pure Haven BD slider"}
                fallbackSrc="/images/categories/cosmetics.jpg"
                className="absolute inset-0 h-full w-full object-cover"
                width={1600}
                height={700}
                sizes="100vw"
                quality={78}
                priority={index === 0}
              />`
    );

    write(file, source);
  }
}

/**
 * Add better sizes to homepage promo SafeImage if already present.
 */
{
  const file = "components/home/HomePromoGrid.tsx";

  if (existsSync(path.join(root, file))) {
    let source = read(file);

    source = replaceIfFound(
      source,
`      <SafeImage
        src={image}
        alt={title}
        fallbackSrc="/images/categories/cosmetics.jpg"
        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
      />`,
`      <SafeImage
        src={image}
        alt={title}
        fallbackSrc="/images/categories/cosmetics.jpg"
        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
        width={1400}
        height={700}
        sizes="(max-width: 768px) 100vw, 50vw"
        quality={76}
      />`
    );

    write(file, source);
  }
}

/**
 * Add better sizes to product details main/variant images if the Phase 4 SafeImage exists.
 */
{
  const file = "components/product/ProductDetailsClient.tsx";

  if (existsSync(path.join(root, file))) {
    let source = read(file);

    source = replaceIfFound(
      source,
`              <SafeImage
                src={activeImage}
                alt={selectedVariant ? \`\${product.name} \${selectedVariant.label}\` : product.name}
                category={product.category}
                className="aspect-square w-full object-cover"
              />`,
`              <SafeImage
                src={activeImage}
                alt={selectedVariant ? \`\${product.name} \${selectedVariant.label}\` : product.name}
                category={product.category}
                className="aspect-square w-full object-cover"
                width={1000}
                height={1000}
                sizes="(max-width: 768px) 100vw, 50vw"
                quality={78}
                priority
              />`
    );

    source = replaceIfFound(
      source,
`                      <SafeImage
                        src={image}
                        alt={variant.label}
                        category={product.category}
                        className="h-full w-full object-cover"
                      />`,
`                      <SafeImage
                        src={image}
                        alt={variant.label}
                        category={product.category}
                        className="h-full w-full object-cover"
                        width={160}
                        height={160}
                        sizes="80px"
                        quality={70}
                      />`
    );

    write(file, source);
  }
}

console.log("Phase 5 next/image optimization patch applied.");
console.log(`Backups saved in: ${backupDir}`);
