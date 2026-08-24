import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "./prisma";

/// `allowDangerousEmailAccountLinking` のメール一致リンクを
/// **Account を1件も持たない User だけ**に絞るためのラッパ。
///
/// NextAuth は未連携の OAuth に入ったとき `getUserByEmail()` で既存 User を探して
/// そこへ `linkAccount()` する。`User.email` は「そのメールの所有者である」ことを
/// 証明していない（旧 `/api/auth/register` / `dev-login` / Workspace のメール再利用）ので、
/// 既に Account を持つ User まで拾わせると、同じメールを後から入手できた別人が
/// そのアカウントへ正面からログインできてしまう。
///
/// 一方 5a3e97a 以前の「メール/パスワード登録」で作られた旧 User は Account を持たない。
/// そこだけ通せば Google への移行経路は保ったまま、危険な側だけ閉じられる。
/// モバイル側の同じ判断は `src/app/api/mobile/auth/google/route.ts` にある。
///
/// **プロバイダのオプションでは書けない条件なのでアダプタ側で担保する。**
/// `signIn` コールバックは現在のセッションを受け取れず「新規サインアップ」と
/// 「ログイン中の暗黙リンク」を区別できないため、ここでは使えない。
function emailLinkRestrictedAdapter(): Adapter {
  const base = PrismaAdapter(prisma);

  return {
    ...base,
    async getUserByEmail(email) {
      const user = await base.getUserByEmail!(email);
      if (!user) return null;

      const linkedAccounts = await prisma.account.count({ where: { userId: user.id } });
      if (linkedAccounts === 0) return user;

      // null を返すと NextAuth が新規作成へ進み、User.email の unique に当たって
      // 分かりにくい P2002 になる。意図的な拒否だと分かる形で落とす。
      throw new Error(
        `email-match account linking refused: user already has ${linkedAccounts} linked account(s)`,
      );
    },
  };
}

// ENABLE_DEV_LOGIN=1 のときのみ有効(ローカルテスト環境専用)。
// メールアドレスだけでログインでき、未登録なら自動でUserを作成する。本番では絶対に設定しないこと。
const devLoginProvider = CredentialsProvider({
  id: "dev-login",
  name: "Dev Login",
  credentials: { email: { label: "Email", type: "text" } },
  async authorize(credentials) {
    const email = credentials?.email?.trim().toLowerCase();
    if (!email) return null;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: email.split("@")[0] },
    });
    return { id: user.id, email: user.email, name: user.name };
  },
});

export const authOptions: NextAuthOptions = {
  adapter: emailLinkRestrictedAdapter(),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // 旧パスワードユーザー(Account を持たない)の移行のためだけに有効にしている。
      // 危険な側は emailLinkRestrictedAdapter が閉じる。
      allowDangerousEmailAccountLinking: true,
    }),
    ...(process.env.ENABLE_DEV_LOGIN === "1" ? [devLoginProvider] : []),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.id as string;
      return session;
    },
  },
};
