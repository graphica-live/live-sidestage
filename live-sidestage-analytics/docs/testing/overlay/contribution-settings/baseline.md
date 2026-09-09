---
project: live-sidestage-analytics
feature: Overlay Contribution Settings
last_updated: 2026-09-10
last_risk: HIGH
last_reviewers: DeepSeek, Codex
---

# テストベースライン: Overlay Contribution Settings

オーバーレイ貢献リスト設定。Streamer モデルから分離した独立テーブル `OverlayContributionSettings`。設定 UI がないため固定デフォルト値で運用。将来の UI 追加に備えてテーブル化。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-OVCS-001 | Prisma スキーマが型に従うことを確認 | schema.prisma | 正常 | `OverlayContributionSettings` モデル定義、Streamer relation | tsc が型エラーを出さない | `npm run typecheck` | PASS | |
| TC-OVCS-002 | 既存 contribution 機能が回帰なく動作 | src/lib/overlay/contribution.server.ts | 回帰 | ローカル DB、シード ストリーマー | buildOverlaySnapshot() が正常に返却 | `npx dotenv -e .env.local.test -- vitest run src/lib/overlay/contribution.server.integration.test.ts` | PASS (2 tests) | カラム名を prefix なし規則(`threshold`/`goalCount`等)へリネーム後に実行。`db:push:local`でローカルDBへ反映済み |
| TC-OVCS-003 | backfillスクリプトがdry-runで書き込みをしない | scripts/backfill-overlay-contribution-settings.ts | 正常 | ローカルDB、シード済みStreamer1件(overlayThreshold等をカスタム値に更新済み) | Streamer件数/未backfill件数のログのみ出力、書き込みなし | `npx dotenv -e .env.local.test -- tsx scripts/backfill-overlay-contribution-settings.ts --dry-run` | PASS | overlay_contribution_settings件数=0のまま |
| TC-OVCS-004 | backfillが既存カスタム値を正確にコピーする | scripts/backfill-overlay-contribution-settings.ts | 正常 | 上記のカスタム済みStreamer(threshold=500,goalCount=12,align=right,displayReference=fixed,displayDate=2026-08-15,headingBackground=sakura-pink,visibleRows=8,nameMaxWidth=200,displaySpeed=5) | overlay_contribution_settingsに全カラムが同値でコピーされる。件数一致ログが出る | 実行後 `SELECT * FROM overlay_contribution_settings` で目視比較 | PASS | 全カラム一致を確認済み |
| TC-OVCS-005 | backfillが冪等(再実行で重複・上書きなし) | scripts/backfill-overlay-contribution-settings.ts | 正常 | TC-OVCS-004実行済みの状態で再実行 | 「未backfillの行はありません」でスキップ、件数一致 | 同スクリプトを再実行 | PASS | ON CONFLICT DO NOTHINGにより冪等であることを確認 |
| TC-OVCS-006 | デフォルト値のStreamerも正しくbackfillされる(混在データ) | scripts/backfill-overlay-contribution-settings.ts | 正常 | カスタム済みStreamer1件+デフォルト値のStreamer1件(新規作成) | 新規分のみinsertされ、既存カスタム行は変更されない。件数一致 | dry-run→実行→`SELECT * FROM overlay_contribution_settings` | PASS | 2行とも正しい値。カスタム行は不変 |
| TC-OVCS-007 | overlayDisplayDateがNULLのStreamerもNULLとして正しくbackfillされる | scripts/backfill-overlay-contribution-settings.ts | 境界 | `overlayDisplayReference`(既定"today")のまま`overlayDisplayDate`を一度も設定していないStreamer1件(新規作成、overlayDisplayDate=NULL) | overlay_contribution_settingsの`displayDate`列もNULLとしてbackfillされる(件数一致、例外なし) | 一時セットアップスクリプトでStreamerを作成→本番相当の実行(dry-runなし)→`SELECT "displayDate" FROM overlay_contribution_settings WHERE "streamerId"=...`で確認→後片付け | PASS | `streamer.overlayDisplayDate=null` → `overlay_contribution_settings.displayDate=null` を実測確認。検証用の一時スクリプトはcommit対象外(検証後に削除済み) |

## Quality Gate

このプロジェクトで回すコマンド（TC 番号を振らない）。

- `npm run typecheck`: PASS

## Out of Scope

- 本番 DB への反映: 本番は `prisma db push` を web 起動時に実行するため、`prisma/migrations/` 配下のファイルは適用されない（履歴ドキュメントのみ）。mainマージ・デプロイ後に本番へ反映される
- 件数不一致(異常終了パス)の再現テスト: 手動シミュレーションが煩雑で実務上の価値が低いためスキップ(2026-09-10 DeepSeek/Codexレビューで判断)
- 完全backfill済み状態でのdry-run確認: 任意。必須ではないため未実施(2026-09-10 DeepSeek/Codexレビューで判断)
