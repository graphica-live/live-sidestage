---
date: 2026-09-09
feature: authentication
risk: HIGH
---

# Prisma model rename（User→Principal, Account→OAuthAccount）

## change summary

Prisma schema の model名を `User`→`Principal`、`Account`→`OAuthAccount` へrename。
両方 `@@map` で物理テーブル名（`"User"` / `"Account"`）を維持し、DDL変更を伴わない。
`@next-auth/prisma-adapter` が `p.user.*` / `p.account.*` を直書きしているため使用不能になり、
自前実装 `src/lib/principal-prisma-adapter.ts`（delegate名8箇所のみ差し替え）へフォークした。
本番コード13ファイル・テストコード55ファイルで `prisma.user.*` 等を機械的に置換。

## reason

本番は `prisma db push --accept-data-loss` 運用のため、物理テーブル名の変更はデータ損失リスクを
伴う。Prisma model名（アプリコード上の識別子）とDB物理名を分離することで、リスクを負わずに
コード上の命名改善（`User`という汎用的すぎる名前をやめ、認証・課金・所有の主体を指す
`Principal`へ）を達成した。`Account`→`OAuthAccount`も同様の理由（OAuth連携専用であることの明示）。

## affected baseline cases

TC-AUTH-001〜106（`docs/testing/authentication/baseline.md`）。振る舞いは不変（実装詳細の変更）。

## reviewers

- code-review: DeepSeek（NO ISSUES×2）/ Codex-terra（2 findings、両方対応済み。1件は
  `web-mobile-convergence.integration.test.ts` が機械置換のgrepパターンに一致しない形で
  公式`PrismaAdapter`を直接importしていた実バグ）
- test-auto TestCase review: DeepSeek（10 findings）/ Codex-terra（NO ISSUES）

## important findings / VALID・INVALID の重要判断

DeepSeekがCRITICALで「baselineが認証機能のみを対象とし、rename対象の60ファイル超（billing /
analytics / listener / ambassador等）を全くカバーしていない」と指摘。recommended_fixは
機能ごとの個別テストケース追加だったが、test-auto の原則
（「テストケース数を増やすこと自体を品質向上とみなしてはならない」「Out of Scopeをテストケース化
しない」）に照らし、個別TC追加は不採用。代わりに `npx dotenv -e .env.local.test -- vitest run`
（unit + integration 全体、Quality Gate）を実行して裏を取る方針にした。

**この全体実行で実際に `src/lib/plan/sync-subscription.test.ts` が3件FAILした。**
原因は `vi.mock("@/lib/prisma")` 内のモックキーが `user:` のまま機械置換対象から漏れていたこと
（`sync-subscription.ts` 本体は `prisma.principal.findUnique` へ既に置換済み）。モックキーを
`principal:` へ修正し、205ファイル2395件全PASSを確認した。

**教訓**: 機械置換のgrepパターン（`prisma\.user\.|prisma\.account\.`）は実コードの呼び出しは
拾えるが、`vi.mock()` 内のオブジェクトキー（`user: { findUnique: ... }`）のような
「呼び出しでない出現形」は拾えない。DeepSeekのCRITICAL指摘自体（個別TC追加という
recommended_fix）はINVALIDだったが、指摘の危惧（rename対象全体の検証不足）は正しく、
Quality Gate全体実行という対応判断が実際にバグを検出した。

DeepSeekのHIGH指摘のうちTC-AUTH-105/106（メール一致リンク制限）の「NOT RUN放置」はVALID。
ローカルDB起動・`.env.local.test`配置後に実行し、両ケースともPASSを確認した。

adapter単体テスト不在の指摘はALREADY_HANDLED — `createUser`/`linkAccount`/`getUserByAccount`は
TC-AUTH-104、`getUserByEmail`はTC-AUTH-105/106（`emailLinkRestrictedAdapter`経由）で実質カバー
済み。`getUser`/`updateUser`/`deleteUser`/`unlinkAccount`はこのアプリのコードパスから未使用。

その他（email register/loginの個別TC、account削除、streamer route、verify/generate、
ambassadorモジュールへの個別TC追加要求、および`last_reviewers`表記への指摘）はbaseline原則により
INVALID。

## verification

- `npx tsc --noEmit`: エラー0件
- `npx dotenv -e .env.local.test -- vitest run`: 205ファイル / 2395件 全PASS
- TC-AUTH-001〜106: 全PASS（TC-AUTH-105/106は今回初めてローカルDBで実行しPASS確認）

## remaining risks

なし。物理DDL変更を伴わないため本番デプロイのロールバックリスクも通常のコードデプロイと同等。
