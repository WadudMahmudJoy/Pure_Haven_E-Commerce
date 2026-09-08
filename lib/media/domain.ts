export type ManagedMediaLifecycleState =
  | "PENDING"
  | "PROCESSING"
  | "READY"
  | "CLEANUP_PENDING"
  | "DELETING"
  | "DELETED"
  | "FAILED";

export type ProductImageSourceKind = "MANAGED" | "LEGACY_LOCAL" | "LEGACY_EXTERNAL";
export type MediaObjectRole = "MASTER" | "RENDITION";
export type MediaAccessClass = "PRIVATE_SOURCE" | "PUBLIC_DELIVERY";
export type MediaStagingState = "ALLOCATED" | "PRESENT" | "CLEANUP_PENDING" | "DELETED";
export type MediaIngestPurpose = "PRODUCT_IMAGE";
export type MediaProcessingRunState = "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
export type MediaFailurePhase = "INGEST" | "PROCESSING" | "STORAGE" | "CLEANUP";

export function canAttachManagedMedia(
  state: ManagedMediaLifecycleState,
  deliveryDisabledAt: Date | null
): boolean {
  return deliveryDisabledAt === null && (state === "READY" || state === "CLEANUP_PENDING");
}

export function assertMediaObjectRoleAccessClass(
  role: MediaObjectRole,
  accessClass: MediaAccessClass
): void {
  const valid =
    (role === "MASTER" && accessClass === "PRIVATE_SOURCE") ||
    (role === "RENDITION" && accessClass === "PUBLIC_DELIVERY");
  if (!valid) throw new Error("MEDIA_OBJECT_ROLE_ACCESS_CLASS_INVALID");
}

export function isManagedProductImage(
  sourceKind: ProductImageSourceKind | null | undefined,
  managedMediaId: string | null | undefined
): boolean {
  return sourceKind === "MANAGED" && typeof managedMediaId === "string" && managedMediaId.length > 0;
}

export function isLegacyProductImage(
  sourceKind: ProductImageSourceKind | null | undefined
): boolean {
  return sourceKind === "LEGACY_LOCAL" || sourceKind === "LEGACY_EXTERNAL";
}
