import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import cuid from "cuid";
import { SharedUserAdapter } from "@/lib/auth-adapter";
import { prisma } from "@/lib/prisma";

// ENABLE_DEV_LOGIN=1 のときのみ有効(ローカルテスト環境専用)。本番では絶対に設定しないこと。
const devLoginProvider = CredentialsProvider({
  id: "dev-login",
  name: "Dev Login",
  credentials: { email: { label: "Email", type: "text" } },
  async authorize(credentials) {
    const email = credentials?.email?.trim().toLowerCase();
    if (!email) return null;

    const existing = await prisma.$queryRaw<{ id: string; name: string | null; email: string | null }[]>`
      SELECT id, name, email FROM public."User" WHERE email = ${email} LIMIT 1
    `;
    if (existing.length > 0) {
      return { id: existing[0].id, email: existing[0].email, name: existing[0].name };
    }

    const id = cuid();
    const name = email.split("@")[0];
    await prisma.$executeRaw`
      INSERT INTO public."User" (id, name, email, "createdAt") VALUES (${id}, ${name}, ${email}, NOW())
    `;
    return { id, email, name };
  },
});

export const authOptions: NextAuthOptions = {
  // analytics と同じ public."User" / "Account" を使うので、同じ Google アカウントなら
  // User.id が analytics と一致する。詳細は src/lib/auth-adapter.ts を参照。
  adapter: SharedUserAdapter(),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    ...(process.env.ENABLE_DEV_LOGIN === "1" ? [devLoginProvider] : []),
  ],
  // Cookie は analytics と共有しない(サービスごとに独立してログインする)。
  // 共通なのは User.id だけで、セッションは別。
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // これを忘れると session.user.id が undefined になる。
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
