-- AlterTable
ALTER TABLE "Streamer" ADD COLUMN "listenerMessage" TEXT,
                       ADD COLUMN "listenerStatus" TEXT,
                       ADD COLUMN "listenerUpdatedAt" TIMESTAMP(3);
