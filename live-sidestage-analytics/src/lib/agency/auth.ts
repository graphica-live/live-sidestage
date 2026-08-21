import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { normalizeEmail } from "./agency";
import {
  AGENCY_CALLBACK_COOKIE,
  AGENCY_CSRF_COOKIE,
  AGENCY_GOOGLE_PROVIDER_ID,
  AGENCY_LOGIN_PATH,
  AGENCY_NONCE_COOKIE,
  AGENCY_PKCE_COOKIE,
  AGENCY_SESSION_COOKIE,
  AGENCY_STATE_COOKIE,
  AGENCY_USE_SECURE_COOKIES,
} from "./session-cookie";

// 事務所コンソールは配信者/管理者(src/lib/auth.ts)とは独立したセッションで動く。
// Cookie名もNextAuthのエンドポイント(/api/agency-auth)も分けてあるため、同じブラウザで
// 「配信者としてログイン」と「事務所としてログイン」が同時に成立し、
// 片方のログアウトはもう片方に影響しない。
//
// 配信者側と違い PrismaAdapter を使わない。事務所の識別子は Agency.email だけで
// User / Account / Session 行を作る必要がないため(JWTのみで完結する)。
// これにより配信者側のUserテーブルと一切干渉しない。

const secureOptions = { httpOnly: true, sameSite: "lax", path: "/", secure: AGENCY_USE_SECURE_COOKIES } as const;

// ENABLE_DEV_LOGIN=1 のときのみ有効(ローカルテスト環境専用)。本番では絶対に設定しないこと。
// 配信者側と違い、ここではUserを作らない(事務所はemailだけで識別されるため)。
const devLoginProvider = CredentialsProvider({
  id: "dev-login",
  name: "Dev Login",
  credentials: { email: { label: "Email", type: "text" } },
  async authorize(credentials) {
    const email = normalizeEmail(credentials?.email ?? "");
    if (!email) return null;
    return { id: email, email };
  },
});

export const agencyAuthOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      // 配信者側の "google" とは別 id。理由は AGENCY_GOOGLE_PROVIDER_ID のコメント参照。
      id: AGENCY_GOOGLE_PROVIDER_ID,
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    ...(process.env.ENABLE_DEV_LOGIN === "1" ? [devLoginProvider] : []),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: AGENCY_LOGIN_PATH,
    error: AGENCY_LOGIN_PATH,
  },
  cookies: {
    sessionToken: { name: AGENCY_SESSION_COOKIE, options: secureOptions },
    callbackUrl: {
      name: AGENCY_CALLBACK_COOKIE,
      options: { sameSite: "lax", path: "/", secure: AGENCY_USE_SECURE_COOKIES },
    },
    csrfToken: { name: AGENCY_CSRF_COOKIE, options: secureOptions },
    state: { name: AGENCY_STATE_COOKIE, options: { ...secureOptions, maxAge: 900 } },
    pkceCodeVerifier: { name: AGENCY_PKCE_COOKIE, options: { ...secureOptions, maxAge: 900 } },
    nonce: { name: AGENCY_NONCE_COOKIE, options: secureOptions },
  },
  callbacks: {
    // signIn コールバックで未登録アカウントを弾かない。
    //
    // NextAuth v4 は signIn が false を返したとき pages.error を使わず
    // `<origin>/api/auth/error?error=AccessDenied` へ固定でリダイレクトする
    // (core/routes/callback.js)。そこは配信者側インスタンスのエンドポイントで、
    // 事務所ユーザーに配信者側のエラー画面を見せることになる。
    //
    // セッションが成立しても権限は一切増えない。事務所判定は Agency レコードの
    // 有無で行い、API は 404、コンソールは「事務所情報が見つかりません」を表示する。
    async jwt({ token, user }) {
      if (user?.email) token.email = normalizeEmail(user.email);
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.email = (token.email as string | undefined) ?? null;
      return session;
    },
  },
};
