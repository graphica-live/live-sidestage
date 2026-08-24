import { prisma } from "./prisma";
import type { AppleIdTokenClaims } from "./apple-auth";
import type { MobileAuthUser } from "./mobile-oauth";

/// Apple アカウントと内部ユーザーの紐付け。
///
/// **内部ユーザーIDは `User.id`(cuid) で、Apple の `sub` は `Account.providerAccountId`
/// にしか入らない。** 認証プロバイダの識別子をアプリ内部のIDとして使わないため、
/// 同じ人が Google と Apple を両方繋いでも `User` は1つのまま。
///
/// このモジュールはモバイル専用ではない。将来 Web(NextAuth)へ Apple を足すときも
/// **同じリンク方針**をここから使う（NextAuth のアダプタ既定に任せると、下のメール
/// 一致の制限が効かなくなる）。

export const APPLE_PROVIDER = "apple";
const GOOGLE_PROVIDER = "google";

const userSelect = {
  id: true,
  name: true,
  email: true,
  streamer: { select: { id: true, tiktokId: true, verified: true, apiKey: true } },
} as const;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

async function findByAppleSub(sub: string): Promise<MobileAuthUser | null> {
  const account = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: APPLE_PROVIDER, providerAccountId: sub } },
    select: { user: { select: userSelect } },
  });
  return account?.user ?? null;
}

/// メール一致で既存ユーザーへ繋いでよいか。
///
/// **`Account(provider:"google")` を持つユーザーに限定する。** `/api/auth/register` は
/// メールの所有確認なしで `User` を作れてしまうので、単なる `User.email` 一致で繋ぐと
/// 「先に他人のメールで登録しておき、後からその人の Apple ログインを乗っ取る」経路が開く。
async function findLinkableGoogleUser(email: string): Promise<MobileAuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { ...userSelect, accounts: { where: { provider: GOOGLE_PROVIDER }, select: { id: true } } },
  });
  if (!user || user.accounts.length === 0) return null;

  const { accounts: _accounts, ...rest } = user;
  return rest;
}

async function resolveOnce(
  claims: AppleIdTokenClaims,
  name: string | null,
): Promise<MobileAuthUser> {
  const existing = await findByAppleSub(claims.sub);
  if (existing) return existing;

  // private relay(privaterelay.appleid.com)のアドレスは本人のメールではないので
  // リンクの根拠にしない。未確認メールも同様。
  if (claims.email && claims.emailVerified && !claims.isPrivateEmail) {
    const linkable = await findLinkableGoogleUser(claims.email);
    if (linkable) {
      await prisma.account.create({
        data: {
          userId: linkable.id,
          type: "oauth",
          provider: APPLE_PROVIDER,
          providerAccountId: claims.sub,
        },
      });
      return linkable;
    }
  }

  // ここに来たら新規ユーザー。private relay のアドレスもそのまま保存する
  // （Apple が転送してくれる有効な連絡先で、(ユーザー, Team)ごとに一意）。
  //
  // ただし **リンクを断った相手が同じメールを持っていることがある**
  // （`/api/auth/register` でメールを先取りされた User、未確認メール）。
  // `User.email` は unique なので、そのまま作ると P2002 で落ち、その人は
  // 二度と Apple でログインできなくなる（メールを先に取るだけで妨害できてしまう）。
  // 内部IDは `User.id` なのでメールが無くても成立する。取られていたら null で作る。
  const emailTaken =
    claims.email !== null && (await prisma.user.count({ where: { email: claims.email } })) > 0;

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: emailTaken ? null : claims.email, name },
      select: { id: true, name: true, email: true },
    });
    await tx.account.create({
      data: {
        userId: user.id,
        type: "oauth",
        provider: APPLE_PROVIDER,
        providerAccountId: claims.sub,
      },
    });
    return { ...user, streamer: null };
  });
}

/// Apple のクレームから内部ユーザーを解決する。無ければ作る。
///
/// 並行してログインが走ると、両方が「まだ Account が無い」と判断して作成に進み、
/// 片方が unique 制約(P2002)で落ちる。落ちた側は作成済みの Account を読み直せば
/// 同じ結論に収束する。メールを取られていた場合の競合も、やり直せば
/// [resolveOnce] の `emailTaken` 判定が真になって null で作り直せる。
/// どちらも1回のやり直しで決着する。
export async function resolveAppleUser(
  claims: AppleIdTokenClaims,
  name: string | null,
): Promise<MobileAuthUser> {
  try {
    return await resolveOnce(claims, name);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const raced = await findByAppleSub(claims.sub);
    if (raced) return raced;
    return resolveOnce(claims, name);
  }
}
