-- Wave1-B: 5件のCHECK制約追加。
-- 注意: Prisma schema.prisma には CHECK 制約を表現する属性が無い(2026-09時点、Prisma 5.22)ため、
-- このファイルは schema.prisma のどのモデル定義からも自動生成されない手書きSQLで、
-- `prisma db push` では絶対に反映されない(db push は schema.prisma だけを見る)。
-- 本番デプロイは web起動時の `prisma db push --accept-data-loss` のままなので、
-- このマイグレーションを適用するには `prisma migrate deploy` への移行、または
-- 本番DBへの手動適用(psql等)が別途必要。
--
-- NOT VALID方式: ADD CONSTRAINT ... CHECK(...) NOT VALID は既存行を即時検証しない
-- (新規INSERT/UPDATEのみ即時強制)。VALIDATE CONSTRAINTを別途実行するまで、違反データが
-- 1件でも残っているとDDL全体が失敗する事故を避けられる。適用者は制約追加後、
-- 違反件数を確認してからVALIDATE CONSTRAINTを実行すること(本ファイル末尾のSELECT参照)。

-- AddCheckConstraint: battle_history_participants.captureCoverage は 0.0〜1.0 の割合
ALTER TABLE "public"."battle_history_participants"
  ADD CONSTRAINT "battle_history_participants_captureCoverage_range"
  CHECK ("captureCoverage" IS NULL OR ("captureCoverage" >= 0 AND "captureCoverage" <= 1)) NOT VALID;

-- AddCheckConstraint: EventMatchSide.sideIndex は 0 か 1 の2値(@@unique([matchId, sideIndex])と対)
ALTER TABLE "event"."EventMatchSide"
  ADD CONSTRAINT "EventMatchSide_sideIndex_binary"
  CHECK ("sideIndex" IN (0, 1)) NOT VALID;

-- AddCheckConstraint: EventLifePoint.current は max を超えない
ALTER TABLE "event"."EventLifePoint"
  ADD CONSTRAINT "EventLifePoint_current_le_max"
  CHECK ("current" <= "max") NOT VALID;

-- AddCheckConstraint: overlay_timer_state は running=true のとき必ず endsAt を持つ
ALTER TABLE "public"."overlay_timer_state"
  ADD CONSTRAINT "overlay_timer_state_running_requires_endsAt"
  CHECK ("running" = false OR "endsAt" IS NOT NULL) NOT VALID;

-- AddCheckConstraint: combinedGroupId が非null なら organizerSelected も true
-- (src/event/CLAUDE.md の候補調整モード不変条件をDBレベルでも強制する)
ALTER TABLE "event"."EventMatchBattleCandidate"
  ADD CONSTRAINT "EventMatchBattleCandidate_group_requires_selected"
  CHECK ("combinedGroupId" IS NULL OR "organizerSelected" = true) NOT VALID;

-- 適用者向け: 上記5件を実DBへ適用した後、以下で違反件数を確認してからVALIDATE CONSTRAINTへ進む。
-- 違反0件を確認済みなら各VALIDATE CONSTRAINTはロックを取るが既存行の再スキャンのみで高速。
--
-- SELECT count(*) FROM "public"."battle_history_participants"
--   WHERE NOT ("captureCoverage" IS NULL OR ("captureCoverage" >= 0 AND "captureCoverage" <= 1));
-- SELECT count(*) FROM "event"."EventMatchSide" WHERE NOT ("sideIndex" IN (0, 1));
-- SELECT count(*) FROM "event"."EventLifePoint" WHERE NOT ("current" <= "max");
-- SELECT count(*) FROM "public"."overlay_timer_state" WHERE NOT ("running" = false OR "endsAt" IS NOT NULL);
-- SELECT count(*) FROM "event"."EventMatchBattleCandidate"
--   WHERE NOT ("combinedGroupId" IS NULL OR "organizerSelected" = true);
--
-- ALTER TABLE "public"."battle_history_participants" VALIDATE CONSTRAINT "battle_history_participants_captureCoverage_range";
-- ALTER TABLE "event"."EventMatchSide" VALIDATE CONSTRAINT "EventMatchSide_sideIndex_binary";
-- ALTER TABLE "event"."EventLifePoint" VALIDATE CONSTRAINT "EventLifePoint_current_le_max";
-- ALTER TABLE "public"."overlay_timer_state" VALIDATE CONSTRAINT "overlay_timer_state_running_requires_endsAt";
-- ALTER TABLE "event"."EventMatchBattleCandidate" VALIDATE CONSTRAINT "EventMatchBattleCandidate_group_requires_selected";
