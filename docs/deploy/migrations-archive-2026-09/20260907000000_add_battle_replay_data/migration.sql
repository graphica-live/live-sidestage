-- AlterTable
ALTER TABLE "public"."battle_histories" ADD COLUMN     "openingMultiplierConfidence" TEXT,
ADD COLUMN     "openingWindowEndedAt" TIMESTAMP(3),
ADD COLUMN     "openingWindowStartedAt" TIMESTAMP(3),
ADD COLUMN     "replayGiftEventCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "replayScorePointCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shareToken" TEXT,
ADD COLUMN     "shareTokenIssuedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."battle_history_score_points" (
    "id" TEXT NOT NULL,
    "battleHistoryId" TEXT NOT NULL,
    "anchorId" TEXT NOT NULL,
    "offsetMs" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "score" TEXT NOT NULL,

    CONSTRAINT "battle_history_score_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "battle_history_score_points_battleHistoryId_offsetMs_idx" ON "public"."battle_history_score_points"("battleHistoryId", "offsetMs");

-- CreateIndex
CREATE UNIQUE INDEX "battle_histories_shareToken_key" ON "public"."battle_histories"("shareToken");

-- AddForeignKey
ALTER TABLE "public"."battle_history_score_points" ADD CONSTRAINT "battle_history_score_points_battleHistoryId_fkey" FOREIGN KEY ("battleHistoryId") REFERENCES "public"."battle_histories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
