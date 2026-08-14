import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "./prisma";

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
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
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
