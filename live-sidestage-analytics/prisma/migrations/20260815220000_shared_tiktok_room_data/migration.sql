-- CreateTable
CREATE TABLE "TiktokRoom" (
    "id" TEXT NOT NULL,
    "tiktokId" TEXT NOT NULL,
    "deviceId" TEXT,
    "workerId" INTEGER,
    "proxyKey" TEXT,
    "listenerStatus" TEXT,
    "listenerMessage" TEXT,
    "listenerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TiktokRoom_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TiktokRoom_tiktokId_key" ON "TiktokRoom"("tiktokId");

-- DropForeignKey (Gift -> Streamer)
ALTER TABLE "gifts" DROP CONSTRAINT IF EXISTS "Gift_streamerId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "gifts_orderId_key";
DROP INDEX IF EXISTS "gifts_streamerId_dayKey_idx";
DROP INDEX IF EXISTS "gifts_streamerId_receivedAt_idx";
DROP INDEX IF EXISTS "gifts_streamerId_uniqueId_idx";
DROP INDEX IF EXISTS "gifts_streamerId_groupId_idx";

-- AlterTable: gifts.streamerId -> gifts.roomId (shared per TikTok account instead of per registrant)
ALTER TABLE "gifts" RENAME COLUMN "streamerId" TO "roomId";

-- AlterTable: Streamer — move connection bookkeeping columns to TiktokRoom, add roomId pointer
ALTER TABLE "Streamer"
  ADD COLUMN "roomId" TEXT,
  DROP COLUMN "deviceId",
  DROP COLUMN "workerId",
  DROP COLUMN "proxyKey",
  DROP COLUMN "listenerStatus",
  DROP COLUMN "listenerMessage",
  DROP COLUMN "listenerUpdatedAt";

-- CreateIndex
CREATE INDEX "Streamer_roomId_idx" ON "Streamer"("roomId");

-- AddForeignKey
ALTER TABLE "Streamer" ADD CONSTRAINT "Streamer_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TiktokRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "gifts_roomId_orderId_key" ON "gifts"("roomId", "orderId");
CREATE INDEX "gifts_roomId_dayKey_idx" ON "gifts"("roomId", "dayKey");
CREATE INDEX "gifts_roomId_receivedAt_idx" ON "gifts"("roomId", "receivedAt");
CREATE INDEX "gifts_roomId_uniqueId_idx" ON "gifts"("roomId", "uniqueId");
CREATE INDEX "gifts_roomId_groupId_idx" ON "gifts"("roomId", "groupId");

-- DropForeignKey (gift_edits -> gifts, will be re-added identically but drop first for clean index swap)
ALTER TABLE "gift_edits" DROP CONSTRAINT IF EXISTS "GiftEdit_giftId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "gift_edits_giftId_key";

-- AlterTable: gift_edits — editing/hiding is now per-streamer (each viewer's own overlay), not global per gift
ALTER TABLE "gift_edits"
  ADD COLUMN "streamerId" TEXT NOT NULL,
  ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "gift_edits_giftId_streamerId_key" ON "gift_edits"("giftId", "streamerId");

-- AddForeignKey
ALTER TABLE "gift_edits" ADD CONSTRAINT "gift_edits_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "gifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_edits" ADD CONSTRAINT "gift_edits_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
