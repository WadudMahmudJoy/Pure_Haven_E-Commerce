-- CreateEnum
CREATE TYPE "PromoKind" AS ENUM ('slider', 'wide', 'small');

-- CreateEnum
CREATE TYPE "CustomerMessageStatus" AS ENUM ('new', 'seen', 'answered', 'closed');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'delivery_failed', 'return_in_transit', 'return_received');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('customer_requested', 'customer_unreachable', 'invalid_contact', 'suspected_fake_order', 'merchant_stockout', 'merchant_error', 'system_timeout', 'other');

-- CreateEnum
CREATE TYPE "DeliveryFailureReason" AS ENUM ('customer_unreachable', 'customer_refused', 'invalid_address', 'courier_failure', 'courier_damage', 'other');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('RESERVED', 'RELEASED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "ReservationReleaseReason" AS ENUM ('CANCELLED', 'EVIDENCE_DEADLINE_EXPIRED', 'REJECTED_PAYMENT', 'ADMIN_OVERRIDE');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('AWAITING_PAYMENT', 'VERIFICATION_PENDING', 'PAID', 'REJECTED', 'FAILED', 'REFUND_REQUIRED', 'REFUND_PROCESSING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CodSettlementState" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'SETTLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "EvidenceAttemptState" AS ENUM ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReturnDisposition" AS ENUM ('PENDING_INSPECTION', 'RESTOCKABLE', 'NON_RESTOCKABLE', 'DAMAGED');

-- AlterTable SiteBranding
ALTER TABLE "SiteBranding" ADD COLUMN "singletonKey" TEXT NOT NULL DEFAULT 'PRIMARY';
CREATE UNIQUE INDEX "SiteBranding_singletonKey_key" ON "SiteBranding"("singletonKey");

-- AlterTable FooterSettings
ALTER TABLE "FooterSettings" ADD COLUMN "singletonKey" TEXT NOT NULL DEFAULT 'PRIMARY';
CREATE UNIQUE INDEX "FooterSettings_singletonKey_key" ON "FooterSettings"("singletonKey");

-- AlterTable HomePromo
ALTER TABLE "HomePromo" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "HomePromo" ALTER COLUMN "kind" TYPE "PromoKind" USING ("kind"::"PromoKind");
ALTER TABLE "HomePromo" ALTER COLUMN "kind" SET DEFAULT 'slider';

-- AlterTable CustomerMessage
ALTER TABLE "CustomerMessage" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "CustomerMessage" ALTER COLUMN "status" TYPE "CustomerMessageStatus" USING (
  CASE 
    WHEN "status" = 'unread' THEN 'new'::"CustomerMessageStatus"
    WHEN "status" = 'read' THEN 'seen'::"CustomerMessageStatus"
    WHEN "status" = 'replied' THEN 'answered'::"CustomerMessageStatus"
    ELSE "status"::"CustomerMessageStatus"
  END
);
ALTER TABLE "CustomerMessage" ALTER COLUMN "status" SET DEFAULT 'new';

-- AlterTable Order
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus" USING ("status"::"OrderStatus");
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "Order" ALTER COLUMN "cancellationReason" TYPE "CancellationReason" USING ("cancellationReason"::"CancellationReason");
ALTER TABLE "Order" ALTER COLUMN "deliveryFailureReason" TYPE "DeliveryFailureReason" USING ("deliveryFailureReason"::"DeliveryFailureReason");

-- AlterTable InventoryReservation
ALTER TABLE "InventoryReservation" ALTER COLUMN "status" TYPE "ReservationStatus" USING ("status"::"ReservationStatus");
ALTER TABLE "InventoryReservation" ALTER COLUMN "releaseReason" TYPE "ReservationReleaseReason" USING ("releaseReason"::"ReservationReleaseReason");

-- AlterTable PaymentRecord
ALTER TABLE "PaymentRecord" ALTER COLUMN "state" TYPE "PaymentState" USING ("state"::"PaymentState");
ALTER TABLE "PaymentRecord" ALTER COLUMN "codSettlementState" TYPE "CodSettlementState" USING ("codSettlementState"::"CodSettlementState");

-- AlterTable PaymentEvidenceAttempt
ALTER TABLE "PaymentEvidenceAttempt" ALTER COLUMN "state" TYPE "EvidenceAttemptState" USING ("state"::"EvidenceAttemptState");

-- AlterTable ReturnItem
ALTER TABLE "ReturnItem" ALTER COLUMN "disposition" TYPE "ReturnDisposition" USING ("disposition"::"ReturnDisposition");

-- Add CheckConstraints
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_nonnegative" CHECK ("stock" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_nonnegative" CHECK ("price" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_compareAtPrice_nonnegative" CHECK ("compareAtPrice" IS NULL OR "compareAtPrice" >= 0);

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_stock_nonnegative" CHECK ("stock" >= 0);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_price_nonnegative" CHECK ("price" >= 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_price_nonnegative" CHECK ("price" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_compareAtPrice_nonnegative" CHECK ("compareAtPrice" IS NULL OR "compareAtPrice" >= 0);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "Order" ADD CONSTRAINT "Order_subtotal_nonnegative" CHECK ("subtotal" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryFee_nonnegative" CHECK ("deliveryFee" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_nonnegative" CHECK ("total" >= 0);

ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_refundAmount_nonnegative" CHECK ("refundAmount" IS NULL OR "refundAmount" >= 0);

ALTER TABLE "User" ADD CONSTRAINT "User_identifier_check" CHECK ("email" IS NOT NULL OR "normalizedPhone" IS NOT NULL);