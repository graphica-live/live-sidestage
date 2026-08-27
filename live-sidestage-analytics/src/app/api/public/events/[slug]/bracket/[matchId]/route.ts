import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findPublicEvent } from "@/event/public-event";
import { matchDetailCache } from "@/event/match-detail";

// 公開トーナメント表の対戦詳細(バトルスコア・貢献者一覧)。
//
// 認証不要の公開エンドポイントで、バトル単位のギフト集計(貢献者一覧)を伴いうるため、
// **IPベースの簡易レート制限**を掛ける(設計レビューで指摘された負荷対策)。完全な
// 分散レート制限(Redis等)は複数レプリカ構成で初めて要る話で、単一プロセスの間引きとしては
// 過剰なので導入しない。実際の重い集計は `loadPublicMatchDetail()` 側の
// TTLキャッシュ+同時要求の集約が主で、ここはその手前の粗い間引き。

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 30;
const MAX_RATE_LIMIT_ENTRIES = 5_000;

type RateEntry = { count: number; windowStart: number };
const rateLimitState = new Map<string, RateEntry>();

function isRateLimited(ip: string, now: number): boolean {
  const entry = rateLimitState.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(ip, { count: 1, windowStart: now });
    if (rateLimitState.size > MAX_RATE_LIMIT_ENTRIES) {
      const oldest = rateLimitState.keys().next();
      if (!oldest.done) rateLimitState.delete(oldest.value);
    }
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

/** Railway は `X-Real-IP` を付与する。ローカル開発等で無ければ `X-Forwarded-For` の先頭を使う。 */
function clientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

export async function GET(
  req: Request,
  { params }: { params: { slug: string; matchId: string } }
) {
  const now = Date.now();
  if (isRateLimited(clientIp(req), now)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event || event.format !== "TOURNAMENT") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const detail = await matchDetailCache.load(prisma, {
    event,
    matchId: params.matchId,
    now: new Date(now),
  });
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(detail, {
    headers: {
      // 対戦の状態にかかわらず短期キャッシュに揃える。`finalizedAt` は結果変更(reopen)で
      // null に戻り、表示名等も再集計なしで変わりうるため、長期キャッシュは不変条件として
      // 使えない(設計レビューで指摘)。
      "Cache-Control":
        event.visibility === "PUBLIC" ? "public, max-age=5, stale-while-revalidate=10" : "private, no-store",
    },
  });
}
