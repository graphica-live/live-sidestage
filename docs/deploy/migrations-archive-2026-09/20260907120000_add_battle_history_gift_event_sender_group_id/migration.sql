-- 本番は `prisma db push` 運用なのでこのファイルは実行されない(履歴ドキュメントとして残す)。
-- コンボの束ね鍵(Gift.groupId のコピー)を再生UIのために複写する。
-- `multiplierValue` は既存列なのでここでは追加しない。
ALTER TABLE "public"."battle_history_gift_events" ADD COLUMN "senderGroupId" TEXT;
