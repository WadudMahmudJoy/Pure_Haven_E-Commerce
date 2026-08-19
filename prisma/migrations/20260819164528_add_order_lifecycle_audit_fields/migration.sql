-- AlterTable
ALTER TABLE "Order" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "Order" ADD COLUMN "cancellationReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "cancellationNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "deliveryFailureReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryFailureNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryFailedAt" TIMESTAMP(3);
