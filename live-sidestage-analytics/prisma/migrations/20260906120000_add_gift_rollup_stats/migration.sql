-- CreateTable
CREATE TABLE "public"."gift_daily_listener_stats" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "uniqueId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "profileImageUrl" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "giftCount" INTEGER NOT NULL DEFAULT 0,
    "totalDiamonds" INTEGER NOT NULL DEFAULT 0,
    "firstReceivedAt" TIMESTAMP(3) NOT NULL,
    "lastReceivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_daily_listener_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."gift_lifetime_stats" (
    "uniqueId" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "giftCount" INTEGER NOT NULL DEFAULT 0,
    "totalDiamonds" BIGINT NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_lifetime_stats_pkey" PRIMARY KEY ("uniqueId")
);

-- CreateIndex
CREATE INDEX "gift_daily_listener_stats_roomId_dayKey_idx" ON "public"."gift_daily_listener_stats"("roomId", "dayKey");

-- CreateIndex
CREATE INDEX "gift_daily_listener_stats_dayKey_idx" ON "public"."gift_daily_listener_stats"("dayKey");

-- CreateIndex
CREATE UNIQUE INDEX "gift_daily_listener_stats_roomId_dayKey_uniqueId_key" ON "public"."gift_daily_listener_stats"("roomId", "dayKey", "uniqueId");

-- CreateIndex
CREATE INDEX "gifts_dayKey_idx" ON "public"."gifts"("dayKey");

