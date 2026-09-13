---
project: live-sidestage-mobile
feature: ギフト履歴タブ(GiftHistoryTab)
last_updated: 2026-09-14
last_risk: LOW
last_reviewers: Gemini(agy/gemini-3.7-flash-medium、Code Mode、medium)。gift image thumbnail
---

# テストベースライン: ギフト履歴タブ(GiftHistoryTab)

受信ギフトの時系列一覧。行タップで TikTok プロフィール(`openTiktokProfile`)。ギフト名の左に `giftPictureUrl` があれば `GiftThumbnail`(20px) を置く。URL が無ければ名前だけ。

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
| TC-GH-009 | hasMore のときだけ末尾スクロールで追加ページを取る | `GiftHistoryTab._loadMore` | 正常 | `_result.hasMore==true`、末尾行の receivedAt/id をカーソルに送る | `_loadingMore` 中でなければ fetchGiftHistory(cursor) が走り、未知 id だけ `_events` 末尾へ。`acknowledgeResync` は呼ばない | コードレビュー + `flutter analyze` | (review後) | 貢献タブ閾値 240px と同型 |
| TC-GH-010 | 当日 Store append が loadMore 済み行を消さない | `_applyStoreHistoryEvents` | 回帰 | 追加ページ表示中に push append | Store 全置換せず未知 id だけ先頭 merge。既存ページの id が残る | コードレビュー + `flutter test test/realtime_sync_test.dart` | (review後) | |
| TC-GH-011 | ヘッダ合計はサーバ期間 aggregate でありクライアント加算しない | `_result.total` / `_loadMore` | 契約/回帰 | 2ページ以上ある期間 | 先頭ページ REST の total は期間全体。cursor ページ REST の total は stub(0,0)。UI ヘッダは先頭ページ値を維持し 0 に戻さない | gift-history.integration.test.ts + コードレビュー | PASS(2026-09-13) | ページ reduce 禁止。cursor 時 aggregate 省略 |
| TC-GH-012 | 日付◀▶のキャッシュヒットは即表示してから silent refresh | `_historyCache` / `_changePeriod` | 性能 | day かつ customRange なしで隣接日を一度表示済み | キャッシュキー一致時は `_events` を即復元し `_load(silent: true)`。prefetch 失敗は表示を壊さない | コードレビュー | (review後) | 貢献タブ `_rankingCache` と同型。新基盤なし |
| TC-GH-013 | ギフト名の左に画像出る | `GiftHistoryGiftLabel` | UI | `giftPictureUrl` あり / なし | あり: 20px サムネが名前の左。なし: サムネなしで名前のみ | `flutter test test/gift_history_gift_label_test.dart test/gift_thumbnail_test.dart` | PASS(2026-09-14) | Web `GiftNameDisplay` と同様に URL がないと隠す |

## Quality Gate

- `flutter analyze lib/screens/widgets/gift_thumbnail.dart lib/screens/tabs/gift_history_tab.dart lib/screens/gift_sound_edit_screen.dart lib/screens/tabs/sound_tab.dart lib/screens/widgets/user_avatar.dart` → PASS(2026-09-14)
- `flutter test test/gift_history_event_test.dart test/gift_history_gift_label_test.dart test/gift_thumbnail_test.dart` → PASS(14/14, 2026-09-14)

## Out of Scope

- `widget_test.dart` オンボーディング文言不一致(別件)
