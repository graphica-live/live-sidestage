import type { PrismaClient } from "@prisma/client";
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "next-auth/adapters";
import jwt from "jsonwebtoken";
import { normalizeEmail } from "./apple-auth";
import { webAppleConfig } from "./web-apple-auth";

/**
 * `@next-auth/prisma-adapter` の `PrismaAdapter()` を自前で持つ最小限のコピー。
 *
 * Prisma model を `User` → `Principal`、`Account` → `OAuthAccount` へ rename した
 * （`live-sidestage-analytics/prisma/schema.prisma`。物理テーブル名は `@@map` で
 * `"User"` / `"Account"` のまま不変）ため、公式パッケージが `p.user.*` / `p.account.*`
 * を直書きしている箇所が使えなくなった。ベースは
 * `node_modules/@next-auth/prisma-adapter/dist/index.js`（v1.0.7）で、変更点は
 * delegate 名の8箇所（`p.user.*` 5箇所 + `p.account.*` 3箇所）のみ。
 * `select: { user: true }` / `include: { user: true }` 等のリレーションフィールド名
 * `user`（model名ではなくフィールド名）は rename 対象外のため、そのまま維持している。
 * それ以外のロジック（`p.session.*` / `p.verificationToken.*` を含む）も無改造。
 */
// next-auth の `AdapterUser.email` は `string`(必須)だが、Prisma の `Principal.email` は
// nullable(Apple 経由の principal は `email: null` で作る設計 — CLAUDE.md 参照)。
// 公式 `@next-auth/prisma-adapter` は手書きの ambient `.d.ts` を配布しているだけで、実装
// (dist/index.js)は TypeScript として型検査されていなかったためこの不整合は表面化して
// いなかった。今回 TypeScript 実装として書き起こしたことで顕在化した型不整合であり、
// ロジックは一切変えず(公式実装と同じ値をそのまま返す)、next-auth の型契約との差分だけを
// 明示的にキャストして吸収する。
type PrincipalRecord = Awaited<ReturnType<PrismaClient["principal"]["findUnique"]>>;
const asAdapterUser = (user: PrincipalRecord | null | undefined) =>
  user as unknown as AdapterUser | null;

export function PrincipalPrismaAdapter(p: PrismaClient): Adapter {
  return {
    createUser: (data: Omit<AdapterUser, "id">) =>
      p.principal.create({ data }) as unknown as Promise<AdapterUser>,
    getUser: (id) => p.principal.findUnique({ where: { id } }).then(asAdapterUser),
    getUserByEmail: (email) => p.principal.findUnique({ where: { email } }).then(asAdapterUser),
    async getUserByAccount(provider_providerAccountId) {
      const account = await p.oAuthAccount.findUnique({
        where: { provider_providerAccountId },
        select: { user: true },
      });
      return asAdapterUser(account?.user ?? null);
    },
    updateUser: ({ id, ...data }) =>
      p.principal.update({ where: { id }, data }) as unknown as Promise<AdapterUser>,
    deleteUser: (id) => p.principal.delete({ where: { id } }) as unknown as Promise<AdapterUser>,
    linkAccount: (data: AdapterAccount) =>
      p.oAuthAccount.create({ data }) as unknown as Promise<AdapterAccount>,
    unlinkAccount: (provider_providerAccountId: Pick<AdapterAccount, "provider" | "providerAccountId">) =>
      p.oAuthAccount.delete({
        where: { provider_providerAccountId },
      }) as unknown as Promise<AdapterAccount>,
    async getSessionAndUser(sessionToken) {
      const userAndSession = await p.session.findUnique({
        where: { sessionToken },
        include: { user: true },
      });
      if (!userAndSession) return null;
      const { user, ...session } = userAndSession;
      return { user: asAdapterUser(user) as AdapterUser, session: session as unknown as AdapterSession };
    },
    createSession: (data) => p.session.create({ data }),
    updateSession: (data) =>
      p.session.update({ where: { sessionToken: data.sessionToken }, data }),
    deleteSession: (sessionToken) => p.session.delete({ where: { sessionToken } }),
    async createVerificationToken(data) {
      const verificationToken = await p.verificationToken.create({ data });
      // @ts-expect-error MongoDB needs an ID, but we don't (公式実装と同じ挙動を維持)
      if (verificationToken.id) delete verificationToken.id;
      return verificationToken;
    },
    async useVerificationToken(identifier_token) {
      try {
        const verificationToken = await p.verificationToken.delete({
          where: { identifier_token },
        });
        // @ts-expect-error MongoDB needs an ID, but we don't (公式実装と同じ挙動を維持)
        if (verificationToken.id) delete verificationToken.id;
        return verificationToken;
      } catch (error) {
        // トークンが既に使用済み/削除済みなら null を返すだけ
        // https://www.prisma.io/docs/reference/api-reference/error-reference#p2025
        if ((error as { code?: string })?.code === "P2025") return null;
        throw error;
      }
    },
  };
}

