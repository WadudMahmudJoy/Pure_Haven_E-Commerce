-- Precondition check: verify 0 ManagedMedia rows and 0 non-null ProductImage.managedMediaId
DO $$
DECLARE
  media_count INTEGER;
  non_null_pi_fk INTEGER;
BEGIN
  SELECT COUNT(*) INTO media_count FROM "ManagedMedia";
  IF media_count > 0 THEN
    RAISE EXCEPTION 'PHASE6_MIGRATION_PRECONDITION_FAILED: ManagedMedia row count must be 0 before UUID conversion (found % rows)', media_count;
  END IF;

  SELECT COUNT(*) INTO non_null_pi_fk FROM "ProductImage" WHERE "managedMediaId" IS NOT NULL;
  IF non_null_pi_fk > 0 THEN
    RAISE EXCEPTION 'PHASE6_MIGRATION_PRECONDITION_FAILED: ProductImage.managedMediaId non-null count must be 0 before UUID conversion (found % rows)', non_null_pi_fk;
  END IF;
END $$;

-- Drop foreign key constraints prior to altering column types
ALTER TABLE "ProductImage" DROP CONSTRAINT IF EXISTS "ProductImage_managedMediaId_fkey";
ALTER TABLE "MediaProcessingRun" DROP CONSTRAINT IF EXISTS "MediaProcessingRun_managedMediaId_fkey";
ALTER TABLE "MediaObject" DROP CONSTRAINT IF EXISTS "MediaObject_processingRunId_fkey";
ALTER TABLE "ManagedMedia" DROP CONSTRAINT IF EXISTS "ManagedMedia_activeProcessingRunId_fkey";
ALTER TABLE "ManagedMedia" DROP CONSTRAINT IF EXISTS "ManagedMedia_canonicalMasterObjectId_fkey";

-- Convert media identity and FK columns to native PostgreSQL uuid
ALTER TABLE "ManagedMedia" ALTER COLUMN "id" SET DATA TYPE uuid USING ("id"::uuid);
ALTER TABLE "ManagedMedia" ALTER COLUMN "activeProcessingRunId" SET DATA TYPE uuid USING ("activeProcessingRunId"::uuid);
ALTER TABLE "ManagedMedia" ALTER COLUMN "canonicalMasterObjectId" SET DATA TYPE uuid USING ("canonicalMasterObjectId"::uuid);

ALTER TABLE "MediaProcessingRun" ALTER COLUMN "id" SET DATA TYPE uuid USING ("id"::uuid);
ALTER TABLE "MediaProcessingRun" ALTER COLUMN "managedMediaId" SET DATA TYPE uuid USING ("managedMediaId"::uuid);

ALTER TABLE "MediaObject" ALTER COLUMN "id" SET DATA TYPE uuid USING ("id"::uuid);
ALTER TABLE "MediaObject" ALTER COLUMN "processingRunId" SET DATA TYPE uuid USING ("processingRunId"::uuid);

ALTER TABLE "ProductImage" ALTER COLUMN "managedMediaId" SET DATA TYPE uuid USING ("managedMediaId"::uuid);

-- Re-add foreign key constraints with fail-safe ON DELETE RESTRICT
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_managedMediaId_fkey"
  FOREIGN KEY ("managedMediaId") REFERENCES "ManagedMedia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MediaProcessingRun" ADD CONSTRAINT "MediaProcessingRun_managedMediaId_fkey"
  FOREIGN KEY ("managedMediaId") REFERENCES "ManagedMedia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MediaObject" ADD CONSTRAINT "MediaObject_processingRunId_fkey"
  FOREIGN KEY ("processingRunId") REFERENCES "MediaProcessingRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManagedMedia" ADD CONSTRAINT "ManagedMedia_activeProcessingRunId_fkey"
  FOREIGN KEY ("activeProcessingRunId") REFERENCES "MediaProcessingRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManagedMedia" ADD CONSTRAINT "ManagedMedia_canonicalMasterObjectId_fkey"
  FOREIGN KEY ("canonicalMasterObjectId") REFERENCES "MediaObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
