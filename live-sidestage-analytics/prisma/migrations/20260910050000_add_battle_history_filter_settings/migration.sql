-- 本番では実行されない(prisma db pushがweb起動時に適用する。CLAUDE.md「Railway デプロイ」参照)。
-- このファイルはスキーマ変更の履歴をドキュメントとして残すためのものであり、
-- `prisma migrate deploy` 等での適用は想定していない。

-- CreateTable
CREATE TABLE "public"."battle_history_filter_settings" (
    "streamerId" TEXT NOT NULL,
    "hideLowDiamondEnabled" BOOLEAN NOT NULL DEFAULT false,
    "threshold" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battle_history_filter_settings_pkey" PRIMARY KEY ("streamerId")
);

-- AddForeignKey
ALTER TABLE "public"."battle_history_filter_settings" ADD CONSTRAINT "battle_history_filter_settings_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "public"."Streamer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
