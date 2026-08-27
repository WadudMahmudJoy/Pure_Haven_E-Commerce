-- CreateEnum
CREATE TYPE "FooterLinkGroup" AS ENUM ('QUICK_LINKS', 'CATEGORY_LINKS', 'POLICY_LINKS');

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "deliveryFee" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "total" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "OrderItem" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "compareAtPrice" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "PaymentRecord" ALTER COLUMN "refundAmount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "categoryId" INTEGER,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "compareAtPrice" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

-- CreateTable
CREATE TABLE "AdminCredential" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "recoveryEmail" TEXT,
    "recoveryPhone" TEXT,
    "recoveryCodeHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteBranding" (
    "id" SERIAL NOT NULL,
    "siteName" TEXT NOT NULL DEFAULT 'PURE',
    "siteSubtitle" TEXT NOT NULL DEFAULT 'HAVEN BD',
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteBranding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FooterSettings" (
    "id" SERIAL NOT NULL,
    "brandTitle" TEXT NOT NULL DEFAULT 'PURE',
    "brandSubtitle" TEXT NOT NULL DEFAULT 'HAVEN BD',
    "description" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "facebookUrl" TEXT NOT NULL DEFAULT '#',
    "instagramUrl" TEXT NOT NULL DEFAULT '#',
    "paymentNote" TEXT NOT NULL DEFAULT '',
    "copyright" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FooterSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FooterLink" (
    "id" SERIAL NOT NULL,
    "footerSettingsId" INTEGER NOT NULL,
    "group" "FooterLinkGroup" NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FooterLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomePromo" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL,
    "href" TEXT NOT NULL DEFAULT '/shop',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomePromo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMessage" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unread',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminCredential_email_key" ON "AdminCredential"("email");

-- CreateIndex
CREATE INDEX "FooterLink_footerSettingsId_group_sortOrder_idx" ON "FooterLink"("footerSettingsId", "group", "sortOrder");

-- CreateIndex
CREATE INDEX "HomePromo_isActive_sortOrder_idx" ON "HomePromo"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "CustomerMessage_status_idx" ON "CustomerMessage"("status");

-- CreateIndex
CREATE INDEX "CustomerMessage_createdAt_idx" ON "CustomerMessage"("createdAt");

-- CreateIndex
CREATE INDEX "CustomerSession_userId_expiresAt_idx" ON "CustomerSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "InventoryReservation_evidenceDeadlineAt_idx" ON "InventoryReservation"("evidenceDeadlineAt");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "Product_isActive_deletedAt_idx" ON "Product"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_isActive_idx" ON "ProductVariant"("productId", "isActive");

-- AddForeignKey
ALTER TABLE "FooterLink" ADD CONSTRAINT "FooterLink_footerSettingsId_fkey" FOREIGN KEY ("footerSettingsId") REFERENCES "FooterSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;