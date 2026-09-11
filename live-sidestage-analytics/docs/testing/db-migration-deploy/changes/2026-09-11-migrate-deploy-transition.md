---
date: 2026-09-11
feature: db-migration-deploy
---

## change summary

本番DBスキーマ反映方式を `prisma db push --accept-data-loss`（Dockerfile CMD内実行）から
`prisma migrate deploy`（Railway Pre-Deploy Command経由）運用へ移行。Batch01〜04で実装。

- Batch01: baseline migration `0_init` 生成（`migrate diff --from-empty --to-schema-datamodel`）、既存33件migrationを `docs/deploy/migrations-archive-2026-09/` へアーカイブ
- Batch02: Dockerfile CMD簡素化（`db push --accept-data-loss` 除去）、`package.json` に `predeploy:web` script追加
- Batch03: `scripts/check-migration-safety.ts`（破壊的DDL検知、fail-open）新規作成、CI（`analytics-ci.yml`）へ `migrate deploy` / `migrate diff --exit-code` 検証ステップ追加
- Batch04: CLAUDE.md / EVENT.md / `src/event/CLAUDE.md` 更新、`docs/deploy/prisma-migration-runbook.md` 新規作成（本番移行runbook）

## risk

HIGH（全体）。Batch02（Dockerfile/package.json変更）がHIGH、Section C（本番baseline登録、ユーザー手動実行・スコープ外）がCRITICAL。

## reason

`db push --accept-data-loss` は前進のみでロールバック非対応・migration履歴を持たない。本番運用の安全性向上のため
`migrate deploy`（`_prisma_migrations` テーブルで履歴管理、前進のみでcolumn自動DROPしない）へ移行する。
詳細な設計判断根拠は `.claude/plans/20260911-analytics-prisma-migrate-deploy.md`（design-review反映済み）。

## affected baseline cases

該当なし（機能テストケースではなく運用方式移行のため baseline.md は作成せず、Quality Gate
（typecheck / test:unit / build）のみで検証）。

## reviewers

- design-review: DeepSeek + Codex-terra + Opus（3体並列、risk=HIGH・難易度HARD）。CRITICAL 1件・HIGH 4件・MEDIUM 6件・LOW 3件をVALID反映済み
- code-review: DeepSeek + Codex-terra（並列）

## important findings と VALID/INVALID判断

### code-review（実装後）

- **Codex CRITICAL**（`0_init` と既存 `_prisma_migrations` の整合性懸念）: **ALREADY_HANDLED**。
  計画Section C-2手順3で、本番baseline登録前に `SELECT * FROM public._prisma_migrations ORDER BY started_at;`
  で現状確認する設計が既に明記済み。テーブルが空であることを事前確認してから手順4（baseline登録）へ進む運用。
- **Codex HIGH**（Pre-Deploy CommandがRailwayダッシュボード限定設定で、この変更セットでは検証されない）:
  **ALREADY_HANDLED**。計画のメインエージェント判断事項3で「今回はダッシュボード限定設定のまま実装、
  IaC化は将来改善候補としてrunbookに記載する」という意図的な方針が明記済み。runbookにも記載済み。
- **Codex MEDIUM**（`check-migration-safety.ts` の `git diff origin/main...HEAD` がCIのshallow clone環境で
  `origin/main` を解決できず、fail-open実装により検知が静かにスキップされる）: **VALID**。
  `.github/workflows/analytics-ci.yml` の `actions/checkout@v4` へ `fetch-depth: 0` を追加して修正。
- **DeepSeek MEDIUM**（`check-migration-safety.test.ts` のテスト名が実装の期待結果と矛盾）: **VALID**。
  テスト名を実装内容（DROP TABLE IF EXISTSは警告する）に合わせて修正。
- **DeepSeek LOW**（`--from-url` の方が `--from-schema-datasource` より明示的、という指摘）: **INVALID**。
  計画のF5対応（design-review反映）で `--from-url` のシェル変数展開バグとmultiSchema非対応を理由に
  `--from-schema-datasource` を意図的に採用した経緯が計画C-2手順1に明記済み。

## verification

- `npm run typecheck`: PASS
- `npm run test:unit`（vitest run --exclude integration、123ファイル/1648件）: PASS（`dockerfile-startup.test.ts`・`check-migration-safety.test.ts` 含む）
- `npx next build`: PASS
- ローカルテストDB（localhost:5433）での `migrate resolve --applied 0_init` → `migrate deploy` → `migrate status`
  （「0 pending migrations」）: PASS（Batch01実装時にworker側で実施済み）

## 追記（2026-09-11 baseline再生成）

本番baseline登録の事前確認（`migrate diff --exit-code`）で、Wave1整理コミット（b9801ede）が
コード側からは削除済みだが本番へ未反映（db push運用停止により反映経路が一時的に失われていた）の
オブジェクト（`room_monitor_leases`テーブル、`hostDisplayIds`/`scheduledStartAt`/`scheduledEndAt`カラム）
を検出。ユーザー承認を得て、本番introspect結果から`0_init`を再生成し、独立migration
`20260911180000_wave1_cleanup_unused_schema_elements`でこれらを削除する方針とした。

### code-review（baseline再生成分）

