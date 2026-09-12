---
project: live-sidestage-mobile
feature: onboarding
last_updated: 2026-09-12
last_risk: HIGH
last_reviewers: DeepSeek(TestCase,402)→Gemini(agy)
---

# テストベースライン: モバイル ログイン後オンボーディング

ログイン済みかつ Streamer 未登録（`onboardingRequired`）のとき、紹介スライド（スキップ可）と TikTok ID 連携（必須・確認シート経由）を出す。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-MOB-001 | 未登録セッションは紹介1枚目から始まる | `OnboardingScreen` | UI | `onboardingRequired: true` | 「画面を見ずに、声で聞く」と「スキップ」「次へ」が出る。入力欄は出ない | `flutter test test/onboarding_screen_test.dart` | PASS | |
| TC-MOB-002 | スキップで連携ページへ | `OnboardingScreen` | UI | 紹介表示中にスキップ | 「TikTokアカウントの連携」「確認する」。スキップは消える | 同上 | PASS | |
| TC-MOB-003 | 次へで5枚進んで連携へ | `OnboardingScreen` | UI | 次へを5回 | ギフト→画面オフ→貢献/ギフト→バトル→連携ページ | 同上 | PASS | |
| TC-MOB-004 | 空IDはシートを出さない | `OnboardingScreen` | 異常 | 連携ページで空のまま確認する | インライン「TikTok IDを入力してください」。確認シートなし | 同上 | PASS | |
| TC-MOB-005 | overflowからアカウント削除確認 | `OnboardingScreen` | UI | その他→アカウント削除 | 削除確認ダイアログ。キャンセルでセッション残る | `flutter test test/account_deletion_dialog_test.dart` | PASS | |
| TC-MOB-006 | preview 未認証は401 | `live-sidestage-analytics/POST /api/mobile/streamer/preview` | 異常 | Bearerなし | 401、TikTok照会しない | `npx vitest run src/app/api/mobile/streamer/preview/route.test.ts` | PASS | |
| TC-MOB-007 | preview 空ハンドルは400 | 同上 | 異常 | `tiktokHandle: " "` | 400、照会しない | 同上 | PASS | |
| TC-MOB-008 | preview 不在は400 USER_NOT_FOUND | 同上 | 異常 | mock USER_NOT_FOUND | 400 + code | 同上 | PASS | |
| TC-MOB-009 | preview 照会不能は503 | 同上 | 異常 | mock CHECK_UNVERIFIED | 503 + code | 同上 | PASS | |
| TC-MOB-010 | preview 成功キーは Web と同じ | 同上 | 正常 | mock EXISTS | tiktokHandle/nickname/avatarUrl/signature/followingCount/followerCount | 同上 | PASS | |
| TC-MOB-011 | 実機で紹介1枚目とスキップ後の連携ページが見える | `OnboardingScreen` | UI | 未登録セッションでアプリ起動 | 1枚目に見出し「画面を見ずに、声で聞く」と「次へ」。スキップ後に「TikTokアカウントの連携」「確認する」 | Marionette MCP または Pixel 7a `adb` | NOT RUN: Pixel 7a接続済みだが本番セッションは Streamer 登録済み（Home TTS）。オンボーディング到達にはデータ消去が要る | |
| TC-MOB-012 | 採用compと実装の視覚照合 | `.impeccable/approved/onboarding-kosai/` | UI | ライトテーマ・紹介1枚目と連携ページ | spec.md の余白・タイポ・CTA pill・ドットが MAJOR 差なく一致。要素インベントリ欠落なし | visual-qa Compare Mode（実機スクショ vs `comp.png`） | NOT RUN: 実装オンボーディング画面の実機スクショ無し（TC-MOB-011 と同因） | |
| TC-MOB-013 | preview成功で確認シート→登録 | `OnboardingScreen` | 正常 | 連携ページで有効ハンドル→確認する→このアカウントで連携する | シートに `@tiktokHandle` と nickname。確定で `registerStreamer` が1回 | `flutter test test/onboarding_screen_test.dart` | PASS | |
| TC-MOB-014 | preview失敗はシートなし | `OnboardingScreen` | 異常 | preview が `ApiException`(USER_NOT_FOUND) | 「このアカウントで連携する」なし。エラー文言が連携ページに出る | 同上 | PASS | |
| TC-MOB-015 | overflowログアウトでセッション消去 | `OnboardingScreen` | UI | その他→ログアウト→確認ダイアログでログアウト | `logoutSession` が呼ばれ `session` が null | 同上 | PASS | SharedPreferences mock 必須 |
| TC-MOB-016 | 既登録 principal の preview は409 | `POST /api/mobile/streamer/preview` | 異常 | Streamer 付き principal の JWT | 409「既にTikTokアカウントが登録されています」、TikTok照会0 | `npx vitest run src/app/api/mobile/streamer/preview/route.test.ts` | PASS | |
| TC-MOB-017 | preview の principal レート制限 | 同上 | 異常 | `isRateLimited` が true | 429、TikTok照会0 | 同上 | PASS | in-memory。分散保証なし |
| TC-MOB-018 | 確定登録失敗はシート維持 | `OnboardingScreen` | 異常 | preview成功後 `registerStreamer` が ApiException | シート残る。エラー表示。`onboardingRequired` 維持 | `flutter test test/onboarding_screen_test.dart` | PASS | |

## Quality Gate

- `flutter analyze`（live-sidestage-mobile）: PASS
- `flutter test test/onboarding_screen_test.dart test/account_deletion_dialog_test.dart`: PASS
- analytics: `npx vitest run src/app/api/mobile/streamer/preview/route.test.ts`（worktree の route.test.ts）

## Out of Scope

- preview→登録の実TikTok照会（モック）
- VOICEVOX規約（ホーム初回のまま）
- `POST /api/mobile/streamer` の 409 冪等化（既存 POST。今回の preview 範囲外）
