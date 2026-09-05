-- 注意: 本番デプロイは `prisma db push --accept-data-loss` を使用しており、このファイルは
-- 実行されない(db pushはmigrationsフォルダを読まない)。履歴のドキュメントとして残す。
--
-- TiktokRoom.consecutiveBlockedCount 追加。
-- 403(TikTokブロック)フェイルオーバー機能: tiktok-listener.ts の recordBlockedAttempt() が
-- 連続403検知回数をincrementし、worker-guardian.ts の decideBlockedRoomAction() が
-- 閾値超過を検知して別workerへ再割当する。persistState()はstatus='connected'到達時に0リセット。

ALTER TABLE "TiktokRoom" ADD COLUMN "consecutiveBlockedCount" INTEGER NOT NULL DEFAULT 0;
