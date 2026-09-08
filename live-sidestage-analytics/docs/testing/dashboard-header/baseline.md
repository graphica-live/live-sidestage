---
project: live-sidestage-analytics
feature: dashboard-header
last_updated: 2026-09-05
last_risk: LOW
last_reviewers: Qwen (Code Mode / TestCase Mode)
---

# テストケース設定表: dashboard-header

`/analytics` 等のダッシュボード共通ヘッダー(`src/app/(dashboard)/DashboardHeader.tsx`)。ログイン中アカウントのメールアドレス表示と、既存要素(リスナー状態・設定リンク・ログアウト)の共存を保証する。

採用サンプル: `.impeccable/approved/dashboard-header-email/spec.md`

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-DH-001 | ログイン中アカウントのメールアドレスがヘッダーに出る | `DashboardHeader` | 正常 | `npm run dev:local` 起動、`/login` の開発用ログイン(`dev@local.test`)後に `/analytics` を開く | ヘッダー内(リスナー状態と設定リンクの間)に `dev@local.test` がテキスト表示される | Playwright, 1280x800 | PASS | |
| TC-DH-002 | 長いメールアドレスでもヘッダーが崩れず省略表示になる | `DashboardHeader` | 境界 | テストユーザーの email を `dev.very.long.streamer.account@local-sidestage-test.example.com` に変更して再ログイン | max-width(モバイル100px / sm以上160px)を超えた分が `text-overflow: ellipsis` で省略記号(…)になり、`title` 属性の hover で全文が読める。ロゴ・設定・ログアウトのレイアウトは崩れない | Playwright, 1280x800 | PASS | |
| TC-DH-003 | モバイル幅でもメール表示が他要素と重ならない | `DashboardHeader` | 境界(レスポンシブ) | 375x812、TC-DH-002 と同じ長いメール | メールが truncate 表示され、他要素と重ならない・はみ出さない | Playwright, 375x812 | PASS | |
| TC-DH-004 | 既存のリスナー状態・設定リンク・ログアウトが従来どおり動く | `DashboardHeader` | 回帰 | TC-DH-001 と同じ状態 | リスナー状態ドット・「設定」リンク・「ログアウト」ボタンが表示され、従来どおり操作できる | Playwright, 1280x800 / 375x812 | PASS | |
| TC-DH-005 | `session.user.email` が nullish のときは span ごと出さない | `DashboardHeader` | 異常 | Apple 経由サインアップ等で `User.email` が null の session | メール表示の span がレンダリングされず、他要素のレイアウトに影響しない | コードレビュー(`{email && (...)}` のガード確認) | NOT RUN: React コンポーネント単体テスト基盤(@testing-library/react 等)が本プロジェクトに無く、dev-login は email 必須で null session を作れない。Apple 認証もローカルでモックできず実ブラウザ再現不可。既存の同型パターン(`{listener && (...)}`)と同一の conditional rendering であることをコードで確認済み | Qwen TestCase Mode の coverage gap 指摘。基盤導入が要るため見送り |

## Out of Scope

- メールアドレスの XSS: React JSX の `{email}` はテキストノードとして自動エスケープされ、`dangerouslySetInnerHTML` は未使用。`title` 属性も文字列として DOM 属性設定されるだけで HTML 解釈されない
