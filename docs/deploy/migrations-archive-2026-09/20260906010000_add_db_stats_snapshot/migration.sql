-- 毎朝JST6:00にevent-workerが記録する全テーブルの件数・サイズのスナップショット
-- (src/lib/db-stats/collect.ts)。前日比+25%超の増分をメールへ通知する異常検知の原本データ。
--
-- 注意: 本番デプロイは `prisma db push --accept-data-loss` を使用しており、このファイルは
-- 実行されない(db pushはmigrationsフォルダを読まない)。履歴ドキュメントとして残すのみ。

CREATE TABLE "public"."DbStatsSnapshot" (
    "id" TEXT NOT NULL,
    "runDate" DATE NOT NULL,
    "schemaName" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "rowCount" BIGINT NOT NULL,
    "totalBytes" BIGINT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DbStatsSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DbStatsSnapshot_schemaName_tableName_runDate_idx" ON "public"."DbStatsSnapshot"("schemaName", "tableName", "runDate");

CREATE UNIQUE INDEX "DbStatsSnapshot_runDate_schemaName_tableName_key" ON "public"."DbStatsSnapshot"("runDate", "schemaName", "tableName");
