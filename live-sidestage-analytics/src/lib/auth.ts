import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import type { JWT } from "next-auth/jwt";
import { cookies } from "next/headers";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import AppleProvider from "next-auth/providers/apple";
import { PrincipalPrismaAdapter, linkAccountRestrictedAdapter } from "./principal-prisma-adapter";
import { prisma } from "./prisma";
import { markLastActive } from "./mark-last-active";
import { AMBASSADOR_INVITE_COOKIE } from "./ambassador/invite-cookie";
import { claimAmbassadorInviteForNewUser } from "./ambassador/ambassador";
import { webAppleConfig, buildWebClientSecret } from "./web-apple-auth";

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
///
/// Apple 追加時に見つかった「既存ログインセッション中に別プロバイダのOAuthへ入ると
/// メール・プロバイダ種別を一切見ずに現在の User へ linkAccount() される」経路
/// （こちらも signIn コールバックでは塞げない）は、`linkAccountRestrictedAdapter()`
/// （principal-prisma-adapter.ts）が同じ設計思想で別途担保する。
function emailLinkRestrictedAdapter(): Adapter {
  const base = linkAccountRestrictedAdapter(prisma, PrincipalPrismaAdapter(prisma));

  return {
    ...base,
    async getUserByEmail(email) {
      const user = await base.getUserByEmail!(email);
      if (!user) return null;

      const linkedAccounts = await prisma.oAuthAccount.count({ where: { userId: user.id } });
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
    const user = await prisma.principal.upsert({
      where: { email },
      update: {},
      create: { email, name: email.split("@")[0] },
    });
    return { id: user.id, email: user.email, name: user.name };
  },
});

// Apple 設定が未完了(env var 未設定)ならプロバイダ自体を providers 配列に含めない。
// feature flag相当。GoogleログインにはAppleの有無が影響しない設計にするため
// (Batch 01 の webAppleConfig() は fail closed で null を返す)。
const webAppleConfigValue = webAppleConfig();
const appleProvider = webAppleConfigValue
  ? AppleProvider({
      clientId: webAppleConfigValue.servicesId,
      // next-auth@4.24.14 実物確認済み: AppleProviderの`clientSecret`は文字列固定型
      // (providers/apple.d.ts)。モジュールロード時に一度だけ評価されるため、
      // モバイル向け`buildClientSecret()`(TTL5分)をそのまま使うと5分後から
      // Apple token交換が全滅する。Web専用の長寿命(90日)wrapperを使う。
      clientSecret: buildWebClientSecret(webAppleConfigValue, webAppleConfigValue.servicesId),
      // Apple不変条件: Apple経由のPrincipalはemailを持たない(null)。
      // 実メールはlinkAccountRestrictedAdapter()がOAuthAccount.providerEmailへ回す。
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name ?? null,
          email: null,
          image: null,
        };
      },
      // 既定は checks: ["pkce"] のみ。state/nonceを明示追加しlogin CSRF対策を厚くする
      // (design-review MEDIUM指摘)。
      checks: ["pkce", "state", "nonce"],
    })
  : null;

// next-authの`defaultCookies()`(core/lib/cookie.js)と同じprefix付与ロジック。
// useSecureCookies判定はリクエストごとのプロトコルだが、本番/開発いずれも
// NEXTAUTH_URLのプロトコルと一致するため、モジュールロード時の1回評価で足りる。
const cookiePrefix = (process.env.NEXTAUTH_URL ?? "").startsWith("https://") ? "__Secure-" : "";

