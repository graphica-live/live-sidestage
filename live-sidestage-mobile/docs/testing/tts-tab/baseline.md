---
feature: tts-tab
project: live-sidestage-mobile
last_updated: 2026-09-12
last_risk: LOW
last_reviewers: Gemini 3.7 Flash (TestCase, skipped — 文言のみ・code-review済)
---

# TTSタブ（コメント一覧・読み上げ）

## テストケース

| ID | 分類 | 前提 | 操作 | 期待結果 | 実行方法 | 結果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-TTS-001 | UI | コメント0件・部屋切替中でない | TTSタブを表示 | 空状態カードに「開始」を押すと、ここに表示されているコメントが読み上げられます」と登録直後60秒の注記が見える | `flutter test test/tts_tab_empty_state_test.dart` | PASS |
| TC-TTS-002 | UI | Pixel 7a・ログイン済み・アプリ前面 | TTSタブを開き空状態を表示 | TC-TTS-001と同じ文言が画面に見える | 実機(Pixel 7a `33071JEHN14416`) `adb` スクリーンショット | PASS |

## Quality Gate

- `flutter analyze lib/screens/tabs/tts_tab.dart`
- `flutter test test/tts_tab_empty_state_test.dart`

## Out of Scope

- VOICEVOX読み上げ品質・`SpeechQueueController` のキュー挙動（`voice-readout` / `duplicate-comment-tts-skip` baseline）
