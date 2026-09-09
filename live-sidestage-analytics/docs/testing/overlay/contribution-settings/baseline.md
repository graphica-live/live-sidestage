---
project: live-sidestage-analytics
feature: Overlay Contribution Settings
last_updated: 2026-09-10
last_risk: LOW
last_reviewers: Fable
---

# テストベースライン: Overlay Contribution Settings

オーバーレイ貢献リスト設定。Streamer モデルから分離した独立テーブル `OverlayContributionSettings`。設定 UI がないため固定デフォルト値で運用。将来の UI 追加に備えてテーブル化。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-OVCS-001 | Prisma スキーマが型に従うことを確認 | schema.prisma | 正常 | `OverlayContributionSettings` モデル定義、Streamer relation | tsc が型エラーを出さない | `npm run typecheck` | PASS | |
| TC-OVCS-002 | 既存 contribution 機能が回귀없이 동작 | src/lib/overlay/contribution.server.ts | 回帰 | ローカル DB、シード 스트리머 | buildOverlaySnapshot() が正常に 반환 | `npx dotenv -e .env.local.test -- vitest run src/lib/overlay/contribution.server.integration.test.ts` | NOT RUN: Docker Desktop 미실행 | 本번 Schema 반영 후 실行 필요 |

## Quality Gate

このプロジェクトで回すコマンド（TC 番号を振らない）。

- `npm run typecheck`: PASS

## Out of Scope

- DB migration（`db push` / `npm run seed:local`）: このセッションでは schema.prisma の型検査のみ。migration は worktree exit 후 pre-commit hook에서 실행
