---
project: live-sidestage-mobile
feature: typography
last_updated: 2026-09-13
last_risk: LOW
last_reviewers: Gemini 3.7 Flash
---

# Typography

App-wide type is a single M PLUS 2 family. Titles ExtraBold 800, body Regular 400, data Bold 700. Kosai color, radius, and spacing stay.

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
|---|---|---|---|---|---|---|---|---|
| TC-TY-001 | 見出しと本文が同じ M PLUS 2 | `buildAppTheme` | 正常 | light/dark | titleLarge と bodyMedium の fontFamily が M PLUS 2 | `flutter test test/widget_test.dart --plain-name "buildAppTheme uses M PLUS 2 with tabular figures"` | PASS | |
| TC-TY-002 | 見出しは ExtraBold | `buildAppTheme` | 正常 | light/dark | titleLarge の weight は 800 | 同上 | PASS | |
| TC-TY-003 | ウェルカムの大型見出しが残る | WelcomeScreen | 回帰 | 未ログイン | 「LIVE Sidestage」と Google ログインが出る | `flutter test test/widget_test.dart --plain-name "起動直後はウェルカム画面が表示される"` | NOT RUN: 本変更前から main checkout でも同テストが 0 widget で落ちる（既存） | One Title Rule |
| TC-TY-004 | ナビラベルに見出し ExtraBold を載せない | NavigationBar | negative | ホーム6タブ | NavigationBar は titleLarge 800 を指定しない | `lib/screens/home_screen.dart` の NavigationBar に titleLarge 上書きが無いことを確認 | PASS | ソース確認 |
| TC-TY-005 | 光彩の行構造を崩さない | 貢献タブ | UI | 書体だけ変更 | 行は順位・アバター・名前・コインの4情報、角丸18 | 実機スクショと `typography-mplus2/comp.png` | NOT RUN: adb 未接続 | |
| TC-TY-006 | body/label に tabularFigures | `buildAppTheme` | 正常 | light/dark | bodyLarge/Medium/Small と labelLarge/Medium/Small の fontFeatures に tabularFigures | `flutter test test/widget_test.dart --plain-name "buildAppTheme uses M PLUS 2 with tabular figures"` | PASS | TestCase finding |

## Out of Scope

- フォントのアセット同梱（google_fonts ネット取得を維持）
- ダーク本文を 500 に上げる細さ補正
