"use client";

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

  // Uploaded product files can be missing after moving the project between machines.
  // Let browser <img> handle them so onError can switch to fallback without Next optimizer spam.
  if (value.startsWith("/uploads/")) return false;

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
