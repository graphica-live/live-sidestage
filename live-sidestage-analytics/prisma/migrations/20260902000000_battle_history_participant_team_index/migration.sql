-- 3陣営以上のバトルを丸めずに保存できるようにする。
--
-- 注意: 本番デプロイは `prisma db push --accept-data-loss` を使用しており、このファイルは
-- 実行されない(db pushはmigrationsフォルダを読まない)。列の追加自体はdb pushでも同じ形になるが、
-- **下のバックフィル(side='opponent' -> team_index=1)はdb pushでは実行されない。**
-- そのため読み出し側(src/lib/battle-history.ts の buildFinalizedPendingItem)は
-- 「team_index が全行0のときは side から2陣営を復元する」フォールバックを持っている。
-- バックフィルが走らなくても既存の確定済みバトルの表示は変わらない。
--
-- 追加的な変更のみ(既存列の削除・型変更なし)。side列は後方互換のため残す。

ALTER TABLE "public"."battle_history_participants"
  ADD COLUMN "teamIndex" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "score" TEXT;

-- 既存データ(2陣営しかありえない)を新表現へ寄せる。self=0 / opponent=1。
UPDATE "public"."battle_history_participants" SET "teamIndex" = 1 WHERE "side" = 'opponent';
