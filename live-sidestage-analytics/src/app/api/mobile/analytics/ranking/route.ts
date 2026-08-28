import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { getDateRange, queryGifts } from "@/lib/gift-analytics";
import { sanitizeAvatarUrl } from "@/lib/tiktok-profile";
import { jstDateKey } from "@/lib/overlay/day-key";
import { parsePeriodQuery } from "@/lib/mobile-analytics-query";

const buildUnregisteredResponse = () =>
  NextResponse.json({
    users: [],
    dateRange: { start: "", end: "" },
    total: { giftCount: 0, totalDiamonds: 0 },
    verified: false,
  });

export async function GET(req: NextRequest) {
  const ctx = await resolveMobileAnalyticsContext(req, buildUnregisteredResponse);
  if (!ctx.ok) return ctx.response;

  const { searchParams } = new URL(req.url);
  const query = parsePeriodQuery(searchParams, jstDateKey());
  if (!query.ok) return query.response;
  const { period, date } = query.value;

  const { start, end } = getDateRange(period, date);
  const { users, total } = await queryGifts(ctx.streamer.roomId, ctx.streamer.id, {
    dayKey: { gte: start, lte: end },
  });

  // queryGifts() は groupBy の結果順(順位順ではない)を返すため、
  // 配列インデックス+1がそのまま順位になるようここで明示的にソートする。
  const sorted = [...users].sort((a, b) => {
    if (a.totalDiamonds !== b.totalDiamonds) return b.totalDiamonds - a.totalDiamonds;
    if (a.giftCount !== b.giftCount) return b.giftCount - a.giftCount;
    return a.uniqueId < b.uniqueId ? -1 : a.uniqueId > b.uniqueId ? 1 : 0;
  });

  return NextResponse.json(
    {
      users: sorted.map((u) => ({ ...u, profileImageUrl: sanitizeAvatarUrl(u.profileImageUrl) })),
      dateRange: { start, end },
      total,
      verified: ctx.streamer.verified,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
