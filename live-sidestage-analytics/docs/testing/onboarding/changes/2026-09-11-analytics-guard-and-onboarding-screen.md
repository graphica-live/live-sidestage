---
date: 2026-09-11
feature: onboarding
risk: HIGH
reviewers: Codex-terra+DeepSeek(design-review 1回目) / DeepSeek(design-review 2回目) / Codex-terra+DeepSeek(code-review) / DeepSeek(TestCase review)
---

# /analytics未登録ガードの新設と/onboarding画面の分離

- change summary: Web新規登録(Google/Apple/dev-login)した配信者がTikTokハンドル未登録のまま`/analytics`へ直接アクセスできる不具合を修正。`/analytics`セグメント専用の`layout.tsx`でStreamer存在チェックを行い、未登録なら新設した`/onboarding`(TikTokハンドル登録フォーム専用画面)へ誘導する。既存`/setup`(プラン・アカウントIDカード同居)はそのまま残し、フォーム部分を`TiktokHandleSetupForm`として共有。
- reason: 唯一のガードだったルート`/`の`redirect`は`callbackUrl`や`/analytics`への直接遷移でバイパスされていた。加えてユーザーから「`/setup`は他の項目と同居していて初回ユーザーが分かりにくい」との指摘があり、UI設計をui-design/impeccable shape工程で見直した。
- affected baseline cases: TC-OB-001〜TC-OB-012(新規)
- important findings / VALID・INVALID の重要判断:
  - design-review 1回目(Codex): 当初案(`(dashboard)/layout.tsx` + middlewareの`x-pathname`ヘッダー判定)は`DashboardHeader.tsx`のロゴが常時`/analytics`へのclient-side Linkを持ち、App Routerの親layoutがセグメント間遷移で必ずしも再実行されないためバイパス可能とVALID判定。方式を「`/analytics`専用layoutで囲う」へ全面変更した。
  - design-review 2回目(DeepSeek、UI設計変更分): `/onboarding`にStreamer既登録チェックが無い、テスト未定義、をVALID判定し追加。client-side遷移でのガード実行検証不足をHIGH判定(設計原理上は問題ないと判断したが実ブラウザでの裏取りを検証項目に追加)。
  - code-review(Codex・DeepSeek): 両者ともuntrackedな新規ファイルが最初の`--files`指定漏れで見えておらず、「差分にガード本体が含まれない」という指摘(実際はcommit前のworking tree状態の指摘であり、コード上の欠陥ではない)。再実行で正しくファイルを渡し、追加のVALID指摘なし。
  - TestCase review(DeepSeek): baseline.mdに対しNO ISSUES(ファイルごとの確認一覧付き、bare判定でないことを確認)。
- verification: Next.js App RouterのRSCナビゲーションを`Next-Router-State-Tree`ヘッダー付きcurlで模擬し、`/setup`から`/analytics`へのclient-side遷移でも`AnalyticsLayout`が実行され`NEXT_REDIRECT;replace;/onboarding;307`が返ることを確認(design-review 2回目のHIGH指摘への裏取り)。実登録フローはNextAuthのdev-loginプロバイダ(ローカルテスト専用)+実TikTok APIへの`/api/verify/preview`・`/api/verify/generate`呼び出しで検証。
- remaining risks: 管理者(`isAdminEmail`)がStreamer未登録の場合に`/onboarding`(旧`/setup`)へ送られ`/admin`への振り分けがされない既存挙動は未対応(スコープ外、実害は小さいと判断)。
- rollback / migration note: 新規ファイルの追加のみでスキーマ変更なし。ロールバックは対象ファイルの削除と`src/app/page.tsx`の`redirect`先を`/setup`へ戻すだけで完結する。
