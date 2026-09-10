---
project: live-sidestage-analytics
feature: onboarding
last_updated: 2026-09-11
last_risk: HIGH
last_reviewers: Codex-terra+DeepSeek(code-review) / DeepSeek(TestCase review)
---

# テストベースライン: onboarding

TikTokハンドル未登録の配信者を`/analytics`から遮断し、専用の初回登録画面`/onboarding`へ誘導する仕組み。既存の設定画面`/setup`はプラン・アカウントID確認込みで登録済みユーザー向けに残り、TikTokハンドル登録フォーム自体は`TiktokHandleSetupForm`として両画面が共有する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-OB-001 | 未ログインで`/analytics`直下にアクセスできない | `src/app/(dashboard)/analytics/layout.tsx` | 異常 | セッション無し | `/login`へredirect | `npx vitest run src/app/(dashboard)/analytics/layout.test.ts` | PASS | |
| TC-OB-002 | Streamer未登録ユーザーは`/analytics`へ入れない | `src/app/(dashboard)/analytics/layout.tsx` | 正常(ガード) | ログイン済み・Streamer無し | `/onboarding`へredirect | `npx vitest run src/app/(dashboard)/analytics/layout.test.ts` + curl実ブラウザ相当確認(dev-login) | PASS | |
| TC-OB-003 | Streamer登録済みなら`/analytics`を表示する | `src/app/(dashboard)/analytics/layout.tsx` | 回帰 | ログイン済み・Streamer有り | redirectせず子要素を描画 | `npx vitest run src/app/(dashboard)/analytics/layout.test.ts` + curl実ブラウザ相当確認 | PASS | |
| TC-OB-004 | 未ログインで`/onboarding`にアクセスできない | `src/app/onboarding/page.tsx` | 異常 | セッション無し | `/login`へredirect | `npx vitest run src/app/onboarding/page.test.ts` | PASS | |
| TC-OB-005 | 登録済みユーザーが`/onboarding`を開くと`/analytics`へ送られる | `src/app/onboarding/page.tsx` | negative | ログイン済み・Streamer有り | `/analytics`へredirect(フォームを再表示しない) | `npx vitest run src/app/onboarding/page.test.ts` + curl実ブラウザ相当確認 | PASS | |
| TC-OB-006 | 未登録ユーザーには`/onboarding`のフォームのみ表示する | `src/app/onboarding/OnboardingScreen.tsx` | UI | ログイン済み・Streamer無し | プラン・アカウントIDカードは表示されず、TikTokハンドル入力フォームとログアウト導線のみ表示 | Playwright実ブラウザ確認 | PASS | screenshot提示済 |
| TC-OB-007 | ルート`/`は未登録ユーザーを`/onboarding`へ送る | `src/app/page.tsx` | 正常 | ログイン済み・Streamer無し | `/onboarding`へredirect | curl実ブラウザ相当確認(dev-login) | PASS | |
| TC-OB-008 | ルート`/`は登録済みユーザーを`/analytics`へ送る | `src/app/page.tsx` | 回帰 | ログイン済み・Streamer有り | `/analytics`へredirect | curl実ブラウザ相当確認 | PASS | |
| TC-OB-009 | TikTokハンドル登録完了後は自動で`/analytics`へ遷移する | `src/components/TiktokHandleSetupForm.tsx` | 正常 | `/onboarding`でTikTok ID入力→確認モーダルで確定 | Streamerが作成され、約1.5秒後に`/analytics`へ遷移する | Playwright実ブラウザ確認 + API呼び出し確認(`/api/verify/preview`→`/api/verify/generate`) | PASS | |
| TC-OB-010 | 登録済みユーザーの`/setup`は従来通りプラン・アカウントIDカードを表示する | `src/app/(dashboard)/setup/page.tsx` | 回帰 | ログイン済み・Streamer有り | プランカード・アカウントIDカードが表示され、TikTokハンドル欄は登録済み状態(`already_verified`)で表示 | Playwright実ブラウザ確認 | PASS | screenshot提示済 |
| TC-OB-011 | `/setup`から`/analytics`へのclient-side遷移でも未登録ガードが効く | `src/app/(dashboard)/analytics/layout.tsx` | 回帰 | Streamer無しユーザーが`/setup`表示中に`DashboardHeader`のロゴ(client-side Link)経由で`/analytics`へ遷移 | 遷移後も`AnalyticsLayout`のサーバー実行により`/onboarding`へredirectされる(親layoutの再実行に依存しない) | RSCナビゲーション模擬(`Next-Router-State-Tree`ヘッダー付きcurl、遷移元を`/setup`として明示) | PASS | `NEXT_REDIRECT;replace;/onboarding;307`を確認 |
| TC-OB-012 | `/onboarding`のログアウト導線が機能する | `src/app/onboarding/OnboardingScreen.tsx` | UI | `/onboarding`表示中 | 「ログアウト」ボタン押下で`/login`へ遷移しセッションが破棄される | Playwright実ブラウザ確認 | PASS | |

## Quality Gate

- `npm run typecheck`
- `npx dotenv -e .env.local.test -- vitest run --exclude "**/*.integration.test.ts"`

## Out of Scope

- 管理者(`isAdminEmail`)がStreamer未登録の場合に`/setup`(現`/onboarding`)へ送られ`/admin`へ振り分けられない点(既存挙動、今回のスコープ外)
- `prisma.streamer.findUnique`失敗時のtry/catch(既存コードベース全体のパターンを踏襲、今回だけ特別扱いしない)
