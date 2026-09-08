-- CreateEnum
CREATE TYPE "ProductImageSourceKind" AS ENUM ('MANAGED', 'LEGACY_LOCAL', 'LEGACY_EXTERNAL');

-- CreateEnum
CREATE TYPE "ManagedMediaType" AS ENUM ('IMAGE');

-- CreateEnum
CREATE TYPE "ManagedMediaLifecycleState" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'CLEANUP_PENDING', 'DELETING', 'DELETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaStagingState" AS ENUM ('ALLOCATED', 'PRESENT', 'CLEANUP_PENDING', 'DELETED');

-- CreateEnum
CREATE TYPE "MediaIngestPurpose" AS ENUM ('PRODUCT_IMAGE');

-- CreateEnum
CREATE TYPE "MediaFailurePhase" AS ENUM ('INGEST', 'PROCESSING', 'STORAGE', 'CLEANUP');

-- CreateEnum
CREATE TYPE "MediaProcessingRunState" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaObjectRole" AS ENUM ('MASTER', 'RENDITION');

-- CreateEnum
CREATE TYPE "MediaAccessClass" AS ENUM ('PRIVATE_SOURCE', 'PUBLIC_DELIVERY');

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "altText" TEXT,
ADD COLUMN     "managedMediaId" TEXT,
ADD COLUMN     "sourceKind" "ProductImageSourceKind";

-- CreateTable
CREATE TABLE "ManagedMedia" (
    "id" TEXT NOT NULL,
    "mediaType" "ManagedMediaType" NOT NULL DEFAULT 'IMAGE',
    "lifecycleState" "ManagedMediaLifecycleState" NOT NULL DEFAULT 'PENDING',
    "ingestPurpose" "MediaIngestPurpose" NOT NULL DEFAULT 'PRODUCT_IMAGE',
    "ingestActorScope" TEXT NOT NULL,
    "ingestIdempotencyKey" TEXT NOT NULL,
    "ingestSha256" TEXT NOT NULL,
    "ingestByteSize" BIGINT NOT NULL,
    "ingestMimeType" TEXT NOT NULL,
    "originalFilename" TEXT,
    "sourceWidth" INTEGER,
    "sourceHeight" INTEGER,
    "stagingProviderKey" TEXT NOT NULL,
    "stagingObjectKey" TEXT NOT NULL,
    "stagingState" "MediaStagingState" NOT NULL DEFAULT 'ALLOCATED',
    "activeProcessingRunId" TEXT,
    "canonicalMasterObjectId" TEXT,
    "deliveryDisabledAt" TIMESTAMP(3),
    "unreferencedAt" TIMESTAMP(3),
    "cleanupEligibleAt" TIMESTAMP(3),
    "cleanupAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "cleanupLastAttemptAt" TIMESTAMP(3),
    "failurePhase" "MediaFailurePhase",
    "failureCode" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaProcessingRun" (
    "id" TEXT NOT NULL,
    "managedMediaId" TEXT NOT NULL,
    "profileVersion" TEXT NOT NULL,
    "profileDefinitionHash" TEXT NOT NULL,
    "state" "MediaProcessingRunState" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "failurePhase" "MediaFailurePhase",
    "failureCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaProcessingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaObject" (
    "id" TEXT NOT NULL,
    "processingRunId" TEXT NOT NULL,
    "role" "MediaObjectRole" NOT NULL,
    "accessClass" "MediaAccessClass" NOT NULL,
    "variantKey" TEXT NOT NULL,
    "storageProviderKey" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManagedMedia_lifecycleState_cleanupEligibleAt_idx" ON "ManagedMedia"("lifecycleState", "cleanupEligibleAt");

-- CreateIndex
CREATE INDEX "ManagedMedia_lifecycleState_updatedAt_idx" ON "ManagedMedia"("lifecycleState", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedMedia_ingestActorScope_ingestPurpose_ingestIdempoten_key" ON "ManagedMedia"("ingestActorScope", "ingestPurpose", "ingestIdempotencyKey");

-- CreateIndex
CREATE INDEX "MediaProcessingRun_state_leaseExpiresAt_idx" ON "MediaProcessingRun"("state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "MediaProcessingRun_managedMediaId_state_idx" ON "MediaProcessingRun"("managedMediaId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "MediaProcessingRun_managedMediaId_profileVersion_key" ON "MediaProcessingRun"("managedMediaId", "profileVersion");

-- CreateIndex
CREATE INDEX "MediaObject_processingRunId_idx" ON "MediaObject"("processingRunId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaObject_processingRunId_variantKey_key" ON "MediaObject"("processingRunId", "variantKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaObject_storageProviderKey_objectKey_key" ON "MediaObject"("storageProviderKey", "objectKey");

-- CreateIndex
CREATE INDEX "ProductImage_managedMediaId_idx" ON "ProductImage"("managedMediaId");

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_managedMediaId_fkey" FOREIGN KEY ("managedMediaId") REFERENCES "ManagedMedia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedMedia" ADD CONSTRAINT "ManagedMedia_activeProcessingRunId_fkey" FOREIGN KEY ("activeProcessingRunId") REFERENCES "MediaProcessingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedMedia" ADD CONSTRAINT "ManagedMedia_canonicalMasterObjectId_fkey" FOREIGN KEY ("canonicalMasterObjectId") REFERENCES "MediaObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaProcessingRun" ADD CONSTRAINT "MediaProcessingRun_managedMediaId_fkey" FOREIGN KEY ("managedMediaId") REFERENCES "ManagedMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaObject" ADD CONSTRAINT "MediaObject_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "MediaProcessingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
