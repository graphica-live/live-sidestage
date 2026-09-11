-- 本番では実行されない(prisma db pushがweb起動時に適用する。CLAUDE.md「Railway デプロイ」参照)。
-- このファイルはスキーマ変更の履歴をドキュメントとして残すためのものであり、
-- `prisma migrate deploy` 等での適用は想定していない。

-- CreateTable
CREATE TABLE "public"."overlay_contribution_settings" (
    "streamerId" TEXT NOT NULL,
    "displayReference" TEXT NOT NULL DEFAULT 'today',
    "displayDate" TEXT,
    "threshold" INTEGER NOT NULL DEFAULT 1000,
    "goalCount" INTEGER NOT NULL DEFAULT 5,
    "visibleRows" INTEGER NOT NULL DEFAULT 5,
    "nameMaxWidth" INTEGER NOT NULL DEFAULT 140,
    "align" TEXT NOT NULL DEFAULT 'left',
    "headingBackground" TEXT NOT NULL DEFAULT 'clear',
    "displaySpeed" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overlay_contribution_settings_pkey" PRIMARY KEY ("streamerId")
);

-- AddForeignKey
ALTER TABLE "public"."overlay_contribution_settings" ADD CONSTRAINT "overlay_contribution_settings_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "public"."Streamer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
