---
project: live-sidestage-mobile
feature: free-tts-interval
last_updated: 2026-09-13
last_risk: LOW
last_reviewers: Gemini 3.7 Flash
---

# FREE TTS インターバル

FREEプラン（mobile β なし）のオンデバイス読み上げは、50件読み上げるごとに10分間、新規コメントをキューに積まない。β / PRO / ULTRA は対象外。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-FTI-001 | FREE の件数・休憩時間が 50件 / 10分 | speech_queue.dart 定数 | 正常 | ソース上の定数 | 閾値 50、クールダウン 10分 | python assert `_freeIntervalThreshold = 50` と `Duration(minutes: 10)` | PASS | |
| TC-FTI-002 | 購読画面の FREE 特典が同じ数字 | subscription_screen.dart | UI | プラン選択画面 | 「50件ごとに10分の休憩あり」 | python assert 当該文字列 | PASS | 実機はレイアウト変更なし |
| TC-FTI-003 | クールダウン中は新規を積まない | SpeechQueueController._enqueue | 回帰 | debugStartFreeIntervalCooldown | キュー長 0 | `flutter test test/speech_queue_duplicate_test.dart --plain-name "FREEプランのクールダウン中"` | PASS | |

## Quality Gate

- `flutter test test/speech_queue_duplicate_test.dart`
- `flutter analyze lib/core/speech_queue.dart lib/screens/subscription_screen.dart lib/core/account_status_store.dart`

## Out of Scope

- duplicate-comment-tts-skip
- 50件ループや10分実時間待ち
- analytics サーバー強制
- 購読画面の視覚デザイン
