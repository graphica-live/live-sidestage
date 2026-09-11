---
project: live-sidestage-analytics
feature: db-migration-deploy
last_updated: 2026-09-11
last_risk: HIGH
last_reviewers: Codex-terra + Gemini(agy)
---

# テストベースライン: db-migration-deploy

本番DBスキーマ反映方式は `prisma migrate deploy`（Railway Pre-Deploy Command経由）運用。
`prisma/migrations/0_init/migration.sql` を baseline とし、以後は `prisma migrate dev` で生成した
migration.sql を追加していく（`db push --accept-data-loss` は使わない）。`0_init` は `schema.prisma` から
`migrate diff --from-empty --to-schema-datamodel` で機械生成する再生成可能ファイルであり、mainのWave1
スキーマ整理（`RoomMonitorLease`・`hostDisplayIds`・`scheduledStartAt`/`scheduledEndAt`削除）を統合するたび
再生成が必要（手動編集しない）。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-MD-001 | 再生成した`0_init`が空DBへ適用できる | `prisma/migrations/0_init/migration.sql` | 正常 | 空のPostgreSQL DB | `prisma migrate deploy`が2件（`0_init`・`20260911160000_add_wave1b_check_constraints`）を`applied`で完了、`migrate status`が「0 applied, 0 pending」 | 専用DB作成→`DATABASE_URL=<専用DB> npx prisma migrate deploy && npx prisma migrate status` | PASS | 2026-09-11実施。`liveanalytics_migrate_check`db |
| TC-MD-002 | migrate deploy後のスキーマが`schema.prisma`と完全一致する（drift無し） | `0_init`＋Wave1-B migration適用後のDB | 回帰 | TC-MD-001実施済みDB | `migrate diff --from-schema-datasource --to-schema-datamodel --exit-code`がexit 0（`No difference detected.`） | `DATABASE_URL=<専用DB> npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` | PASS | mainのWave1削除4項目（`room_monitor_leases`テーブル・両`hostDisplayIds`・`scheduledStartAt`/`scheduledEndAt`）が再生成`0_init`に反映されていることの確認を兼ねる |
| TC-MD-003 | migrate deploy済みDBでもWave1-B CHECK制約5件のintegrationテストが通る（DROP CONSTRAINT IF EXISTS前置） | `src/event/wave1b-check-constraints.integration.test.ts` | 回帰 | TC-MD-001実施済みDB（制約が既にmigrate deployで作成済み） | 5制約とも境界値INSERTで期待どおり成功/拒否（`db-check-constraints`のTC-CHK-001〜005相当） | `DATABASE_URL=<専用DB> npx vitest run src/event/wave1b-check-constraints.integration.test.ts` | PASS | tx内で各`ADD CONSTRAINT`前に`DROP CONSTRAINT IF EXISTS`を実行し制約名衝突を回避 |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`
- `npx tsx scripts/check-migration-safety.ts --base=main --head=HEAD`（リポジトリルートから実行。`live-sidestage-analytics/scripts/...`とパス指定）
- `npx next build`

## Out of Scope

- 本番baseline registration（`migrate resolve --applied`実運用・cutover）— ユーザー手動実行、`docs/deploy/prisma-migration-runbook.md`が正本
- Railway Pre-Deploy Command自体のIaC化 — 別件、runbook記載済み
