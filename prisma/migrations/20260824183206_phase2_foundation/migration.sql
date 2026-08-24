-- AlterTable Order: Add nullable unique submissionToken
ALTER TABLE "Order" ADD COLUMN "submissionToken" TEXT;

-- CreateTable InventoryReservation
CREATE TABLE "InventoryReservation" (
    "id" SERIAL NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceDeadlineAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable PaymentRecord
CREATE TABLE "PaymentRecord" (
    "id" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "provider" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "rejectionNote" TEXT,
    "refundAmount" DOUBLE PRECISION,
    "refundRequiredAt" TIMESTAMP(3),
    "refundProcessingAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundNote" TEXT,
    "codSettlementState" TEXT,
    "codSettledAt" TIMESTAMP(3),
    "codSettlementNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable PaymentEvidenceAttempt
CREATE TABLE "PaymentEvidenceAttempt" (
    "id" SERIAL NOT NULL,
    "paymentRecordId" INTEGER NOT NULL,
    "normalizedProvider" TEXT NOT NULL,
    "senderNumber" TEXT NOT NULL,
    "trxId" TEXT NOT NULL,
    "normalizedTrxId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "rejectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentEvidenceAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable ReturnItem
CREATE TABLE "ReturnItem" (
    "id" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "productId" INTEGER,
    "variantId" INTEGER,
    "quantity" INTEGER NOT NULL,
    "disposition" TEXT NOT NULL,
    "physicalReturnAt" TIMESTAMP(3),
    "restockedAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservation_orderItemId_key" ON "InventoryReservation"("orderItemId");

-- CreateIndex
CREATE INDEX "InventoryReservation_orderId_idx" ON "InventoryReservation"("orderId");

-- CreateIndex
CREATE INDEX "InventoryReservation_productId_idx" ON "InventoryReservation"("productId");

-- CreateIndex
CREATE INDEX "InventoryReservation_variantId_idx" ON "InventoryReservation"("variantId");

-- CreateIndex
CREATE INDEX "InventoryReservation_status_idx" ON "InventoryReservation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_orderId_key" ON "PaymentRecord"("orderId");

-- CreateIndex
CREATE INDEX "PaymentRecord_state_idx" ON "PaymentRecord"("state");

-- CreateIndex
CREATE INDEX "PaymentRecord_codSettlementState_idx" ON "PaymentRecord"("codSettlementState");

-- CreateIndex
CREATE INDEX "PaymentEvidenceAttempt_paymentRecordId_idx" ON "PaymentEvidenceAttempt"("paymentRecordId");

-- CreateIndex
CREATE INDEX "PaymentEvidenceAttempt_normalizedProvider_normalizedTrxId_idx" ON "PaymentEvidenceAttempt"("normalizedProvider", "normalizedTrxId");

-- Partial Unique Index for Payment Evidence Anti-Replay
CREATE UNIQUE INDEX "idx_payment_evidence_active_claim"
  ON "PaymentEvidenceAttempt" ("normalizedProvider", "normalizedTrxId")
  WHERE "state" IN ('PENDING_REVIEW', 'ACCEPTED');

-- CreateIndex
CREATE INDEX "ReturnItem_orderId_idx" ON "ReturnItem"("orderId");

-- CreateIndex
CREATE INDEX "ReturnItem_orderItemId_idx" ON "ReturnItem"("orderItemId");

-- CreateIndex
CREATE INDEX "ReturnItem_disposition_idx" ON "ReturnItem"("disposition");

-- CreateIndex
CREATE UNIQUE INDEX "Order_submissionToken_key" ON "Order"("submissionToken");

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvidenceAttempt" ADD CONSTRAINT "PaymentEvidenceAttempt_paymentRecordId_fkey" FOREIGN KEY ("paymentRecordId") REFERENCES "PaymentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
