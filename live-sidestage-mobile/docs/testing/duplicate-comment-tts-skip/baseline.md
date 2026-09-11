---
project: live-sidestage-mobile
feature: duplicate-comment-tts-skip
last_updated: 2026-09-11
last_risk: LOW
last_reviewers: DeepSeek
---

# テストベースライン: duplicate-comment-tts-skip

直近10分以内に同一内容（`Comment.speechText`、streamerId単位、投稿者は問わない）のコメントが2回投稿されたら、
2回目の投稿時点を起点にその後10分間、同一内容のコメントの読み上げを抑制する。設定タブの「定型文の読み上げを制限」
トグルでON/OFFできる（デフォルトON）。判定・抑制はクライアント（`SpeechQueueController`）側のみで完結し、
サーバー・DBには一切触れない。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-DC-001 | 1回目の投稿は抑制されない | `DuplicateCommentFilter.shouldSuppress` | 正常 | 同一streamerId・同一speechTextの初回投稿 | `false`（読み上げる） | `flutter test test/duplicate_comment_filter_test.dart` | PASS | |
| TC-DC-002 | 2回目の投稿(10分以内)自体は読み上げ、以後を抑制開始 | 同上 | 正常 | 1回目から5分後に同一内容が再投稿 | 2回目自体は`false`。直後の3回目は`true` | 同上 | PASS | |
| TC-DC-003 | 抑制期間の境界(2回目投稿から10分) | 同上 | 境界 | 2回目投稿から9分後/14分59秒後/15分ちょうど後に投稿 | 9分後・14分59秒後は`true`(抑制中)、15分ちょうどは`false`(解除) | 同上 | PASS | 実装は同時刻を期限切れ扱い(境界は「以上」で解除) |
| TC-DC-004 | 抑制解除後は新サイクルとして扱われる | 同上 | 回帰 | 抑制解除後に単発投稿→5分後にもう一度投稿 | 単発1回目・2回目ともに`false`。その直後の3回目のみ`true`（2回揃わないと抑制が再発火しない） | 同上 | PASS | |
| TC-DC-005 | 内容が1文字でも違えば別キー扱い | 同上 | 異常 | `hello`と`helloa`を同時刻に投稿 | 互いに独立してカウントされ、一方の抑制がもう一方に影響しない | 同上 | PASS | |
| TC-DC-006 | streamerIdが異なれば独立に扱われる | 同上 | 異常 | 同一speechTextを異なるstreamerIdで投稿 | 互いに独立してカウントされる | 同上 | PASS | |
| TC-DC-007 | detectionWindow(10分)超過は2回目とみなさない | 同上 | 境界 | 1回目から15分後に同一内容を再投稿 | 新規1回目扱いで`false` | 同上 | PASS | |
| TC-DC-008 | メモリリーク対策(内部Mapの掃除) | 同上 | negative | 古いエントリ投稿後、時間を空けて別コメントで`shouldSuppress`を呼ぶ | 期限切れの古いエントリは内部Mapから削除され、同一内容を再投稿すると新規1回目扱いになる | 同上 | PASS | |
| TC-DC-009 | duplicateSkipEnabled=trueで同一内容連投時、キューに積まれるのは重複判定を通った分だけ | `SpeechQueueController._enqueue` | 正常 | `duplicateSkipEnabled=true`で同一内容を3連投 | 1,2件目はキューに積まれ、3件目(抑制対象)は積まれない(`debugQueueLength`で確認) | `flutter test test/speech_queue_duplicate_test.dart` | PASS | `debugEnqueue`/`debugQueueLength`/`debugSkipProcessing`はテスト専用の`@visibleForTesting`アクセサ |
| TC-DC-009b | duplicateSkipEnabled=falseなら抑制されない | 同上 | 正常 | `duplicateSkipEnabled=false`で同一内容を3連投 | 3件ともキューに積まれる | 同上 | PASS | |
| TC-DC-010 | 判定順序: 空コメント早期return→重複判定→FREEプランクールダウンの順を維持 | `SpeechQueueController._enqueue` | 回帰 | (a)speechTextが空のコメントを投稿 (b)FREEプランクールダウン中に非重複コメントを投稿 | (a)キューに積まれない (b)キューに積まれない(重複判定を通ってもクールダウンで止まる) | 同上 | PASS | |
| TC-DC-011 | 設定の永続化・背景Isolateへの同期 | `AppConfig` / `AppConfigStore` / `background_task_handler._applyEffectiveConfig` | 正常 | `setDuplicateSpeechSkipEnabled(false)`を呼ぶ | revisionが進み、JSON往復後も値が保持される。旧バージョンJSON(キー無し)は`true`にフォールバックする | `flutter test test/app_config_test.dart` / `flutter test test/app_config_store_test.dart` | PASS | schemaVersionは上げない方針を踏襲。`_applyEffectiveConfig`自体(背景Isolateへの1行の代入)は既存のrandomVoice等の同種フィールドと同じくテスト対象外(`CommentSpeechTaskHandler`はForeground Task Handlerで単体テスト不可能な構造。既存アーキテクチャの制約であり今回の変更固有ではない) |
| TC-DC-012 | 設定画面にトグルが表示され、既定でON | `lib/screens/tabs/settings_tab.dart` | UI | 設定タブの「読み上げ」セクション | 「定型文の読み上げを制限」の行が表示され、Switchの初期値がON(`store.config.duplicateSpeechSkipEnabled`と一致) | `flutter test test/settings_voice_test.dart` | PASS | |
| TC-DC-012b | トグルをタップするとstoreへ反映される | 同上 | UI | 上記画面でSwitchをタップ | `store.config.duplicateSpeechSkipEnabled`がfalseになり、Switchの表示もOFFになる | 同上 | PASS | |
| TC-DC-013 | 実機での見た目確認 | `lib/screens/tabs/settings_tab.dart` | UI | 設定タブの「読み上げ」セクション | 「定型文の読み上げを制限」の行が既存の`_SettingSwitchRow`と同じスタイルで表示される | 実機(Pixel 7a) | 下記参照 | スクリーンショットをArtifactで提示 |

## Quality Gate

- `flutter analyze`
- `flutter test`（全549件）

## Out of Scope

- サーバー側（live-sidestage-analytics）の変更は無し。コメント配信自体の仕様変更は対象外
- FREEプランの間引き機構（`_isFreePlan`/`_intervalActive`）自体の仕様変更は対象外（既存動作の維持のみ確認）
- ギフト読み上げ・効果音（`SoundEngine`）は対象外
