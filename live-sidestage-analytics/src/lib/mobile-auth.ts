import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { markLastActive } from "@/lib/mark-last-active";
import { decryptReplayPayload, encryptReplayPayload } from "@/lib/refresh-token-replay-crypto";

export interface MobileTokenPayload {
  principalId: string;
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

/// access token(このJWT)の有効期限。
///
/// 以前は90日で、失効機構が無いまま端末に置かれ続けていた。refresh token(下記)による
/// 無言再発行が全ログイン経路で使えるようになったため、漏洩時の実害期間を最小化する側へ寄せる。
/// 業界の一般的なレンジは15分〜1時間で、モバイルのバッテリー・通信コスト(再発行の頻度)を
/// 考慮して1時間側を採る。
///
/// **この値を延ばすときは、refresh token の rotation・reuse 検知が生きていることが前提**
/// (access token 自体は stateless で、発行後に失効させる手段が無い)。
const ACCESS_TOKEN_TTL = "1h";

/// refresh token の sliding expiry。rotation のたびにここから再計算して延長する。
const REFRESH_TOKEN_SLIDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/// family(rotation チェーン)全体の絶対上限。**初回発行時に決まり、rotation では延長しない。**
/// これが無いと、盗んだトークンを回し続けるだけで無期限に有効なセッションが作れてしまう。
const REFRESH_TOKEN_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/// rotation 結果を `RefreshTokenReplay` に保持する猶予期間。
///
/// モバイルはメイン Isolate と背景 Isolate がほぼ同時に同じ refresh token を提示しうる
/// (ネットワーク再試行でも起こる)。これを盗難として扱うと無関係な強制ログアウトが頻発するため、
/// この窓の内側では**同じ結果**を idempotent に返す。in-memory ではなくテーブルで持つのは、
/// Railway の複数プロセス・デプロイ・再起動をまたいでも成立させるため。
const ROTATION_REPLAY_WINDOW_MS = 30 * 1000;

function getSecret(): string {
  const secret = process.env.MOBILE_JWT_SECRET;
  if (!secret) throw new Error("MOBILE_JWT_SECRET is not set");
  return secret;
}

export function signMobileToken(payload: MobileTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyMobileToken(token: string): MobileTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret());
    if (typeof decoded === "string") return null;
    const { principalId, streamerId, iat } = decoded as Partial<MobileTokenPayload> & { iat?: number };
    if (!principalId) return null;
    // iat が無いトークンは jwt.sign が付ける前提から外れているので信用しない。
    if (typeof iat !== "number" || iat < LEGACY_TOKEN_CUTOFF_SEC) return null;
    return { principalId, streamerId: streamerId || undefined };
  } catch {
    return null;
  }
}

function extractPayload(req: NextRequest): MobileTokenPayload | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const payload = verifyMobileToken(header.slice("Bearer ".length));

  // アクティブを記録する(ログイン時だけではなく、有効トークンでの各リクエストのたびに)。
  // スロットルはmarkLastActive内部で行うのでシグネチャは変えずfire-and-forgetでよい。
  if (payload) void markLastActive(payload.principalId);

  return payload;
}

export function resolveStreamerByMobileToken(req: NextRequest): { id: string; principalId: string } | null {
  const payload = extractPayload(req);
  if (!payload?.streamerId) return null;

  return { id: payload.streamerId, principalId: payload.principalId };
}

export function resolveUserByMobileToken(req: NextRequest): { principalId: string } | null {
  const payload = extractPayload(req);
  if (!payload) return null;

  return { principalId: payload.principalId };
}

/**
 * resolveUserByMobileToken() に加えて、DB上にそのUserが実在することまで確認する。
 *
 * トークンの署名・期限だけを見る resolveUserByMobileToken() は、退会・削除済みの
 * Userが持っていた旧トークンでも「認証OK」を返してしまう(90日有効なstatelessトークンで
 * 失効機構が無いため)。entitlement判定(実効プラン・機能可否)の起点はこちらを使う。
 *
 * 既存のgifts/streamer等の各APIは resolveUserByMobileToken() のままでよい —
 * 削除済みUserのprincipalIdで問い合わせても、紐づくデータが無ければ自然に404/空応答になる。
 */
