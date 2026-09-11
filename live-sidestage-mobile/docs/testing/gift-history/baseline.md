---
project: live-sidestage-mobile
feature: gift-history
last_updated: 2026-09-12
last_risk: HIGH
last_reviewers: Codex(terra, medium) + Gemini(agy, OmniRoute経由)。Batch02 push駆動リアルタイム同期(方式A)分
---

# テストベースライン: gift-history (期間制限)

ギフト履歴タブ(`GiftHistoryTab`)の期間選択を、明細の保持期間90日
(`live-sidestage-analytics`の`GIFT_RETENTION_DAYS`/`GIFT_HISTORY_MAX_RANGE_DAYS`)に合わせて
制限する。`AnalyticsPeriod`・`PeriodSelectorBar`・カスタム範囲シート(`custom_range_filter_sheet.dart`)
は貢献タブ・バトル履歴タブと共有しているため、`availablePeriods`/`maxRangeDays`という追加パラメータで
ギフト履歴タブだけを絞り込む方式にした。他タブ(貢献・バトル履歴、year込み・366日既定)は対象外。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-GH-001 | ギフト履歴タブの期間チップに「年」が出ない | `GiftHistoryTab`が`PeriodSelectorBar`へ渡す`availablePeriods` | 正常 | ギフト履歴タブを開く | 表示される期間チップが日/週/月のみ | コードレビュー(`availablePeriods: const [day, week, month]`を指定していることを確認) + Marionette MCP/実機確認 | NOT RUN: 実機確認はコスト・時間の都合でユーザー判断により今回省略。`flutter analyze`は通過済み | 貢献・バトル履歴タブは`availablePeriods`未指定(既定`AnalyticsPeriod.values`)のため年チップが残ることも同実装で保証 |
| TC-GH-002 | ギフト履歴タブのカスタム範囲シートで、開始日時ピッカーが90日より前を選べない | `_pickStart`のfirstDate計算(`custom_range_filter_sheet.dart`) | 境界 | `maxRangeDays: 90`を渡してシートを開く | `firstDate` = 今日0時 - 89日 (`widget.maxRangeDays - 1`)。90日ちょうど前の日付までは選択可、それより前は`showDatePicker`の`firstDate`制約で選択不可 | コードレビュー(実装確認) + 実機でのdatePicker操作確認 | NOT RUN: 実機確認は同上省略。ロジックは`flutter analyze`通過・目視コードレビューで確認済み | 90日ちょうどでなく89日前を境界にしている(UI上の補助的な下限であり、`_canApply`の90日ちょうど判定が最終的な正とする設計) |
| TC-GH-003 | 開始〜終了が90日を超えるカスタム範囲は適用できない | `_canApply`(`custom_range_filter_sheet.dart`) | 境界/negative | `maxRangeDays: 90`、`end.difference(start)`が90日超 | `_canApply`が`false`(適用ボタンが無効) | `flutter test test/gift_history_event_test.dart` (既存6件は`GiftHistoryEvent.tryParse`のみ対象、本ケースの直接テストは無し) | NOT RUN: `_canApply`単体のwidget/unitテストは未整備。ロジック(`end.difference(start) > Duration(days: widget.maxRangeDays)`)をコードレビューで確認し、サーバー側`clampGiftHistoryDatetimeRange`(90日ちょうどで許容)と一致することを式レベルで照合済み | 貢献/バトル履歴タブは`maxRangeDays`未指定(既定366)のため従来どおり366日まで許容 |
| TC-GH-004 | 貢献・バトル履歴タブの期間選択(年チップ・366日カスタム)は本変更で変わらない | `contribution_tab.dart` / `battle_history_tab.dart`の`showCustomRangeFilterSheet`/`PeriodSelectorBar`呼び出し | 回帰 | 貢献タブ・バトル履歴タブを開く | `availablePeriods`/`maxRangeDays`を指定していないため既定値(全期間種別・366日)のまま | コードレビュー(該当2ファイルの呼び出し箇所が変更対象に含まれていないことを確認) | PASS(該当ファイルはdiff対象外であることをgit diffで確認済み。`flutter analyze`/既存`flutter test`も全通過) | |
| TC-GH-005 | 「今日」を含む期間・カスタム範囲を表示中、Socket.IOで正常なgift-history append pushを受信すると、REST再取得を待たず一覧の先頭に新しいギフト行が追加される | `GiftHistoryTab.build` + `GiftHistorySyncStore` | 正常/回帰 | 期間選択が今日を含む状態で、`GiftHistorySyncStore`が`canApply`な`chat:gift-history:append`を受信(version整合、未受信のGift.id) | `containsToday`が`true`のため`store.getHistory()`が描画ソースに使われ、新しい行を含むようになる | コードレビュー(`build()`が`containsToday`条件下で`context.watch<GiftHistorySyncStore>().getHistory()`を`GiftHistoryEvent.tryParse`で復元して参照していることを確認) + `flutter test`/`flutter analyze` | PASS(コードレビュー確認、Codexレビューで検出されたHIGH不具合の修正) | Batch06で修正。修正前は`needsResync`時のみ`_load()`が呼ばれ、正常push受信時は画面が一切更新されない不具合があった |
| TC-GH-009 | 「今日」を含まない過去の期間・カスタム範囲を表示中は、gift-history push受信でもStoreが描画ソースにならず表示が汚染されない | `GiftHistoryTab.build`の`containsToday`ガード | 境界/negative | 過去のカスタム範囲(customRangeContainsNowがfalse)を選択中に、pushが届き`GiftHistorySyncStore`へ追加される | `containsToday`が`false`のため`storeHistory`は常に空扱いとなり、`events`はRESTの`result?.events`のまま(Storeの内容で選択中の範囲データが隠蔽されない) | コードレビュー(`build()`の`containsToday ? context.watch<GiftHistorySyncStore>().getHistory() : const []`を確認) + `flutter analyze`/`flutter test` | PASS | Batch02のCodex code-review finding(MEDIUM: gift-history pushが選択中の期間・カスタム範囲を無視してStoreへ無条件追加され、表示ソースが完全にStoreへ切り替わる)の修正。2026-09-12対応 |
| TC-GH-006 | 同一Gift.idのappendが複数回届いても一覧に重複追加されない | `GiftHistorySyncStore._onGiftHistoryAppend` | 境界/negative | 同じ`id`を持つappend payloadが2回届く | 2回目は`_seenGiftIds`により無視され、一覧に重複行が出ない | `flutter test test/realtime_sync_test.dart`(冪等dedupケース) | PASS | |
| TC-GH-007 | REST取得直後、サーバーの現在versionを反映しないまま次のpushを欠損と誤判定しない | `GiftHistorySyncStore.acknowledgeResync` + `VersionTracker.acknowledge` | 境界/回帰 | REST取得時点でサーバーversionが5、直後に届くpushがversion 6 | `acknowledgeResync`が`VersionTracker.acknowledge(bootId, version: 5)`でtrackerを実版数へ同期するため、version 6のpushは`canApply`になる | `flutter test test/realtime_sync_test.dart`(`acknowledge()`関連ケース) | PASS | Batch06で修正。修正前は`acknowledgeResync`が常に`VersionTracker.reset()`(=0)していたため、次のpushが恒久的にversion欠損と誤判定されREST再取得が無限に続くおそれがあった(Codexレビューで検出) |
| TC-GH-008 | アプリ起動時に`GiftHistorySyncStore`/`CommentFeed`のProvider登録漏れが無く、ギフトタブが例外で真っ白にならない | `main.dart`(`LiveSidestageApp`の`MultiProvider`) + `GiftHistoryTab.initState` | 回帰 | アプリ起動(`LiveSidestageApp`を実際にpump) | `Provider.of<CommentFeed>`/`Provider.of<GiftHistorySyncStore>`等が`ProviderNotFoundException`を投げない。実機ではギフトタブが履歴一覧を表示する(白画面にならない) | `flutter test test/widget_test.dart --plain-name "Provider登録"` + 実機確認(Pixel 7a) | PASS(2026-09-12、実機で貢献/ギフト/バトル3タブとも正常表示を確認) | 2026-09-11のBatch05でこれら4クラスをMultiProviderへ登録し忘れ、3タブが`initState`で例外を投げて真っ白になっていた不具合の再発防止ケース。TC-GH-005〜007は「コードレビュー確認」でPASS済みとしていたが、実際にはこの登録漏れによりギフトタブ自体が起動直後に例外でクラッシュしており、push反映機能は実行されていなかった |

## Quality Gate

- `flutter analyze`
- `flutter test test/gift_history_event_test.dart`
- `flutter test test/realtime_sync_test.dart`

## Out of Scope

- `GiftHistoryEvent.tryParse`のパース仕様自体(既存6ケース)は本変更で触れていないため対象外
- サーバー側の90日クランプは `live-sidestage-analytics/docs/testing/gift-history-range/baseline.md` を参照
- Marionette MCP/実機での実際のUI操作確認は、今回コスト・時間の都合でユーザー判断により省略した(チップ非表示・日付下限追加という機械的に検証可能な変更であり、視覚デザイン変更を伴わないため実害は低いと判断)
- TC-GH-005〜007、TC-GH-009のpush反映は実データ・実配信での実機確認が理想だが、本worktreeには`.mcp.json`(Marionette MCP)が無く`adb`もPATH未導入のため実機確認はNOT RUN。コードレビューと`flutter test`で担保している