/// 「既存ログインセッション中に別プロバイダのOAuthへ入ると、メール・プロバイダ種別を
/// 一切見ずに現在の User へ linkAccount() される」経路を塞ぐラッパー。
///
/// next-auth v4 の `callback-handler.js` は、adapterあり + 呼び出し元セッションあり
/// (`{user}` が渡っている) + 対象OAuthアカウントが未連携、の場合に
/// `linkAccount({...account, userId: user.id})` を無条件で呼ぶ（メール一致すら見ない）。
/// これは `signIn` コールバックが `{user, account, profile}` のみを受け取り、
/// 現在のセッション有無を判定できないため `signIn` コールバックでは塞げない
/// (`auth.ts` の `emailLinkRestrictedAdapter()` が同じ理由で `getUserByEmail` 側を
/// アダプタで担保している前例と同じ設計)。
///
/// **ルール**: link先 User に既存 OAuthAccount が1件以上あれば拒否する。
/// - 新規 User 作成直後の初回 linkAccount（`getUserByEmail`/新規createUserを経由）は
///   Account 0件なので通る。
/// - Account 0件の旧 User へのメール一致リンク（`emailLinkRestrictedAdapter`が許可する
///   経路）も Account 0件なので通る。
/// - 既存ログインセッション中に別プロバイダへ入る経路は、既存セッションの User が
///   ログインに使ったプロバイダの Account を必ず1件以上持っているため、この1ルールで
///   Google→Apple・Apple→Google 両方向とも拒否できる。
export function linkAccountRestrictedAdapter(p: PrismaClient, base: Adapter): Adapter {
  return {
    ...base,
    async linkAccount(account: AdapterAccount) {
      const existingCount = await p.oAuthAccount.count({ where: { userId: account.userId } });
      if (existingCount > 0) {
        // null/undefinedを返すとnext-authは「リンク成功扱い」で処理を続けてしまうため、
        // 意図的な拒否だと分かる形で例外を投げてサインイン自体を失敗させる。
        throw new Error(
          `implicit account linking refused: user already has ${existingCount} linked account(s)`,
        );
      }

      let data: AdapterAccount = account;
      if (account.provider === "apple") {
        // account.id_token は openid-client の TokenSet(next-auth `Account`が
        // `Partial<TokenSet>` を extends)経由でここまで届く。署名・iss・aud・expの検証は
        // openid-client の token交換〜client.callback()内で既に完了しているため、
        // ここでは再検証せず `jwt.decode` でクレームを読むだけでよい。
        const claims = account.id_token ? jwt.decode(account.id_token) : null;
        const email =
          claims && typeof claims === "object" ? normalizeEmail((claims as { email?: unknown }).email) : null;

        // servicesId(Apple Developer PortalのServices ID)はrevoke時にclient_secretの
        // 署名対象(sub)として必要。モバイル向け`apple-account.ts`と同じ列構成に揃え、
        // `revokeAppleToken`がWeb起源のOAuthAccountでもrevoke可能にする。
        const appleClientId = webAppleConfig()?.servicesId ?? null;

        data = {
          ...account,
          // モバイルの`apple-account.ts`と同じく、リンク判定に使わない表示専用の値。
          providerEmail: email,
          // AdapterAccount(next-authのTokenSetParameters由来)の型は`string | undefined`
          // でnullを受け付けないため、undefinedのまま渡す(Prisma側は未指定でnullになる)。
          refresh_token: account.refresh_token,
          appleClientId,
        } as AdapterAccount;
      }

      return base.linkAccount!(data);
    },
  };
}
