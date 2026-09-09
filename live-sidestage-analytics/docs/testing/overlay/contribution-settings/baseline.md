---
project: live-sidestage-analytics
feature: Overlay Contribution Settings
last_updated: 2026-09-10
last_risk: LOW
last_reviewers: DeepSeek, Codex
---

# テストベースライン: Overlay Contribution Settings

オーバーレイ貢献リスト設定。Streamer モデルから分離した独立テーブル `OverlayContributionSettings`。設定 UI がないため固定デフォルト値で運用。将来の UI 追加に備えてテーブル化。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-OVCS-001 | Prisma スキーマが型に従うことを確認 | schema.prisma | 正常 | `OverlayContributionSettings` モデル定義、Streamer relation | tsc が型エラーを出さない | `npm run typecheck` | PASS | |
| TC-OVCS-002 | 既存 contribution 機能が回帰なく動作 | src/lib/overlay/contribution.server.ts | 回帰 | ローカル DB、シード ストリーマー | buildOverlaySnapshot() が正常に返却 | `npx dotenv -e .env.local.test -- vitest run src/lib/overlay/contribution.server.integration.test.ts` | PASS (2 tests) | カラム名を prefix なし規則(`threshold`/`goalCount`等)へリネーム後に実行。`db:push:local`でローカルDBへ反映済み |

## Quality Gate

このプロジェクトで回すコマンド（TC 番号を振らない）。

- `npm run typecheck`: PASS

## Out of Scope

- 本番 DB への反映: 本番は `prisma db push` を web 起動時に実行するため、`prisma/migrations/` 配下のファイルは適用されない（履歴ドキュメントのみ）。mainマージ・デプロイ後に本番へ反映される
