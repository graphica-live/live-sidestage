---
project: live-sidestage-analytics
feature: Overlay Contribution Settings
last_updated: 2026-09-10
last_risk: CRITICAL
last_reviewers: DeepSeek, Codex, Gemini (Batch04列削除)
---

# テストベースライン: Overlay Contribution Settings

オーバーレイ貢献リスト設定。Streamer モデルから分離した独立テーブル `OverlayContributionSettings`。設定 UI (`/overlays`、API `/api/streamer/overlay-settings`)は Batch03 で本テーブル経由の読み書きへ切替済み。**Batch04（2026-09-10）で `Streamer` 側の旧9列（`overlayDisplayReference`/`overlayDisplayDate`/`overlayThreshold`/`overlayGoalCount`/`overlayVisibleRows`/`overlayNameMaxWidth`/`overlayAlign`/`overlayHeadingBackground`/`overlayDisplaySpeed`）を削除し、`OverlayContributionSettings` だけが表示設定の正本になった。** `overlayToken`（全overlay種類共通の認証credential）は無変更のままStreamerに残る。列削除自体は実装詳細でありユーザー可視の振る舞い変化はないため、新規テストケースの追加はなし（Batch03時点のケースがそのまま有効）。

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
| TC-OVCS-008 | 設定行が無い配信者のGETがデフォルト値を返す | src/app/api/streamer/overlay-settings/route.ts (GET) | 正常/境界 | OverlayContributionSettings行が無いStreamer | threshold=1000/goalCount=5/visibleRows=5/nameMaxWidth=140/align=left/headingBackground=clear/displaySpeed=3、displayDate・isTodayが定義される | `npx dotenv -e .env.local.test -- vitest run src/app/api/streamer/overlay-settings/route.integration.test.ts` | PASS | |
| TC-OVCS-009 | カスタム値ありの配信者のGETが正しい値を返す | src/app/api/streamer/overlay-settings/route.ts (GET) | 正常 | threshold=500/goalCount=10/visibleRows=8/nameMaxWidth=200/align=right/headingBackground=sakura-pink/displaySpeed=5/displayReference=fixed/displayDate=2026-09-01 | GETが全カラムをそのまま返す。isToday=false | 同上 | PASS | |
| TC-OVCS-010 | PATCH応答がOverlaySettingsPayload契約を満たす(overlayToken/isToday/正規化値を含む) | src/app/api/streamer/overlay-settings/route.ts (PATCH) | 回帰 | 設定行なしの配信者へ`{threshold:600,goalCount:12}`をPATCH | 応答にoverlayToken(string)・isToday・align=left・headingBackground=clear・displaySpeed=3が含まれる(内部payload直返しではない)。DBにも反映される | 同上 | PASS | 2026-09-10 code-review DeepSeek HIGH finding修正の固定。当初は`contributionSettingsServer.patch()`の内部payloadを直接返しoverlayToken/isToday欠落・未正規化値だった |
| TC-OVCS-011 | PATCHで既存設定を更新できる | src/app/api/streamer/overlay-settings/route.ts (PATCH) | 正常 | 既存threshold=400の配信者へ`{threshold:700}`をPATCH | 応答・DBともthreshold=700 | 同上 | PASS | |
| TC-OVCS-012 | PATCH nav=today/prevで日付基準が正しく遷移する | src/app/api/streamer/overlay-settings/route.ts (PATCH) | 正常 | displayReference=fixed,displayDate=2026-09-01の状態で`{nav:"today"}`、続けてdisplayReference=today状態で`{nav:"prev"}` | today: displayReference=today・displayDate=NULLへ。prev: 前日の日付キーへ遷移しdisplayReference=fixed | 同上 | PASS | |
| TC-OVCS-013 | 不正な閾値のPATCHは拒否される | src/app/api/streamer/overlay-settings/route.ts (PATCH) | 異常 | `{threshold:150}`(100の倍数でない) | HTTP 400、エラーメッセージ返却、DB変更なし | 同上 | PASS | |
| TC-OVCS-014 | 旧Streamer列時代に上限が無かった数値項目は、cutover後も広い値を受理する(後方互換性) | src/app/api/streamer/overlay-settings/route.ts (PATCH) | 境界/回帰 | `{threshold:5000000,goalCount:2000000,visibleRows:500,nameMaxWidth:5000}` | HTTP 200、指定値がそのまま反映される(100万等の恣意的な上限で拒否されない) | `npx dotenv -e .env.local.test -- vitest run src/app/api/streamer/overlay-settings/route.integration.test.ts` | PASS | 2026-09-10 Codex MEDIUM finding修正の固定。当初`clampInt(..,1_000_000)`等の新規上限が旧実装(上限なし)からの後方互換性を破壊していた |

## Quality Gate

このプロジェクトで回すコマンド（TC 番号を振らない）。

- `npm run typecheck`: PASS
- `npm run test:unit`: PASS (2026-09-10 Batch04列削除後、110ファイル/1520テスト全PASS)
- `npx dotenv -e .env.local.test -- vitest run src/lib/overlay/contribution.server.integration.test.ts`: PASS (2026-09-10 Batch04列削除後、2 tests)
- `npx dotenv -e .env.local.test -- vitest run src/app/api/streamer/overlay-settings/route.integration.test.ts`: PASS (2026-09-10 Batch04列削除後、8 tests)

## Out of Scope

- 本番 DB への反映: 本番は `prisma db push` を web 起動時に実行するため、`prisma/migrations/` 配下のファイルは適用されない（履歴ドキュメントのみ）。mainマージ・デプロイ後に本番へ反映される
- 件数不一致(異常終了パス)の再現テスト: 手動シミュレーションが煩雑で実務上の価値が低いためスキップ(2026-09-10 DeepSeek/Codexレビューで判断)
- 完全backfill済み状態でのdry-run確認: 任意。必須ではないため未実施(2026-09-10 DeepSeek/Codexレビューで判断)

## Batch04(列削除)レビュー記録 (2026-09-10)

DeepSeek/Gemini: NO ISSUES(0 findings)。Codex-terra: 2件指摘。

- **CRITICAL(Codexのみ)**: migration.sqlがDROP COLUMNのみでbackfill完了検証を含まない → 本番DBへ読み取り専用クエリで直接検証し、`Streamer`と`overlay_contribution_settings`の件数一致・欠損0件・非デフォルト値を持つ未backfill行0件を実測確認した(実行時点: streamer_count=1, settings_count=1, missing_settings_row=0, data_loss_risk_count=0)。migration.sql自体に検証ロジックを埋め込む設計変更はスコープ外と判断し、実データ確認で安全性を担保
- **HIGH(Codexのみ)**: `scripts/backfill-overlay-contribution-settings.ts`が列削除後は実行不能になる → 意図した仕様(一回限りのbackfillは完了・検証済み)。スクリプト冒頭に「Batch04完了により死亡」コメントを追記して誤実行を防止(削除はせず`scripts/migrate-tiktok-userid-reset.ts`と同じ「履歴として残す死んだスクリプト」の扱いに統一)
