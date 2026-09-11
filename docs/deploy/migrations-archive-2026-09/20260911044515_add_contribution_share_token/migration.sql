-- 本番では実行されない(prisma db pushがweb起動時に適用する。CLAUDE.md「Railway デプロイ」参照)。
-- このファイルはスキーマ変更の履歴をドキュメントとして残すためのものであり、
-- `prisma migrate deploy` 等での適用は想定していない。

-- CreateTable
CREATE TABLE "public"."contribution_share_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "date" TEXT,
    "startDatetime" TIMESTAMP(3),
    "endDatetime" TIMESTAMP(3),
    "rangeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_share_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contribution_share_tokens_token_key" ON "public"."contribution_share_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_share_tokens_roomId_rangeKey_key" ON "public"."contribution_share_tokens"("roomId", "rangeKey");

-- AddForeignKey
ALTER TABLE "public"."contribution_share_tokens" ADD CONSTRAINT "contribution_share_tokens_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
