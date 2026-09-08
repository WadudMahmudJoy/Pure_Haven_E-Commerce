-- AlterTable
ALTER TABLE "ManagedMedia" ALTER COLUMN "originalFilename" SET DATA TYPE VARCHAR(255);
ALTER TABLE "ManagedMedia" ALTER COLUMN "failureCode" SET DATA TYPE VARCHAR(100);

-- AlterTable
ALTER TABLE "MediaProcessingRun" ALTER COLUMN "failureCode" SET DATA TYPE VARCHAR(100);
