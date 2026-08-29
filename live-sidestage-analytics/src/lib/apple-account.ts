import { prisma } from "./prisma";
import type { AppleIdTokenClaims } from "./apple-auth";
import type { MobileAuthUser } from "./mobile-oauth";

/// Apple アカウントと内部ユーザーの紐付け。
///
/// **Apple のログインは常に新しい User を作る。既存の Google ユーザーへは繋がない。**
/// 同じ人が Google と Apple を使い分けたときに、意図せず片方の配信設定へ
/// 吸着させないため。
///
/// そのために **Apple 経由の `User` は `User.email` を持たない**（`null` で作る）。
/// メールを持たせると、あとから同じメールで Google ログインしたときに
/// [../app/api/mobile/auth/google/route.ts] のメール一致リンクが拾ってしまい、
/// 結局統合されてしまう。メールが無ければ一致しようがない。
///
/// Apple が申告したメールは `Account.providerEmail` に置き、**表示のためだけに**使う。
/// モバイルへ返す `MobileAuthUser.email` はこちらの値。
/// 「DB の User.email は null なのに応答の email には値が入る」という食い違いは
/// この理由による意図的なもの。
///
/// **内部ユーザーIDは `User.id`(cuid) で、Apple の `sub` は `Account.providerAccountId`
/// にしか入らない。**
///
/// ## Web(NextAuth) へ広げるときの注意
///
/// 上の分離は「現在のコードパス上の不変条件」であって、DB 制約による保証ではない。
/// NextAuth は **すでにログイン済みのセッションがある状態で未連携の OAuth に入ると、
/// メールを見ずに現在の User へ `linkAccount()` する**
/// (next-auth/src/core/lib/callback-handler.ts)。つまり Web で Google ログイン中に
/// Apple を繋ぐと、`User.email` が null でも統合される。
/// Web へ Apple を足すときは `signIn` コールバック等で明示的に弾くこと。

export const APPLE_PROVIDER = "apple";

const userSelect = {
  id: true,
  name: true,
  streamer: { select: { id: true, tiktokId: true, verified: true, apiKey: true } },
} as const;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

async function findByAppleSub(sub: string): Promise<MobileAuthUser | null> {
  const account = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: APPLE_PROVIDER, providerAccountId: sub } },
    select: { providerEmail: true, user: { select: userSelect } },
  });
  if (!account) return null;

  return { ...account.user, email: account.providerEmail };
}

/// revoke(アカウント削除時)に必要なトークン。code交換のたびにAppleが返すもので、
/// refresh_tokenが取れなかった回はnull(revokeがスキップされるだけでログイン自体はブロックしない)。
export interface AppleTokens {
  refreshToken: string | null;
  clientId: string;
}

async function createAppleUser(
  claims: AppleIdTokenClaims,
  name: string | null,
  tokens: AppleTokens,
): Promise<MobileAuthUser> {
  // User と Account を nested write で一度に作る。$transaction を回すより、
  // 原子性・孤児 User の防止・作成した providerEmail の取り出しが1つの形で済む。
  const account = await prisma.account.create({
    data: {
      type: "oauth",
      provider: APPLE_PROVIDER,
      providerAccountId: claims.sub,
      // private relay(転送用アドレス)も未確認メールもそのまま保存する。
      // リンクの根拠にしないので、正しさを問う必要がない。
      providerEmail: claims.email,
      refresh_token: tokens.refreshToken,
      appleClientId: tokens.clientId,
      // ここを claims.email にしないこと。上のコメント参照。
      user: { create: { email: null, name } },
    },
    select: { providerEmail: true, user: { select: userSelect } },
  });

  return { ...account.user, email: account.providerEmail };
}

/// 2回目以降のログインでも毎回revoke用トークンを最新化する。Appleはcode交換のたびに
/// refresh_tokenを返すため(過去に発行した分が失効するとは限らないが)、実際にrevokeを
/// 叩く時点の値を常に持っておく方が安全。refreshTokenが取れなかった回は書き換えない
/// (直前の正常ログインで持っていた値を失わないため)。
async function persistAppleTokens(sub: string, tokens: AppleTokens): Promise<void> {
  if (!tokens.refreshToken) return;
  await prisma.account.updateMany({
    where: { provider: APPLE_PROVIDER, providerAccountId: sub },
    data: { refresh_token: tokens.refreshToken, appleClientId: tokens.clientId },
  });
}

/// Apple のクレームから内部ユーザーを解決する。無ければ作る。
///
/// 並行してログインが走ると、両方が「まだ Account が無い」と判断して作成に進み、
/// 片方が `Account` の unique 制約(P2002)で落ちる。負けた側は nested write ごと
/// ロールバックされるので孤児の `User` は残らず、作成済みの Account を読み直せば
/// 同じ結論に収束する。
export async function resolveAppleUser(
  claims: AppleIdTokenClaims,
  name: string | null,
  tokens: AppleTokens,
): Promise<MobileAuthUser> {
  const existing = await findByAppleSub(claims.sub);
  if (existing) {
    await persistAppleTokens(claims.sub, tokens);
    return existing;
  }

  try {
    return await createAppleUser(claims, name, tokens);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const raced = await findByAppleSub(claims.sub);
    if (raced) {
      await persistAppleTokens(claims.sub, tokens);
      return raced;
    }
    // Account の unique 以外で P2002 が出る経路は無いはずなので、
    // 読み直しても見つからないなら握り潰さずそのまま投げる。
    throw error;
  }
}