export async function resolveActiveMobileUser(req: NextRequest): Promise<{ principalId: string } | null> {
  const auth = resolveUserByMobileToken(req);
  if (!auth) return null;

  const user = await prisma.principal.findUnique({ where: { id: auth.principalId }, select: { id: true } });
  if (!user) return null;

  return { principalId: auth.principalId };
}

export type MobileAnalyticsStreamer = { id: string; roomId: string; verified: boolean; principalId: string };

// mobile/analytics/* の4エンドポイント共通の認可処理。JWTのstreamerIdは信用せず
// principalIdからStreamerを引き直す(resolveUserByMobileTokenの規約を踏襲)。
//
// streamer未登録・roomId未接続の場合のレスポンスはエンドポイントごとに形もステータスも
// 違う(一覧系は既存Web版のgifts/history/route.tsに揃えて「空データ+verified:falseで200」、
// 詳細系のbattles/[id]/contributorsは既存Web版に揃えて404)。呼び出し側はその
// NextResponseをそのまま buildUnauthorizedResponse として渡す。
//
// **将来のBIO認証(verified)必須化はここ1箇所に足すだけで4エンドポイント全てに効く。**
// 今は既存Web版と同様に verified 未完了でも実データを返す(表示ブロックはフロント側の責務)。
export async function resolveMobileAnalyticsContext(
  req: NextRequest,
  buildUnregisteredResponse: () => NextResponse
): Promise<{ ok: true; streamer: MobileAnalyticsStreamer } | { ok: false; response: NextResponse }> {
  const auth = resolveUserByMobileToken(req);
  if (!auth) {
    return { ok: false, response: NextResponse.json({ error: "認証が必要です" }, { status: 401 }) };
  }

  const streamer = await prisma.streamer.findUnique({
    where: { principalId: auth.principalId },
    select: { id: true, roomId: true, verified: true, principalId: true },
  });

  if (!streamer || !streamer.roomId) {
    return { ok: false, response: buildUnregisteredResponse() };
  }

  return {
    ok: true,
    streamer: { id: streamer.id, roomId: streamer.roomId, verified: streamer.verified, principalId: streamer.principalId },
  };
}

// ---------------------------------------------------------------------------
// refresh token(OAuth2的な rotation 付き長命トークン)
//
// access token は上記のとおり1時間で切れる stateless JWT なので、端末は refresh token で
// 無言再発行する。refresh token は **生の値を DB に残さない**(SHA-256 ハッシュのみ)。
// 例外は `RefreshTokenReplay` の30秒キャッシュだけで、そこも AES-256-GCM 暗号化を通す。
// ---------------------------------------------------------------------------

/// `prisma` そのものと `$transaction` のコールバック引数の両方を受けられるようにする。
type RefreshTokenDb = Pick<typeof prisma, "refreshToken" | "principal" | "refreshTokenReplay">;

function hashRefreshToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

interface IssueRefreshTokenInput {
  principalId: string;
  streamerId?: string | null;
  /// 省略すると新しい family を採番する(= 新規ログイン)。rotation では現在の family を渡す。
  familyId?: string;
  /// 省略すると `now + 90日`。**rotation では現在の行の値をそのまま渡し、再計算しない。**
  absoluteExpiresAt?: Date;
  /// rotation のように同一トランザクション内で発行したい場合に渡す。
  db?: RefreshTokenDb;
}

/// `replacedById` を張るために id も要る rotation 用の内部版。
async function createRefreshTokenRow(
  input: IssueRefreshTokenInput,
): Promise<{ id: string; rawToken: string }> {
  const db = input.db ?? prisma;
  const now = new Date();
  const rawToken = crypto.randomBytes(32).toString("base64url");

  const row = await db.refreshToken.create({
    data: {
      principalId: input.principalId,
      streamerId: input.streamerId ?? null,
      tokenHash: hashRefreshToken(rawToken),
      familyId: input.familyId ?? crypto.randomUUID(),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_SLIDING_TTL_MS),
      absoluteExpiresAt:
        input.absoluteExpiresAt ?? new Date(now.getTime() + REFRESH_TOKEN_ABSOLUTE_TTL_MS),
    },
    select: { id: true },
  });

  return { id: row.id, rawToken };
}

