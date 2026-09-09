export type DeliveryReadyManagedMediaInput = Readonly<{
  mediaId: string;
  lifecycleState: "READY" | "CLEANUP_PENDING";
  deliveryDisabledAt: Date | null;
  activeProfileVersion: string;
  width: number;
  height: number;
  objects: readonly Readonly<{
    variantKey: string;
    role: "MASTER" | "RENDITION";
    accessClass: "PRIVATE_SOURCE" | "PUBLIC_DELIVERY";
    mimeType: "image/webp" | "image/avif" | string;
    width: number;
    height: number;
    byteSize: bigint;
    objectKey: string;
    deletedAt: Date | null;
  }>[];
}>;

export type PublicResponsiveSource = Readonly<{
  type: "image/avif" | "image/webp";
  srcSet: string;
}>;

export type PublicResponsiveImageDto = Readonly<{
  mediaId: string;
  width: number;
  height: number;
  fallbackSrc: string;
  sources: readonly PublicResponsiveSource[];
}>;

export interface MediaDeliveryResolver {
  resolvePublicUrl(objectKey: string): string;
}

export function buildPublicResponsiveImageDto(
  input: DeliveryReadyManagedMediaInput,
  resolver: MediaDeliveryResolver
): PublicResponsiveImageDto {
  if (input.deliveryDisabledAt !== null) {
    throw new Error("MEDIA_DELIVERY_DISABLED: media delivery is suspended");
  }

  if (input.lifecycleState !== "READY" && input.lifecycleState !== "CLEANUP_PENDING") {
    throw new Error(
      `INVALID_LIFECYCLE_STATE: media in state ${input.lifecycleState} is not deliverable`
    );
  }

  // Filter for active, non-deleted public renditions only (strictly excludes MASTER and PRIVATE_SOURCE)
  const activeRenditions = input.objects.filter(
    (obj) =>
      obj.role === "RENDITION" &&
      obj.accessClass === "PUBLIC_DELIVERY" &&
      obj.deletedAt === null
  );

  const webpRenditions = activeRenditions
    .filter((obj) => obj.mimeType === "image/webp")
    .sort((a, b) => a.width - b.width);

  if (webpRenditions.length === 0) {
    throw new Error(
      "WEBP_FALLBACK_REQUIRED: at least one active WebP rendition is required for public delivery"
    );
  }

  // Fallback is chosen as the largest active WebP rendition
  const fallbackRendition = webpRenditions[webpRenditions.length - 1];
  const fallbackSrc = resolver.resolvePublicUrl(fallbackRendition.objectKey);

  const sources: PublicResponsiveSource[] = [];

  const avifRenditions = activeRenditions
    .filter((obj) => obj.mimeType === "image/avif")
    .sort((a, b) => a.width - b.width);

  // Authoritative ordering: AVIF first if present, then WebP
  if (avifRenditions.length > 0) {
    const avifSrcSet = avifRenditions
      .map((r) => `${resolver.resolvePublicUrl(r.objectKey)} ${r.width}w`)
      .join(", ");
    sources.push({
      type: "image/avif",
      srcSet: avifSrcSet,
    });
  }

  const webpSrcSet = webpRenditions
    .map((r) => `${resolver.resolvePublicUrl(r.objectKey)} ${r.width}w`)
    .join(", ");
  sources.push({
    type: "image/webp",
    srcSet: webpSrcSet,
  });

  return {
    mediaId: input.mediaId,
    width: input.width,
    height: input.height,
    fallbackSrc,
    sources,
  };
}
