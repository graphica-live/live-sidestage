-- AlterTable
ALTER TABLE "public"."tiktok_battles" ADD COLUMN     "tapPointsTracked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."tiktok_battle_tap_points" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "anchorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "uniqueId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,

    CONSTRAINT "tiktok_battle_tap_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tiktok_battle_tap_points_battleId_roomId_occurredAt_idx" ON "public"."tiktok_battle_tap_points"("battleId", "roomId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "tiktok_battle_tap_points_roomId_battleId_uniqueId_key" ON "public"."tiktok_battle_tap_points"("roomId", "battleId", "uniqueId");

-- AddForeignKey
ALTER TABLE "public"."tiktok_battle_tap_points" ADD CONSTRAINT "tiktok_battle_tap_points_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
