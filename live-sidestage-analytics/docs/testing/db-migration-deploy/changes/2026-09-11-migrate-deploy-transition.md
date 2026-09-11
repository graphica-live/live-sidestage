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

## remaining risks

- Section C（本番baseline registration・cutover）はこのセッションのスコープ外。ユーザーが別途手動実行する
- Pre-Deploy Commandはダッシュボード限定設定のまま（IaC化は将来改善候補、runbook記載済み）
