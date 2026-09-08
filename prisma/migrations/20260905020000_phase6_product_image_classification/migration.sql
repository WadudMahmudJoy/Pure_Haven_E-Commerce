-- Step 1: Precondition check — abort if any unclassified ProductImage row uses an unapproved URL root or scheme
DO $$
DECLARE
  unapproved_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO unapproved_count
  FROM "ProductImage"
  WHERE "sourceKind" IS NULL
    AND NOT (
      "url" LIKE '/uploads/products/%'
      OR "url" LIKE '/images/%'
      OR "url" LIKE 'https://%'
    );

  IF unapproved_count > 0 THEN
    RAISE EXCEPTION 'PHASE6_CLASSIFY_UNAPPROVED_URL_SCHEME_DETECTED: found % rows outside approved roots', unapproved_count;
  END IF;
END $$;

-- Step 2: Classify approved legacy local roots as LEGACY_LOCAL
UPDATE "ProductImage"
SET "sourceKind" = 'LEGACY_LOCAL'
WHERE "sourceKind" IS NULL
  AND ("url" LIKE '/uploads/products/%' OR "url" LIKE '/images/%');

-- Step 3: Classify approved legacy HTTPS URLs as LEGACY_EXTERNAL
UPDATE "ProductImage"
SET "sourceKind" = 'LEGACY_EXTERNAL'
WHERE "sourceKind" IS NULL
  AND "url" LIKE 'https://%';