/// 新しい refresh token を発行し、**生の値だけ**を返す(DB にはハッシュしか残らない)。
export async function issueRefreshToken(input: IssueRefreshTokenInput): Promise<string> {
  return (await createRefreshTokenRow(input)).rawToken;
}

export type RotateRefreshTokenSuccess = {
  principalId: string;
  streamerId: string | null;
  accessToken: string;
  refreshToken: string;
};

export type RotateRefreshTokenFailure = {
  error: "INVALID_REFRESH_TOKEN" | "TOKEN_REUSE_DETECTED";
};

export type RotateRefreshTokenResult = RotateRefreshTokenSuccess | RotateRefreshTokenFailure;

/// 猶予期間キャッシュから前回の rotation 結果を復元する。無い / 期限切れ / 復号できない
/// なら `null`（呼び出し元は「キャッシュに無かった」のと同じ扱いで先へ進む = fail-safe）。
async function readRotationReplay(
  db: Pick<RefreshTokenDb, "refreshTokenReplay">,
  tokenHash: string,
  now: Date,
): Promise<RotateRefreshTokenSuccess | null> {
  const replay = await db.refreshTokenReplay.findUnique({ where: { oldTokenHash: tokenHash } });
  if (!replay || replay.expiresAt <= now) return null;

  try {
    return {
      principalId: replay.principalId,
      streamerId: replay.streamerId,
      accessToken: decryptReplayPayload(replay.accessTokenEnc),
      refreshToken: decryptReplayPayload(replay.refreshTokenEnc),
    };
  } catch {
    // 鍵ローテーション直後などに起こりうる。生の値が読めないだけなので通常の rotation へ倒す。
    console.error("[mobile-auth] replayキャッシュの復号に失敗したため通常のrotationへフォールバックします");
    return null;
  }
}

