---
project: live-sidestage-analytics
feature: /setup ページ アカウントID表示
last_updated: 2026-09-09
last_risk: LOW
last_reviewers: DeepSeek
---

# テストベースライン: /setup ページ アカウントID表示

`/setup` ページの「現在のプラン」カード内に principalId(サポート問い合わせ時の本人特定キー)を
「アカウントID」として表示する。`/api/auth/session` から取得し、コピーボタンでクリップボードへコピーできる。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SA-001 | ログイン中ユーザーのprincipalIdを取得し表示する | `src/app/(dashboard)/setup/page.tsx` | 正常 | ログイン済みセッション(dev-login) | 「アカウントID」欄に `session.user.id` と同じ値をmonospaceで表示 | Playwright(dev-login→`/setup`)、実行スクリプトはスクラッチ領域 | PASS | Artifact参照 |
| TC-SA-002 | コピーボタンでクリップボードへ値が入り、ラベルが一時的に変わる | `src/app/(dashboard)/setup/page.tsx` | 正常 | principalId取得済み状態でコピーボタンをクリック | `navigator.clipboard.writeText` が呼ばれクリップボードの内容がprincipalIdと一致、ボタン表示が「コピーしました」に変わる | Playwright(`clipboard-read`/`clipboard-write`権限を付与しevaluateで読み出し) | PASS | |
| TC-SA-003 | principalId取得前は空文字を出さず「…」を表示する | `src/app/(dashboard)/setup/page.tsx` | 境界 | `/api/auth/session` のfetch完了前 | 「…」を表示、コピーボタンはdisabled | コードレビュー(初期state確認)。実行時間が短く自動化未実施 | NOT RUN: 初期stateがfetch完了までの一瞬のみで、Playwrightでは再現に人為的な遅延注入が必要なため未実施 | |
| TC-SA-004 | PC幅・スマートフォン幅どちらでも表示が崩れない | `src/app/(dashboard)/setup/page.tsx` | UI | 幅1280px(PC)、幅480px(スマートフォン) | どちらの幅でもアカウントID・コピーボタンが横スクロールなしで表示される | Playwright(viewport切替) | PASS | Artifact参照 |

## Quality Gate

- `npx tsc --noEmit`(このリポジトリの `npm run typecheck` 相当。worktreeでは `node_modules`/Prisma Client未生成のため直接呼び出し)

## Out of Scope

- `/api/billing/subscription` 等の既存API・プラン表示ロジックは本変更で触っていないため対象外
