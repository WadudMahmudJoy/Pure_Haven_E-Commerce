-- Sync current Prisma schema with existing database.
-- Safe additive migration for Pure Haven BD.

-- Product fields missing from earlier migrations
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "compareAtPrice" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "isHotDeal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isUpcoming" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "badgeText" TEXT,
  ADD COLUMN IF NOT EXISTS "badgeTone" TEXT NOT NULL DEFAULT 'sale';

-- ProductVariant fields missing from earlier migrations
ALTER TABLE "ProductVariant"
  ADD COLUMN IF NOT EXISTS "image" TEXT,
  ADD COLUMN IF NOT EXISTS "isHotDeal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isUpcoming" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "badgeTone" TEXT;

-- OrderItem compare price field
ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "compareAtPrice" DOUBLE PRECISION;

-- Category table
CREATE TABLE IF NOT EXISTS "Category" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "image" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Category_slug_key" ON "Category"("slug");

-- Subcategory table
CREATE TABLE IF NOT EXISTS "Subcategory" (
  "id" SERIAL NOT NULL,
  "categoryId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Subcategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Subcategory_categoryId_slug_key"
  ON "Subcategory"("categoryId", "slug");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Subcategory_categoryId_fkey'
  ) THEN
    ALTER TABLE "Subcategory"
      ADD CONSTRAINT "Subcategory_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- HomeSlide table
CREATE TABLE IF NOT EXISTS "HomeSlide" (
  "id" SERIAL NOT NULL,
  "eyebrow" TEXT NOT NULL DEFAULT 'PURE HAVEN BD',
  "title" TEXT NOT NULL,
  "subtitle" TEXT NOT NULL,
  "image" TEXT NOT NULL,
  "href" TEXT NOT NULL DEFAULT '/shop',
  "buttonText" TEXT NOT NULL DEFAULT 'Shop Now',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HomeSlide_pkey" PRIMARY KEY ("id")
);
