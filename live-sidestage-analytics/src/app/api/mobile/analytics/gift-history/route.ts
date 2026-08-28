import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { getDateRange } from "@/lib/gift-analytics";
import { queryGiftHistory } from "@/lib/gift-history";
import { sanitizeAvatarUrl } from "@/lib/tiktok-profile";
import { jstDateKey } from "@/lib/overlay/day-key";
import { parsePeriodQuery, parseLimit } from "@/lib/mobile-analytics-query";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const buildUnregisteredResponse = () =>
  NextResponse.json({
    events: [],
    dateRange: { start: "", end: "" },
    total: { count: 0, diamonds: 0 },
    hasMore: false,
    verified: false,
  });

export async function GET(req: NextRequest) {
  const ctx = await resolveMobileAnalyticsContext(req, buildUnregisteredResponse);
  if (!ctx.ok) return ctx.response;

  const { searchParams } = new URL(req.url);
  const query = parsePeriodQuery(searchParams, jstDateKey());
  if (!query.ok) return query.response;
  const { period, date } = query.value;

  const limit = parseLimit(searchParams, DEFAULT_LIMIT, MAX_LIMIT);
  if (!limit.ok) return limit.response;

  const { start, end } = getDateRange(period, date);
  const { events, total, hasMore } = await queryGiftHistory(
    ctx.streamer.roomId,
    ctx.streamer.id,
    { dayKey: { gte: start, lte: end } },
    limit.value
  );

  return NextResponse.json(
    {
      events: events.map((e) => ({
        ...e,
        profileImageUrl: sanitizeAvatarUrl(e.profileImageUrl),
        giftPictureUrl: sanitizeAvatarUrl(e.giftPictureUrl),
      })),
      dateRange: { start, end },
      total,
      hasMore,
      verified: ctx.streamer.verified,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
