import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";

export interface MobileTokenPayload {
  userId: string;
  streamerId?: string;
}

/// これより前に発行されたトークンは無効として扱う。
///
/// `5a3e97a`（モバイル認証をメール/パスワードから Google へ移行）より前は、
/// `/api/mobile/auth/register` が**メールの所有確認をせずに** User と Streamer を作り、
/// この 90 日トークンを発行していた。トークンは stateless で `jti` も失効機構も無いため、
/// 当時発行されたものは 2026-11 月まで有効なまま残る。
///
/// 値は 5a3e97a の**本番デプロイ時刻**（Railway: 2026-08-15T01:31:47Z にデプロイ開始）から
/// コンテナ切替のぶんを見て切り上げたもの。**コミット時刻ではない**（コミットからデプロイ完了
/// までの間に発行された旧トークンを取りこぼす）。
///
/// これ以降に発行された正規トークンは全て Google / Apple ログイン由来なので、
/// 弾かれるのは旧 register 由来のトークンだけ。切替直後にログインしていた利用者が
/// まれに巻き込まれるが、その場合は再ログインで回復する（データは失われない）。
const LEGACY_TOKEN_CUTOFF_SEC = Math.floor(Date.parse("2026-08-15T02:00:00Z") / 1000);

function getSecret(): string {
  const secret = process.env.MOBILE_JWT_SECRET;
  if (!secret) throw new Error("MOBILE_JWT_SECRET is not set");
  return secret;
}

export function signMobileToken(payload: MobileTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "90d" });
}

export function verifyMobileToken(token: string): MobileTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret());
    if (typeof decoded === "string") return null;
    const { userId, streamerId, iat } = decoded as Partial<MobileTokenPayload> & { iat?: number };
    if (!userId) return null;
    // iat が無いトークンは jwt.sign が付ける前提から外れているので信用しない。
    if (typeof iat !== "number" || iat < LEGACY_TOKEN_CUTOFF_SEC) return null;
    return { userId, streamerId: streamerId || undefined };
  } catch {
    return null;
  }
}

function extractPayload(req: NextRequest): MobileTokenPayload | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return verifyMobileToken(header.slice("Bearer ".length));
}

export function resolveStreamerByMobileToken(req: NextRequest): { id: string; userId: string } | null {
  const payload = extractPayload(req);
  if (!payload?.streamerId) return null;

  return { id: payload.streamerId, userId: payload.userId };
}

export function resolveUserByMobileToken(req: NextRequest): { userId: string } | null {
  const payload = extractPayload(req);
  if (!payload) return null;

  return { userId: payload.userId };
}

/**
 * resolveUserByMobileToken() に加えて、DB上にそのUserが実在することまで確認する。
 *
 * トークンの署名・期限だけを見る resolveUserByMobileToken() は、退会・削除済みの
 * Userが持っていた旧トークンでも「認証OK」を返してしまう(90日有効なstatelessトークンで
 * 失効機構が無いため)。entitlement判定(実効プラン・機能可否)の起点はこちらを使う。
 *
 * 既存のgifts/streamer等の各APIは resolveUserByMobileToken() のままでよい —
 * 削除済みUserのuserIdで問い合わせても、紐づくデータが無ければ自然に404/空応答になる。
 */
export async function resolveActiveMobileUser(req: NextRequest): Promise<{ userId: string } | null> {
  const auth = resolveUserByMobileToken(req);
  if (!auth) return null;

  const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { id: true } });
  if (!user) return null;

  return { userId: auth.userId };
}