export const authOptions: NextAuthOptions = {
  adapter: emailLinkRestrictedAdapter(),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // 旧パスワードユーザー(Account を持たない)の移行のためだけに有効にしている。
      // 危険な側は emailLinkRestrictedAdapter が閉じる。
      allowDangerousEmailAccountLinking: true,
      // ブラウザに複数Googleアカウントがログイン済みだと、Google側の暗黙アカウント切替
      // (InteractiveLogin?authuser=1 経由)が本番のeventsサブドメインで実際に500を返した
      // (2026-09-10)。select_accountで明示選択の画面へ直接飛ばし、この経路自体を避ける。
      authorization: { params: { prompt: "select_account" } },
    }),
    ...(appleProvider ? [appleProvider] : []),
    ...(process.env.ENABLE_DEV_LOGIN === "1" ? [devLoginProvider] : []),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  // design-review確定(HIGH): Appleは response_mode: "form_post" でクロスサイトPOSTで
  // コールバックへ戻るため、checks(pkce/state/nonce)用cookieが既定の sameSite: "lax" だと
  // ブラウザに送信されず OAuthCallback エラーで全滅する。Google(GETリダイレクト)側は
  // sameSite: "none" でも top-level GET は同じcookieが送られるため挙動に影響しない。
  // next-authは authOptions.cookies を core/init.js で `{...defaultCookies(useSecureCookies), ...authOptions.cookies}`
  // とキー単位でまるごと上書きする(name含む)ため、cookie名は defaultCookies と同じ
  // "__Secure-" prefix 付与ロジックをここで再現し、既存のGoogleログイン(session-token等)
  // との命名規則を崩さないようにする。
  cookies: {
    pkceCodeVerifier: {
      name: `${cookiePrefix}next-auth.pkce.code_verifier`,
      options: {
        httpOnly: true,
        sameSite: "none",
        path: "/",
        secure: true,
        maxAge: 60 * 15,
      },
    },
    state: {
      name: `${cookiePrefix}next-auth.state`,
      options: {
        httpOnly: true,
        sameSite: "none",
        path: "/",
        secure: true,
        maxAge: 60 * 15,
      },
    },
    nonce: {
      name: `${cookiePrefix}next-auth.nonce`,
      options: {
        httpOnly: true,
        sameSite: "none",
        path: "/",
        secure: true,
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // ログイン確定。監視枠の低価値クリーンアップが「アクティブなユーザー」を
        // 保護・監視復活させる判定に使う(mark-last-active.ts参照)。
        await markLastActive(user.id);
        return token;
      }

      // ログイン時(userが渡ってくるとき)以外は、クライアントがセッションを
      // 参照するたびに呼ばれる。next-authはJWT session戦略だとDBを見ずに
      // token.idを素通しするため、モバイルのアカウント削除でUserが消えても
      // 署名が有効な限りWebセッションが生き続けてしまう。ここで実在確認する。
      //
      // {}のような空オブジェクトを返しても新しいJWTが発行され直って失効しない。
      // next-authはjwtコールバックがnullを返すとセッションを破棄する
      // (getServerSession/useSessionがnullを返すようになる)ので、必ずnullを返すこと。
      // 型定義(Awaitable<JWT>)はnullを許容していないが、実装側は正しくnullを
      // 特別扱いする(core/routes/session.tsがtry/catchで包んでおり、後続の
      // sessionコールバックがtoken.idへアクセスしてTypeErrorになった時点で
      // JWT_SESSION_ERRORとしてcookieを消す)ので、型だけ合わせて意図どおり返す。
      if (typeof token.id === "string") {
        const exists = await prisma.principal.findUnique({ where: { id: token.id }, select: { id: true } });
        if (!exists) return null as unknown as JWT;

        // JWTセッションは再ログインなしにローリング更新され続けるため、ここでも
        // アクティブを記録する(スロットルはmarkLastActive内部で行うのでawait不要)。
        void markLastActive(exists.id);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.id as string;
      return session;
    },
  },
  events: {
    // 実際に新規Userが作られたときだけ発火する(既存ユーザーの通常ログインでは呼ばれない)。
    // これにより「招待URL経由で新規作成された」ことをcreatedAtの近似ではなく確実に判定できる。
    async createUser({ user }) {
      let token: string | undefined;
      try {
        token = cookies().get(AMBASSADOR_INVITE_COOKIE)?.value;
      } catch {
        // Route Handler以外の呼び出し経路(将来的な変更等)でcookies()が使えない場合は
        // アンバサダー付与をスキップするだけで、サインアップ自体は失敗させない。
        return;
      }
      if (!token || !user.id) return;

      try {
        await claimAmbassadorInviteForNewUser(token, user.id);
      } catch (err) {
        // アンバサダー付与の失敗でサインアップ自体を失敗させない。
        // ここで失敗すると自動リトライは無い(このフックはUser作成時に一度だけ発火する)。
        // token/principalIdをログに残すのは、管理者が addAmbassadorByEmail で手動救済するため。
        console.error("[auth] claimAmbassadorInviteForNewUser failed:", { token, principalId: user.id, err });
      }
    },
  },
};
