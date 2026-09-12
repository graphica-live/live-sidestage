---
project: live-sidestage-mobile
feature: ギフト履歴タブ(GiftHistoryTab)
last_updated: 2026-09-12
last_risk: MEDIUM
last_reviewers: Gemini(agy、Code Mode、medium)。Batch03 ListPanelSliver+_events
---

# テストベースライン: ギフト履歴タブ(GiftHistoryTab)

受信ギフトの時系列一覧。行タップで TikTok プロフィール(`openTiktokProfile`)。🎁絵文字・ギフト画像サムネは出さない(comp)。

**2026-09-12(Batch03)**: 行描画を `ListView`+`ListPanel`(全件即時構築)から `CustomScrollView`+`ListPanelSliver`へ変更。
貢献タブと同型の `_events` キャッシュ・silent load・期間UI常時有効・`LinearProgressIndicator`(2dp)を揃えた。
見た目(comp `.panel.soft` + `.row-item`)・pull-to-refresh・push同期契約は維持。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-GH-001 | ギフト履歴イベントのパース契約 | `GiftHistoryEvent.tryParse` | 正常 | 既知フィールドの map | モデルが生成される | `flutter test test/gift_history_event_test.dart` | PASS | |
| TC-GH-002 | 「今日」を含む期間表示中、Store append で `_events` が listener 経由で更新される | `GiftHistoryTab._onGiftHistoryAppend` + `_events` | 正常/回帰 | `containsToday` かつ Store に履歴あり | build 毎の `context.watch`+全件 parse を使わず `_applyStoreHistoryEvents` で一覧更新 | コードレビュー + `flutter analyze` | (review後) | |
| TC-GH-003 | 過去日のみ表示中は Store を描画ソースにしない | `GiftHistoryTab._onGiftHistoryAppend` | 回帰 | `containsToday == false` | Store listener は resync のみ処理し、REST 結果の `_events` を push で上書きしない | コードレビュー | (review後) | |
| TC-GH-004 | 件数が多い期間でもスクロールが実用的 | `GiftHistoryTab`(`ListPanelSliver`) | 性能 | 高件数 room の当日履歴 | 画面外行が即全件 build されない | 実機(推奨) | NOT RUN | 貢献タブ TC-CT-023 と同 room で横確認可 |
| TC-GH-005 | 日付◀/▶・期間切替で期間UIが無効化されない | `_load(silent:)` + `PeriodSelectorBar enabled: true` | UX | 既存一覧表示中に期間変更 | 取得中も期間コントロールがグレーアウトされない | 実機(推奨) | NOT RUN | 貢献 TC-CT-027 と同型 |
| TC-GH-006 | silent 再取得失敗でプログレスが永久表示されない | `_load` catch(silent) | 異常 | `silent: true` かつ `_result != null` で API 失敗 | `_loading` が false | コードレビュー | (review後) | 貢献 TC-CT-028 と同型 |
| TC-GH-007 | `ListPanelSliver` のカード視覚が旧 `ListPanel` と同一 | `ListPanelSliver` | UI/回帰 | ギフト履歴一覧表示 | 角丸・シャドウ・区切り線・行 padding が従来と同一 | 実機スクリーンショット | NOT RUN | TC-CT-026 と同判断可 |
| TC-GH-008 | pull-to-refresh が `CustomScrollView` 化後も動く | `RefreshIndicator` | 回帰 | 下方向スワイプ | `_load()` が呼ばれる | 実機 | NOT RUN | |

## Quality Gate

- `flutter analyze lib/screens/tabs/gift_history_tab.dart` → PASS(2026-09-12)
- `flutter test test/gift_history_event_test.dart test/realtime_sync_test.dart` → PASS(18/18)

## Out of Scope

- `widget_test.dart` オンボーディング文言不一致(別件)
