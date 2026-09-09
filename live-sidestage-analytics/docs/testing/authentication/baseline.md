---
project: live-sidestage-analytics
feature: authentication
last_updated: 2026-09-09
last_risk: HIGH
last_reviewers: DeepSeek(code-review, NO ISSUES x2 / TestCase review, 10 findings) / Codex-terra(code-review, 2 findings, 両方対応済み / TestCase review, NO ISSUES)
---

# テストベースライン: authentication

Web(NextAuth)とモバイル(独自Bearer JWT)の認証・アカウント統合まわりの保証事項。
対象は `src/lib/auth.ts`（NextAuth設定）、`src/lib/principal-prisma-adapter.ts`（自前Prisma Adapter。
Prisma model rename後、公式 `@next-auth/prisma-adapter` が `prisma.user`/`prisma.account` を
ハードコードしているため使えなくなり自前実装へ切り替えた）、`src/lib/apple-account.ts`、
`src/app/api/mobile/auth/*`。

**Prisma schema の model `User`→`Principal`、`Account`→`OAuthAccount` rename（2026-09-09）は
`@@map` で物理テーブル名を維持しており、DDL変更を伴わない。** 本ベースラインのケースは
rename前後で振る舞いが変わらないことを保証する（実装詳細の変更であって仕様変更ではない）。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-AUTH-001 | Web セッションはログイン時DB照会せずtoken.idをセットする | `authOptions.callbacks.jwt` | 正常 | サインイン直後、DBに無いid | `token.id` がそのままセットされる | `npx dotenv -e .env.local.test -- vitest run src/lib/auth.integration.test.ts` | PASS | 作成直後のレプリケーション遅延等で誤って弾かないため |
| TC-AUTH-002 | Principal が実在する間はセッションが有効 | `authOptions.callbacks.jwt` | 正常 | 既存Principalのid | `token` がそのまま返る | 同上 | PASS | |
| TC-AUTH-003 | Principal削除後はWebセッションが即時失効する | `authOptions.callbacks.jwt` | 異常/回帰 | Principal作成→削除、そのidでjwt呼び出し | `null` を返す | 同上 | PASS | モバイルのアカウント削除後もWebセッションが生き残らないための防御 |
| TC-AUTH-101 | Apple が先でも後続の同一メールGoogleログインに吸収されない | `resolveAppleUser` / `POST /api/mobile/auth/google` | 正常/セキュリティ | Apple登録→同じメールでGoogleログイン | 別Principalになる。AppleのPrincipalにGoogleのOAuthAccountが増えない | `npx dotenv -e .env.local.test -- vitest run src/app/api/mobile/auth/provider-separation.integration.test.ts` | PASS | Google側がemail一致で無条件リンクするため、分離はApple側でなくGoogle側の制限で担保 |
| TC-AUTH-102 | Google が先でも後続の同一メールAppleログインに吸収されない | 同上 | 正常/セキュリティ | Googleログイン→同じメールでApple登録 | 別Principalになる | 同上 | PASS | |
| TC-AUTH-103 | Google同士は従来どおり同一Principalに収束する | 同上 | 正常/回帰 | 同一メールでGoogleログイン2回 | 同じPrincipal.id | 同上 | PASS | 分離実装が正規のGoogle再ログインまで壊していないこと |
| TC-AUTH-104 | Web(PrincipalPrismaAdapter)とMobile(google route)が同じGoogleアカウントで同一Principalへ収束する | `PrincipalPrismaAdapter` / mobile google route | 正常/回帰 | Web経由createUser+linkAccount → Mobile経由同一sub | 同一Principal.idに収束 | `npx dotenv -e .env.local.test -- vitest run src/app/api/mobile/auth/web-mobile-convergence.integration.test.ts` | PASS | Web側は実際にPrincipalPrismaAdapterのcreateUser/linkAccount/getUserByAccountを直接呼んで検証。公式PrismaAdapterではなく自前Adapterで検証していることが重要（rename後は公式Adapterはmodel名不一致で動作しない）。getUserByEmailはTC-AUTH-105/106（emailLinkRestrictedAdapter経由）でカバー。getUser/updateUser/deleteUser/unlinkAccountはこのアプリのコードパスから呼ばれない（未使用メソッド） |
| TC-AUTH-105 | Accountを持たない旧Principal（メール/パスワード登録由来）へはメール一致でリンクする | メール一致リンク制限 | 正常/移行 | OAuthAccount 0件の旧Principal + 同じメールでGoogleログイン | 既存Principalへリンクされる | `npx dotenv -e .env.local.test -- vitest run src/app/api/mobile/auth/google/email-link-restriction.integration.test.ts` | PASS | 5a3e97a以前の旧ユーザー移行経路 |
| TC-AUTH-106 | Accountを持つ現役Principalへはメール一致でリンクしない | メール一致リンク制限 | 異常/セキュリティ | OAuthAccountを持つPrincipal + 同じメールで別プロバイダログイン | 409または新規Principal（乗っ取り防止） | 同上 | PASS | 後から同じメールを入手した第三者による乗っ取り防止 |

## Out of Scope

- Prisma物理テーブル名の変更（`@@map`で`"User"`/`"Account"`のまま維持するため対象外）
- NextAuthの `session`/`verificationToken` 関連ロジック（model名変更なし、公式Adapter実装のロジックをそのまま流用）
- 今回のrenameで`prisma.user.*`/`prisma.account.*`を機械置換した認証以外の機能（billing / analytics / listener / ambassador / streamer / verify / seedスクリプト等、60ファイル超）。
  これらは仕様変更を伴わない機械的なdelegate名変更のみで、個別のテストケースはこのbaselineに追加しない
  （各機能の既存baseline・既存自動テストのQuality Gate（`npx dotenv -e .env.local.test -- vitest run`全体、2026-09-09時点205ファイル2395件PASS）で担保する）。
  この全体実行で実際に`src/lib/plan/sync-subscription.test.ts`の`vi.mock("@/lib/prisma")`内`user:`キー残存（rename漏れ）を検出・修正した
