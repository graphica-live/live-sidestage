import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { getDateRange } from "@/lib/gift-analytics";
import { queryGiftHistory } from "@/lib/gift-history";
import { sanitizeAvatarUrl } from "@/lib/tiktok-profile";
import { jstDateKey } from "@/lib/overlay/day-key";
import { parseRangeQuery, parseLimit, parseListenerQuery } from "@/lib/mobile-analytics-query";

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
  const query = parseRangeQuery(searchParams, jstDateKey());
  if (!query.ok) return query.response;

  const limit = parseLimit(searchParams, DEFAULT_LIMIT, MAX_LIMIT);
  if (!limit.ok) return limit.response;

  const listenerQuery = parseListenerQuery(searchParams);
  if (!listenerQuery.ok) return listenerQuery.response;

  let where: Parameters<typeof queryGiftHistory>[2];
  let dateRange: { start: string; end: string };
  if (query.value.mode === "custom") {
    const { start, end } = query.value;
    where = { receivedAt: { gte: start, lte: end } };
    dateRange = { start: start.toISOString(), end: end.toISOString() };
  } else {
    const { start, end } = getDateRange(query.value.period, query.value.date);
    where = { dayKey: { gte: start, lte: end } };
    dateRange = { start, end };
  }

  const { events, total, hasMore } = await queryGiftHistory(
    ctx.streamer.roomId,
    ctx.streamer.id,
    where,
    limit.value,
    listenerQuery.value
  );

  return NextResponse.json(
    {
      events: events.map((e) => ({
        ...e,
        profileImageUrl: sanitizeAvatarUrl(e.profileImageUrl),
        giftPictureUrl: sanitizeAvatarUrl(e.giftPictureUrl),
      })),
      dateRange,
      total,
      hasMore,
      verified: ctx.streamer.verified,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
