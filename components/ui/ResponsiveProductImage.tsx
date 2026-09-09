import type { PublicResponsiveImageDto } from "@/lib/media/publicMediaDto";
import React from "react";

export type ResponsiveProductImageProps = {
  image: PublicResponsiveImageDto;
  sizes?: string;
  alt?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  className?: string;
  width?: number;
  height?: number;
  onLoad?: () => void;
  onErrorCapture?: () => void;
};

export default function ResponsiveProductImage({
  image,
  sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw",
  alt,
  loading = "lazy",
  fetchPriority,
  className,
  width,
  height,
  onLoad,
  onErrorCapture,
}: ResponsiveProductImageProps) {
  const safeAlt = alt || "Product image";
  const renderedWidth = width ?? image.width;
  const renderedHeight = height ?? image.height;

  return (
    <picture>
      {image.sources.map((source) => (
        <source
          key={source.type}
          type={source.type}
          srcSet={source.srcSet}
          sizes={sizes}
        />
      ))}
      <img
        src={image.fallbackSrc}
        alt={safeAlt}
        width={renderedWidth}
        height={renderedHeight}
        sizes={sizes}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
        referrerPolicy="no-referrer"
        className={className}
        onLoad={onLoad}
        onErrorCapture={onErrorCapture}
      />
    </picture>
  );
}