/// refresh token を検証し、新しい access token + refresh token のペアへ rotation する。
///
/// アルゴリズムの要点(簡略化しないこと):
/// 1. `RefreshTokenReplay` を先に引く。30秒の猶予期間内なら**DBを一切書き換えずに**
///    前回とまったく同じ結果を返す(正常な同時提示の吸収)。
/// 2. 無効化は**条件付き `updateMany` 1発**で行う。`findUnique` で読んでから判定して
///    `update` する3手順に分けると、同時提示で両方が勝つ race が復活する。
/// 3. `count === 0` かつ行が既に revoke 済みなら、**もう一度だけ猶予期間キャッシュを引き直す**
///    (行ロックで待たされていた真の同時提示は、手順1の時点ではまだ勝者の結果を見られない)。
///    それでも無ければ猶予期間を過ぎた再提示 = 盗難の兆候とみなし family 全体を失効させる。
/// 4. 勝者は新しいペアと猶予期間キャッシュを**同じトランザクション内**で書く。
export async function rotateRefreshToken(rawToken: string): Promise<RotateRefreshTokenResult> {
  const tokenHash = hashRefreshToken(rawToken);
  const now = new Date();

  // --- 手順1: 猶予期間内なら前回と同じ結果を返す(書き込みなし) ---
  const cached = await readRotationReplay(prisma, tokenHash, now);
  if (cached) return cached;

  // 期限切れ行の掃除はベストエフォート(件数が小さいので専用ジョブは持たない)。
  prisma.refreshTokenReplay
    .deleteMany({ where: { expiresAt: { lt: now } } })
    .catch((err) => console.error("[mobile-auth] replayキャッシュの掃除に失敗:", err));

  // --- 手順2〜4: 原子的な無効化と、勝者だけによる再発行 ---
  const outcome = await prisma.$transaction(
    async (tx): Promise<RotateRefreshTokenResult> => {
      const revoked = await tx.refreshToken.updateMany({
        where: {
          tokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
          absoluteExpiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });

      if (revoked.count === 0) {
        const existing = await tx.refreshToken.findUnique({
          where: { tokenHash },
          select: { familyId: true, revokedAt: true },
        });

        // 行が無い / 期限切れ(revoke されていないのに使えない)は、ただの無効トークン。
        if (!existing || !existing.revokedAt) return { error: "INVALID_REFRESH_TOKEN" };

        // **真に同時**だった場合、手順1でキャッシュを引いた時点ではまだ勝者が
        // rotation を終えていない(こちらの updateMany は勝者の行ロックで待たされ、
        // 勝者の commit と同時に count=0 で戻ってくる)。ここで引き直さないと、
        // このBatchが解消しようとしている「正常な同時提示の誤検知」がそのまま残る。
        // 勝者は replay 行を**同じトランザクション内**で書くので、待たされて戻ってきた
        // 時点では必ず見える(READ COMMITTED は文ごとに新しいスナップショットを取る)。
        const raced = await readRotationReplay(tx, tokenHash, now);
        if (raced) return raced;

        // 既に revoke 済み = 誰かが rotation 済みなのに、猶予期間の外で再提示された。
        // 盗難の兆候として family 全体を失効させる(端末は再ログインが必要になる)。
        await tx.refreshToken.updateMany({
          where: { familyId: existing.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { error: "TOKEN_REUSE_DETECTED" };
      }

      const current = await tx.refreshToken.findUnique({
        where: { tokenHash },
        select: { id: true, principalId: true, familyId: true, absoluteExpiresAt: true },
      });
      if (!current) return { error: "INVALID_REFRESH_TOKEN" };

      // streamerId は **必ず現在のDB値**から解決する(トークンに焼かれた値を信用しない)。
      const user = await tx.principal.findUnique({
        where: { id: current.principalId },
        select: { id: true, streamer: { select: { id: true } } },
      });
      // onDelete: Cascade があるので通常は到達しないが、退会と同時実行された場合の保険。
      if (!user) return { error: "INVALID_REFRESH_TOKEN" };

      const streamerId = user.streamer?.id ?? null;
      const issued = await createRefreshTokenRow({
        principalId: current.principalId,
        streamerId,
        familyId: current.familyId,
        // **絶対期限は引き継ぐ(延長しない)。**
        absoluteExpiresAt: current.absoluteExpiresAt,
        db: tx,
      });
      await tx.refreshToken.update({ where: { id: current.id }, data: { replacedById: issued.id } });

      const accessToken = signMobileToken({
        principalId: current.principalId,
        streamerId: streamerId ?? undefined,
      });

      // --- 手順4の後半: 猶予期間用に結果を残す(必ず暗号化してから書く) ---
      //
      // **同じトランザクション内**で書く。commit 後に書くと、行ロックで待たされていた
      // 同時提示側が commit 直後〜この書き込みまでの隙間で「revoke 済みだが replay が無い」を
      // 観測し、正常な同時提示を盗難として誤検知する窓が残る。
      // 失敗した場合は rotation ごとロールバックさせる — 古いトークンは有効なままなので、
      // 端末の再試行で素直にやり直せる(中途半端に「猶予期間の効かない rotation」を残さない)。
      await tx.refreshTokenReplay.create({
        data: {
          oldTokenHash: tokenHash,
          principalId: current.principalId,
          streamerId,
          accessTokenEnc: encryptReplayPayload(accessToken),
          refreshTokenEnc: encryptReplayPayload(issued.rawToken),
          expiresAt: new Date(Date.now() + ROTATION_REPLAY_WINDOW_MS),
        },
      });

      return {
        principalId: current.principalId,
        streamerId,
        accessToken,
        refreshToken: issued.rawToken,
      };
    },
  );

  return outcome;
}

/// ログアウト。その refresh token が属する family を丸ごと失効させる。
/// 見つからなくても例外にしない(冪等)。
export async function revokeRefreshTokenFamily(rawToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);

  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { principalId: true, familyId: true },
  });
  if (!row) return;

  await prisma.refreshToken.updateMany({
    where: { familyId: row.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  // 猶予期間キャッシュも落とす。残しておいても返されるトークンは今 revoke したものなので
  // 実害は無いが、ログアウト直後に「新しいペア」を返す紛らわしい挙動を避ける。
  try {
    await prisma.refreshTokenReplay.deleteMany({ where: { principalId: row.principalId } });
  } catch (err) {
    console.error("[mobile-auth] ログアウト時のreplayキャッシュ削除に失敗:", err);
  }
}
