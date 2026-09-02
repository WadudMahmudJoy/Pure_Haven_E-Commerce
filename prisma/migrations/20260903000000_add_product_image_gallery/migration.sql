-- CreateTable
CREATE TABLE "ProductImage" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_productId_sortOrder_key" ON "ProductImage"("productId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Universal ProductImage backfill: exactly one primary image (sortOrder = 1)
-- for every product that has a non-empty image string (active, inactive, soft-deleted).
INSERT INTO "ProductImage" ("productId", "url", "sortOrder", "createdAt", "updatedAt")
SELECT p."id", TRIM(p."image"), 1, NOW(), NOW()
FROM "Product" p
WHERE p."image" IS NOT NULL
  AND TRIM(p."image") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "ProductImage" pi WHERE pi."productId" = p."id"
  );
