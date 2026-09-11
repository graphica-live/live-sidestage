---
project: live-sidestage-analytics
feature: db-check-constraints
last_updated: 2026-09-11
last_risk: MEDIUM
last_reviewers: Codex-terra + DeepSeek(Code Mode、Wave1-B: 5件のCHECK制約追加)
---

# テストベースライン: db-check-constraints

Wave1-Bで追加した5件のPostgreSQL CHECK制約。Prisma 5.22には`@@check`属性が無いため
`prisma/migrations/20260911160000_add_wave1b_check_constraints/migration.sql`に手書きSQLとして存在し、
`schema.prisma`のどのモデル定義からも自動生成されない。本番デプロイは`prisma db push --accept-data-loss`
のままで、このmigrationは通常のデプロイフローでは**適用されない**(`db push`はmigrationsフォルダを読まない)。

**2026-09-11、本番Postgresへ手動適用済み。** `npx prisma db execute --url <DATABASE_PUBLIC_URL> --file migration.sql`
でNOT VALID方式のCHECK制約5件を追加し、違反件数0件を確認後、5件とも`VALIDATE CONSTRAINT`を実行して
`pg_constraint.convalidated = true`を確認済み。以後の本番デプロイ(`db push`)では制約はDROPされない
(`db push`はCHECK制約を認識しないため、schema.prisma側に対応物が無くても削除差分の対象にならない)。

制約はcode-review(Codex, HIGH finding, VALID採用)を受けて`NOT VALID`方式に修正済み: 既存行を即時検証せず、
新規INSERT/UPDATEのみ即時強制する。既存データの違反有無は`VALIDATE CONSTRAINT`実行時に確認する
(migration.sql末尾にコメントアウトしたSELECT/VALIDATE文を記載)。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CHK-001 | battle_history_participants.captureCoverageは0〜1の範囲外を拒否する | 制約`battle_history_participants_captureCoverage_range` | 境界・異常系 | captureCoverage=-0.1および1.1を含む行をINSERT | 制約違反でエラー、範囲内(0/0.5/1)は成功 | `wave1b-check-constraints.integration.test.ts` | PASS | |
| TC-CHK-002 | EventMatchSide.sideIndexは0/1以外を拒否する | 制約`EventMatchSide_sideIndex_binary` | 境界・異常系 | sideIndex=2等をINSERT | 制約違反でエラー、0/1は成功 | 同上 | PASS | |
| TC-CHK-003 | EventLifePoint.currentはmaxを超えられない | 制約`EventLifePoint_current_le_max` | 境界・異常系 | current > maxをINSERT | 制約違反でエラー、current <= maxは成功 | 同上 | PASS | |
| TC-CHK-004 | overlay_timer_stateはrunning=trueのときendsAt必須 | 制約`overlay_timer_state_running_requires_endsAt` | 異常系 | running=true, endsAt=NULLをINSERT | 制約違反でエラー、running=false(endsAt任意)・running=true+endsAt付きは成功 | 同上 | PASS | |
| TC-CHK-005 | EventMatchBattleCandidate.combinedGroupIdが非nullならorganizerSelectedも true | 制約`EventMatchBattleCandidate_group_requires_selected` | 異常系 | combinedGroupId非null, organizerSelected=falseをINSERT | 制約違反でエラー、combinedGroupId=NULL・またはorganizerSelected=trueの組合せは成功 | 同上 | PASS | src/event/CLAUDE.mdの候補調整モード不変条件をDBレベルでも強制 |
| TC-CHK-101 | NOT VALID方式でも新規行への即時強制は変わらない | migration.sql全体 | 回帰 | TC-CHK-001〜005を`NOT VALID`修正後に再実行 | 全件PASS(既存行検証スキップは新規行の強制と無関係) | 同上 | PASS | Codex finding(HIGH: db push経路では反映されない→コメントで既存明記済みALREADY_HANDLED、MEDIUM: NOT VALID段階導入→VALID採用)を反映した後の回帰確認 |
| TC-CHK-102 | 本番Postgresへ5件とも適用され`convalidated=true`になる | 本番DB(`pg_constraint`) | 本番検証 | `prisma db execute`でmigration.sql適用→違反件数SELECT→`VALIDATE CONSTRAINT`5件実行 | 適用時エラーなし、違反件数は5制約とも0件、VALIDATE後`pg_constraint.convalidated`が5件ともtrue | Node.js($queryRawUnsafe経由、スクラッチスクリプト) | PASS | 2026-09-11実施。DEPLOY BLOCKED解除 |

## Quality Gate

- `npm run typecheck`
- `npm run test:integration`(`src/event/wave1b-check-constraints.integration.test.ts`)

## Out of Scope

- `combinedGroupId`関連の候補調整モード自体のロジック・UI — 本baselineはDBレベルのCHECK制約のみを対象とする
- `prisma migrate deploy`運用への恒久移行(`db push`からの切替自体) — 今回は本番DBへ直接手動適用したのみで、デプロイフロー自体の変更は別件
