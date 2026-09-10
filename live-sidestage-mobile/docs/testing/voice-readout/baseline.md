---
feature: voice-readout
last_updated: 2026-09-11
last_risk: LOW
last_reviewers: DeepSeek
---

# 読み上げボイス割り当て

コメント投稿者(tiktokUid)ごとのランダムボイス割り当て(`VoicePool`)、および固定ボイス設定に関するテストケース。

## テストケース

| ID | 分類 | 前提 | 操作 | 期待結果 | 実行方法 | 結果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-VR-001 | 正常系 | モデルに複数スタイルあり | `fixedStyleId` を設定していない状態で `fixedStyleId` を取得 | モデル先頭のスタイルが返る | `flutter test test/voice_pool_test.dart --plain-name "既定はモデルの先頭"` | PASS |
| TC-VR-002 | 正常系 | モデルに存在するstyleId | `fixedStyleId = <モデル内の値>` | 指定値がそのまま保持される | `flutter test test/voice_pool_test.dart --plain-name "モデルにあるstyleIdはそのまま持つ"` | PASS |
| TC-VR-003 | 異常系 | モデルに存在しないstyleId | `fixedStyleId = <モデル外の値>` | モデル先頭のスタイルへ落ちる(無音化防止) | `flutter test test/voice_pool_test.dart --plain-name "モデルに無いstyleIdは先頭へ落とす"` | PASS |
| TC-VR-004 | 境界値 | モデルが空(スタイル0件) | `fixedStyleId = <任意値>` | 例外を投げず `0` になる | `flutter test test/voice_pool_test.dart --plain-name "モデルが空でも落ちない"` | PASS |
| TC-VR-005 | 正常系 | ランダムOFF | 複数投稿者で `effectiveStyleId` を取得 | 全員 `fixedStyleId` と同じ値になる | `flutter test test/voice_pool_test.dart --plain-name "ランダムOFFなら誰のコメントでも固定ボイス"` | PASS |
| TC-VR-006 | 正常系 | ランダムON | 同じ投稿者で `effectiveStyleId` を複数回取得 | 初回抽選値が以後も維持される(セッション内で同一人物は同じボイス) | `flutter test test/voice_pool_test.dart --plain-name "ランダムONなら同じ投稿者には同じボイスを使い続ける"` | PASS |
| TC-VR-007 | 異常系 | ランダムOFF、モデルに存在しない`fixedStyleId` | `effectiveStyleId` を取得 | モデル先頭へ落ちた値で鳴らせる(無音化しない) | `flutter test test/voice_pool_test.dart --plain-name "モデルに無い固定ボイスを渡されてもランダムOFFで鳴らせる"` | PASS |
| TC-VR-008 | 回帰 | ランダムON | `resetRandomAssignments()` を呼んだ後に `effectiveStyleId` を取得 | 例外を投げず、モデル内の値が返る(`VoicePool`単体での契約。`SpeechQueueController.setEnabled(false)` からの呼び出し経路自体はOut of Scope参照) | `flutter test test/voice_pool_test.dart --plain-name "リセット後は同じ投稿者でもボイスが再抽選されうる"` | PASS |
| TC-VR-009 | 境界値 | モデルが空(スタイル0件) | `resetRandomAssignments()` を呼ぶ | 例外を投げず、以後の `effectiveStyleId` も `0` を返す | `flutter test test/voice_pool_test.dart --plain-name "モデルが空でもリセットは落ちない"` | PASS |

## Out of Scope

- VOICEVOXモデル自体の合成品質・音声出力の正誤(`TtsEngine`側の責務)
- `SpeechQueueController.setEnabled(false)` が `_voicePool?.resetRandomAssignments()` を実際に呼ぶことの統合検証。`SpeechQueueController` は `AudioPlayer()` をコンストラクタで生成しプラットフォームチャンネルへ触れるため、`TestWidgetsFlutterBinding.ensureInitialized()` を入れても通常の `flutter test` では `MissingPluginException` になり検証できない(2026-09-11確認)。呼び出し経路自体は1行の diff で `code-review`(DeepSeek, NO ISSUES)により確認済み。`resetRandomAssignments()` の契約(TC-VR-008/009)は `VoicePool` 単体で担保する