- **Codex HIGH**（`0_init`書き換えと`_prisma_migrations`チェックサム不整合懸念）: **ALREADY_HANDLED**。
  本番はまだ`migrate resolve --applied`未実施（このセッションでは実行しない）。計画Section C-2手順3で
  baseline登録前に本番`_prisma_migrations`が空であることを事前確認する設計が既に明記済み
- **Codex MEDIUM**（DROP COLUMN/DROP TABLEのACCESS EXCLUSIVEロック、lock_timeout未設定）: **VALID**。
  `20260911180000_wave1_cleanup_unused_schema_elements/migration.sql`冒頭に
  `SET LOCAL lock_timeout = '5s';`を追加して修正
- **DeepSeek**: OpenRouterクレジット不足（HTTP 402）で2回とも実行不能。ユーザー確認の上、
  Gemini（Antigravity経由、`agy/gemini-3.7-flash-medium`）で代替。findings 0件（NO ISSUES）

### 副次的に発覚した既存バグ（integrationテストとCHECK制約の不整合）

pre-commit hookのintegrationテストで、`match-detail.integration.test.ts`/
`match-contributions.integration.test.ts`が4件FAILした。原因はこのbaseline再生成ではなく、
既存commit b9801ede（Wave1-B、マージ済み）で追加したCHECK制約
`EventMatchBattleCandidate_group_requires_selected`（`combinedGroupId`非null時は
`organizerSelected`もtrue必須）と、テストヘルパーが`selected`列（実効ゲーム集合、別列）しか
設定せず`organizerSelected`列を設定していなかったことの不整合。旧`db push`運用ではCHECK制約が
schema.prismaに表現できず反映されなかったため顕在化していなかった。`migrate deploy`で初めて
実DBへ適用され今回発覚。テストヘルパー側に`organizerSelected`設定を追加して修正（VALID、実装
コード側の不具合ではない）。

### 検証（baseline再生成分）

- ローカルテストDB（localhost:5434）: スキーマDROP CASCADEでリセット → `migrate deploy`（3migration全適用成功）
  → `migrate diff --exit-code`（差分なし）→ `migrate status`（up to date）: PASS
- `npm run typecheck`: PASS

## 追記（2026-09-12 本番baseline registration実施）

main マージ後、ユーザー承認のもと本番DBへ以下を実施（`Section C-2`）。

1. `migrate diff --exit-code`（事前確認）→ 差分あり（`room_monitor_leases`等4件、wave1_cleanup分）
2. 削除対象4件のデータ有無を確認（読み取りのみ）: `room_monitor_leases`（0行）・
   `DetectedBattle.hostDisplayIds`（0件 non-null）・`EventMatch.scheduledStartAt/EndAt`（0件
   non-null）は空。**`tiktok_battles.hostDisplayIds` のみ実データ827件（非空配列）残存**を発見
3. ユーザーへ確認 → 「バックアップなしで削除続行」を明示選択（表示専用データ、コード側は
   b9801edeで読み書き完全停止済みとの判断）
4. `_prisma_migrations` 現状確認 → テーブル不存在（db push運用のため未作成、想定通り）
5. `migrate resolve --applied 0_init` 実行 → baseline登録
6. Wave1-B CHECK制約5件が既に手動psqlで本番適用済み（`convalidated=t`）であることを確認
   → `migrate resolve --applied 20260911160000_add_wave1b_check_constraints` で記録
7. `migrate deploy` 実行 → `20260911180000_wave1_cleanup_unused_schema_elements` を実適用
   （`room_monitor_leases`テーブル削除、`tiktok_battles.hostDisplayIds`含む4列削除）
8. 最終検証: `migrate diff --exit-code`（差分なし）・`migrate status`（up to date）: PASS

## 追記（2026-09-12 Pre-Deploy Command設定）

Railway CLIの `railway api`（GraphQL、`ServiceInstanceUpdateInput.preDeployCommand`）経由で
LiveAnalyticsサービスに `npm run predeploy:web` を設定した（ユーザー承認取得済み）。CLIに専用
サブコマンドは無いが、`service`/`config`（IaC railway.ts、TS SDK未導入のため利用不可）には
無く、GraphQL API直叩きで設定できることを `railway api search preDeploy` で確認した。

- `preDeployCommand` の型は `[String!]` だが、コマンド全体を要素配列でなく**1要素の文字列**
  （`["npm run predeploy:web"]`）として渡す必要があった。単語ごとに分割して渡す
  （`["npm","run","predeploy:web"]`）と `Invalid input` で失敗する
- worker1/2/3・event-worker・worker-guardianには設定していない（runbook通り、意図的。
  migrate deployを実行するのはweb起動時のみとする既存方針）
- 設定後、`serviceInstance` クエリで `preDeployCommand: ["npm run predeploy:web"]` を再確認済み
- 次回デプロイ（mainブランチのpush）からPre-Deploy Commandとして自動実行される

## remaining risks

- `tiktok_battles.hostDisplayIds` の827件（非空配列データ）はバックアップなしで削除した。
  再取得手段はコード側に残っていない（b9801ede Wave1-Cで完全除去済み）
- Pre-Deploy Command設定後の実デプロイでの動作確認（migrate deployが正常に走ること）は
  未実施。次回mainへのpushで自動デプロイされた際に確認が必要
