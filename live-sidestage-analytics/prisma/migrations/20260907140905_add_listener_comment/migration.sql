-- 本番では実行されない(prisma db pushがweb起動時に適用する。CLAUDE.md「Railway デプロイ」参照)。
-- このファイルはスキーマ変更の履歴をドキュメントとして残すためのものであり、
-- `prisma migrate deploy` 等での適用は想定していない。

-- CreateTable
CREATE TABLE "public"."listener_comments" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "uniqueId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timeSource" TEXT NOT NULL DEFAULT 'tiktok',
    "dayKey" TEXT NOT NULL,
    "msgId" TEXT,

    CONSTRAINT "listener_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listener_comments_roomId_dayKey_idx" ON "public"."listener_comments"("roomId", "dayKey");

-- CreateIndex
CREATE INDEX "listener_comments_roomId_receivedAt_idx" ON "public"."listener_comments"("roomId", "receivedAt");

-- CreateIndex
CREATE INDEX "listener_comments_dayKey_idx" ON "public"."listener_comments"("dayKey");

-- AddForeignKey
ALTER TABLE "public"."listener_comments" ADD CONSTRAINT "listener_comments_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
