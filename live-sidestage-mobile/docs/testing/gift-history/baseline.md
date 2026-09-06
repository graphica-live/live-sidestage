---
project: live-sidestage-mobile
feature: gift-history
last_updated: 2026-09-06
last_risk: HIGH
last_reviewers: Qwen(独立、2回目でdiff込みcontextにより有効化) + Gemini 3.8 flash(OpenRouter経由、Codex/Gemini(agy)quota枯渇のため代理) — テストケース専用レビューは未実施(コスト・時間の都合でユーザー判断により省略)
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

## Quality Gate

- `flutter analyze`
- `flutter test test/gift_history_event_test.dart`

## Out of Scope

- `GiftHistoryEvent.tryParse`のパース仕様自体(既存6ケース)は本変更で触れていないため対象外
- サーバー側の90日クランプは `live-sidestage-analytics/docs/testing/gift-history-range/baseline.md` を参照
- Marionette MCP/実機での実際のUI操作確認は、今回コスト・時間の都合でユーザー判断により省略した(チップ非表示・日付下限追加という機械的に検証可能な変更であり、視覚デザイン変更を伴わないため実害は低いと判断)
