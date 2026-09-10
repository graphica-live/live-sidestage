---
date: 2026-09-11
feature: authentication
---

# overlays専用ログイン画面の新設

## change summary

`/overlays`（配信者本人のOBSオーバーレイ設定画面）が未ログイン時にanalyticsブランドの`/login`へ
落ちていたのを、`/overlays/login`という専用ログイン画面へ分離した。認証処理・セッションcookie
（`next-auth.session-token`）・Principalは既存のまま一切変更していない。

## reason（設計判断の経緯）

当初はagencyと同様の「完全独立NextAuthインスタンス・別cookie（ただし新規Principal種別は作らない）」
という要件で設計し、design-review 2巡（Codex-sol+Gemini+DeepSeek → DeepSeek+Gemini+Opus）まで進めた。
その過程で「overlay設定は配信者本人の既存Principalを使うだけで、agencyのような別Principal種別では
ない」という点が明確になり、それにもかかわらず完全独立方式を選んだために、連携チケット機構・
アカウント紐付けの4象限分岐など要件の性質に見合わない複雑さとCRITICAL級設計欠陥（OAuthコールバック
URL固定、signInコールバックでcookieが読めない等）を生んでいた。

ユーザーからの「標準解で設計しなおして」という明示指示を受け、リポジトリに既に存在する**同一
Principal・同一セッションcookieのまま、ログイン画面だけ分離する`/event`パターン**を踏襲する設計へ
全面転換した。新規adapter・新規cookie・連携チケットはすべて廃止し、既存`authOptions`をそのまま使う。

## risk

MEDIUM（design-review: DeepSeek+Gemini+Codex-luna、CRITICAL/HIGH無し）

## affected baseline cases

TC-AUTH-114〜118（新規）

## reviewers / important findings

- Gemini: NO ISSUES
- DeepSeek: MEDIUM 1件（`OVERLAY_PREFIXES`に自身のAPI pathを含めるべき。提案パス名`/api/overlays`は
  実在しないため、実コード照合の上`/api/streamer/overlay-settings`・`/api/streamer/overlay-timer`に
  修正して採用）
- Codex-luna: MEDIUM 2件+LOW 1件（`OverlaysHeader.tsx`のsignOut callbackUrl漏れ、`callback-url.ts`の
  LOGIN_PATHS漏れ、login page cookie分岐のテスト不足）。いずれも実コード照合済みでVALID、反映済み

旧設計（完全独立方式）へのCodex-sol+Gemini+DeepSeek / DeepSeek+Gemini+Opusレビューは方針転換前の
別設計に対するものであり、この変更には適用されない。

## verification

実ブラウザ（Playwright, dev:local + devログイン）で確認:
- 未ログイン`/overlays`アクセス → `/overlays/login`へ307（analyticsの`/login`に落ちないこと）
- ログイン後 `/overlays`本体へ到達（既存Principalのまま、新規Account作成なし）
- 再アクセスで再ログイン不要（同一セッションcookieの確認）
- ヘッダーの「ログアウト」→`/overlays/login`へ遷移
- 既存の`/login`・`/event/login`のリダイレクトは回帰なし

自動テスト55件PASS（`login-path.test.ts` / `middleware.test.ts` / `callback-url.test.ts` /
`(auth)/login/page.test.tsx`）、typecheck通過。

## remaining risks

なし。DBスキーマ変更・新規認証ロジック・OAuthプロバイダ設定変更は一切発生していない。
