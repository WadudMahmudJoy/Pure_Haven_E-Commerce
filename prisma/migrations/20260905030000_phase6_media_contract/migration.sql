-- Step 1: Set ProductImage.sourceKind NOT NULL
ALTER TABLE "ProductImage" ALTER COLUMN "sourceKind" SET NOT NULL;

-- Step 2: ProductImage source-kind and managedMediaId invariant
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_source_kind_managed_ck"
CHECK (
  ("sourceKind" = 'MANAGED' AND "managedMediaId" IS NOT NULL)
  OR
  ("sourceKind" IN ('LEGACY_LOCAL', 'LEGACY_EXTERNAL') AND "managedMediaId" IS NULL)
);

-- Step 3: ProductImage legacy URL root/scheme sanity
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_legacy_url_ck"
CHECK (
  ("sourceKind" = 'MANAGED')
  OR
  ("sourceKind" = 'LEGACY_LOCAL' AND (TRIM(BOTH FROM "url") LIKE '/uploads/products/%' OR TRIM(BOTH FROM "url") LIKE '/images/%'))
  OR
  ("sourceKind" = 'LEGACY_EXTERNAL' AND TRIM(BOTH FROM "url") LIKE 'https://%')
);

-- Step 4: MediaObject role and accessClass invariant
ALTER TABLE "MediaObject" ADD CONSTRAINT "MediaObject_role_access_ck"
CHECK (
  ("role" = 'MASTER' AND "accessClass" = 'PRIVATE_SOURCE')
  OR
  ("role" = 'RENDITION' AND "accessClass" = 'PUBLIC_DELIVERY')
);

-- Step 5: MediaObject positive dimensions and byte size
ALTER TABLE "MediaObject" ADD CONSTRAINT "MediaObject_dimensions_bytes_positive_ck"
CHECK (
  "width" > 0 AND "height" > 0 AND "byteSize" > 0
);

-- Step 6: ManagedMedia DELETED tombstone requires deletedAt
ALTER TABLE "ManagedMedia" ADD CONSTRAINT "ManagedMedia_deleted_tombstone_ck"
CHECK (
  ("lifecycleState" = 'DELETED' AND "deletedAt" IS NOT NULL)
  OR
  ("lifecycleState" <> 'DELETED')
);

-- Step 7: ManagedMedia CLEANUP_PENDING requires unreferencedAt and cleanupEligibleAt
ALTER TABLE "ManagedMedia" ADD CONSTRAINT "ManagedMedia_cleanup_pending_ck"
CHECK (
  ("lifecycleState" = 'CLEANUP_PENDING' AND "unreferencedAt" IS NOT NULL AND "cleanupEligibleAt" IS NOT NULL)
  OR
  ("lifecycleState" <> 'CLEANUP_PENDING')
);

-- Step 8: ManagedMedia FAILED requires failurePhase and failureCode
ALTER TABLE "ManagedMedia" ADD CONSTRAINT "ManagedMedia_failed_classification_ck"
CHECK (
  ("lifecycleState" = 'FAILED' AND "failurePhase" IS NOT NULL AND "failureCode" IS NOT NULL)
  OR
  ("lifecycleState" <> 'FAILED')
);

-- Step 9: MediaProcessingRun COMPLETE requires completedAt
ALTER TABLE "MediaProcessingRun" ADD CONSTRAINT "MediaProcessingRun_complete_ck"
CHECK (
  ("state" = 'COMPLETE' AND "completedAt" IS NOT NULL)
  OR
  ("state" <> 'COMPLETE')
);

-- Step 10: MediaProcessingRun PROCESSING requires leaseExpiresAt
ALTER TABLE "MediaProcessingRun" ADD CONSTRAINT "MediaProcessingRun_processing_lease_ck"
CHECK (
  ("state" = 'PROCESSING' AND "leaseExpiresAt" IS NOT NULL)
  OR
  ("state" <> 'PROCESSING')
);
