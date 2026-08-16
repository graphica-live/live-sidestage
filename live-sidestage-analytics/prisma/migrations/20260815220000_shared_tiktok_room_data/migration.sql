-- 注意: 本番デプロイは `prisma db push --accept-data-loss` を使用しており、このファイルは
-- 実行されない(db pushはmigrationsフォルダを読まない)。本番への実際の反映は
-- Dockerfile CMDから `scripts/migrate-shared-tiktok-room.ts` が担う。
-- このファイルはローカルで `prisma migrate deploy` を使う場合のためにのみ、
-- 同じ安全な段階的手順(nullable追加→バックフィル→NOT NULL化)で整合させてある。
--
-- 旧版(この安全な書き直し以前)は gift_edits.streamerId を NOT NULL のまま追加しており、
-- 既存行が1件でもあれば実行不可能、かつ gifts.streamerId を roomId へ単純RENAMEしていたため
-- 値がStreamer.idのままTiktokRoom.idを指すFK制約に違反する、という二重に危険な内容だった。

-- Phase 1: 新しい入れ物(TiktokRoom)とnullable列を用意する
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

CREATE UNIQUE INDEX "TiktokRoom_tiktokId_key" ON "TiktokRoom"("tiktokId");

ALTER TABLE "Streamer" ADD COLUMN "roomId" TEXT;
ALTER TABLE "gifts" ADD COLUMN "roomId" TEXT;
ALTER TABLE "gift_edits" ADD COLUMN "streamerId" TEXT;
ALTER TABLE "gift_edits" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;

-- Phase 2: 既存データからTiktokRoomを起こし、各行のroomId/streamerIdを埋める
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "TiktokRoom" ("id", "tiktokId")
SELECT gen_random_uuid()::text, normalized."tiktokId"
FROM (
  SELECT DISTINCT lower(regexp_replace("tiktokId", '^@', '')) AS "tiktokId"
  FROM "Streamer"
) normalized
ON CONFLICT ("tiktokId") DO NOTHING;

UPDATE "Streamer" s
SET "roomId" = r."id"
FROM "TiktokRoom" r
WHERE r."tiktokId" = lower(regexp_replace(s."tiktokId", '^@', ''));

UPDATE "gifts" g
SET "roomId" = s."roomId"
FROM "Streamer" s
WHERE g."streamerId" = s."id" AND g."roomId" IS NULL;

UPDATE "gift_edits" ge
SET "streamerId" = g."streamerId"
FROM "gifts" g
WHERE ge."giftId" = g."id" AND ge."streamerId" IS NULL;

-- Phase 3: NOT NULL化・旧列/旧制約の削除・新制約の追加
ALTER TABLE "gifts" ALTER COLUMN "roomId" SET NOT NULL;
ALTER TABLE "gift_edits" ALTER COLUMN "streamerId" SET NOT NULL;

ALTER TABLE "gifts" DROP CONSTRAINT IF EXISTS "gifts_streamerId_fkey";
DROP INDEX IF EXISTS "gifts_streamerId_dayKey_idx";
DROP INDEX IF EXISTS "gifts_streamerId_receivedAt_idx";
DROP INDEX IF EXISTS "gifts_streamerId_uniqueId_idx";
DROP INDEX IF EXISTS "gifts_streamerId_groupId_idx";
ALTER TABLE "gifts" DROP COLUMN "streamerId";

DROP INDEX IF EXISTS "gifts_orderId_key";
CREATE UNIQUE INDEX "gifts_roomId_orderId_key" ON "gifts"("roomId", "orderId");
CREATE INDEX "gifts_roomId_dayKey_idx" ON "gifts"("roomId", "dayKey");
CREATE INDEX "gifts_roomId_receivedAt_idx" ON "gifts"("roomId", "receivedAt");
CREATE INDEX "gifts_roomId_uniqueId_idx" ON "gifts"("roomId", "uniqueId");
CREATE INDEX "gifts_roomId_groupId_idx" ON "gifts"("roomId", "groupId");
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "gift_edits_giftId_key";
CREATE UNIQUE INDEX "gift_edits_giftId_streamerId_key" ON "gift_edits"("giftId", "streamerId");
ALTER TABLE "gift_edits" ADD CONSTRAINT "gift_edits_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Streamer_roomId_idx" ON "Streamer"("roomId");
ALTER TABLE "Streamer" ADD CONSTRAINT "Streamer_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TiktokRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Streamer" DROP COLUMN "deviceId";
ALTER TABLE "Streamer" DROP COLUMN "workerId";
ALTER TABLE "Streamer" DROP COLUMN "proxyKey";
ALTER TABLE "Streamer" DROP COLUMN "listenerStatus";
ALTER TABLE "Streamer" DROP COLUMN "listenerMessage";
ALTER TABLE "Streamer" DROP COLUMN "listenerUpdatedAt";
