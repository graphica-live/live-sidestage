---
project: live-sidestage-analytics
feature: analytics-theme
last_updated: 2026-09-13
last_risk: MEDIUM
last_reviewers: code-review Gemini 3.7 Flash 2026-09-13
---

# 画面種別固定テーマ (Auth ライト / Dashboard・Share ダーク)

| ID | 目的 | 対象 | 観点 | 前提 | 期待結果 | 実行方法 | 結果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-AT-001 | 認証は OS ダークでもライト | `/login` | UI/negative | Playwright `colorScheme: dark` | `body.analytics-theme-light`、背景輝度 >200 | `node ~/.cursor/cache/ui-shots/theme-verify-strict.cjs` | PASS(2026-09-13) |
| TC-AT-002 | Dashboard は常時ダーク | `/analytics` | UI | dev-login 済み | `body.analytics-theme-dark`、背景輝度 <80 | 同上 | PASS(2026-09-13) |
| TC-AT-003 | Share /c は常時ダーク | `/c/{token}` | UI | 匿名 | 同上 | 同上 | PASS(2026-09-13) |
| TC-AT-004 | OS ライトでも Dashboard ダーク | `/analytics` | UI/negative | `colorScheme: light` + dev-login | 背景輝度 <80（OS に非依存） | 同上 | PASS(2026-09-13) |

## 検証メモ

- `theme-verify-strict.cjs` は輝度判定で不合格なら exit 2。スクリーンショット撮影前に必ず実行。
- 検証は `NEXTAUTH_URL` と PORT が一致した dev（例: `http://localhost:3000`）で行う。CSS 未適用（stylesheet 0）のまま撮影しない。
