-- TiktokBattle.raw(受信payloadの生JSON恒久保存)を撤去。
-- デバッグ用途(fixture取得・後追い調査)専用で、確定処理後は BattleHistory 系の
-- 非正規化スナップショットが本体になるため不要。読み出し経路だった
-- /api/debug/battle-payloads も削除済み。過去データのraw依存backfillスクリプト
-- (backfill-battle-host-user-ids/teams/profiles)も実行済み前提で削除済み(ユーザー承認済み)。
--
-- 注意: 本番デプロイは `prisma db push --accept-data-loss` を使用しており、このファイルは
-- 実行されない(db pushはmigrationsフォルダを読まない)。web起動時のdb pushで
-- raw列はデータごと落ちる(恒久保存データの削除。ユーザー承認済み)。

ALTER TABLE "public"."tiktok_battles" DROP COLUMN "raw";
