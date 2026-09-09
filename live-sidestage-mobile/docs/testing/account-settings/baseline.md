---
project: live-sidestage-mobile
feature: 設定タブ アカウントセクション
last_updated: 2026-09-09
last_risk: LOW
last_reviewers: DeepSeek
---

# テストベースライン: 設定タブ アカウントセクション

設定タブ「アカウント」欄。TikTok ID・アカウントID(principalId)・ログインプロバイダを表示する。
アカウントIDはサポート問い合わせ時の本人特定キーで、タップでクリップボードへコピーできる。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-AS-001 | ログインプロバイダに応じてアカウント表示を出し分ける | `lib/screens/tabs/settings_tab.dart` | 正常 | Google/Apple/メールそれぞれでログイン | 対応するプロバイダ名とメールアドレスを表示、他プロバイダ名は出さない | `flutter test test/settings_account_label_test.dart` | PASS | |
| TC-AS-002 | principalIdがある場合、アカウントID行に値をそのまま表示しタップでコピーできる | `lib/screens/tabs/settings_tab.dart` | 正常 | `AccountStatus.principalId` に値あり | 行に値を表示、タップで `Clipboard.setData` が呼ばれ値と一致、SnackBar「コピーしました」表示 | `flutter test test/settings_principal_id_test.dart` | PASS | |
| TC-AS-003 | principalId未取得(空文字)時に生の空文字/nullを見せない | `lib/screens/tabs/settings_tab.dart` | 境界 | `AccountStatus.principalId` が `''`(fallback既定値) | 「（未取得）」を表示、`null`という文字列は出さない | `flutter test test/settings_principal_id_test.dart` | PASS | |
| TC-AS-004 | 実機でアカウントID行の表示とコピーが機能する | 設定タブ > アカウント | UI | Pixel 7a実機、既存ログイン中アカウント | アカウントID行に値(末尾省略)とコピーアイコンを表示、タップでOSクリップボードへ値がコピーされSnackBar表示 | 実機(Pixel 7a、adb screencap) | PASS | Artifact https://claude.ai/code/artifact/abb38172-29f3-4da9-b6da-127f3ac38f0d |

## Quality Gate

- `flutter analyze`
- `flutter test`

## Out of Scope

- クリップボード書き込み失敗時のエラーSnackBar分岐は、Flutter標準API(`Clipboard.setData`)がプラットフォーム例外を投げるまれなケースのみで、実機・widget testいずれでも再現手段がないため未検証(実装はtry/catchで対応済み)
