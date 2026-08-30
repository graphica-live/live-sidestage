import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { queryBattles, jstDateRangeToUtc } from "@/lib/battle-history";
import { getDateRange } from "@/lib/gift-analytics";
import { backfillHostUserIds } from "@/lib/tiktok-host-id";
import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/overlay/day-key";
import { parseRangeQuery } from "@/lib/mobile-analytics-query";

// queryBattles() 内部の take: 200 と同じ上限。ここに達していたら hasMore で伝える。
const BATTLE_LIST_LIMIT = 200;

const buildUnregisteredResponse = () =>
  NextResponse.json({
    battles: [],
    dateRange: { start: "", end: "" },
    hasMore: false,
    verified: false,
  });

export async function GET(req: NextRequest) {
  const ctx = await resolveMobileAnalyticsContext(req, buildUnregisteredResponse);
  if (!ctx.ok) return ctx.response;

  const { searchParams } = new URL(req.url);
  const query = parseRangeQuery(searchParams, jstDateKey());
  if (!query.ok) return query.response;

  // hostUserId(TikTokの数値userId)はfill-onceの不変値で、スコア表示の消去法に要る。
  // Web版(analytics/battles/route.ts)と同じくレスポンスはブロックしない。
  const room = await prisma.tiktokRoom.findUnique({
    where: { id: ctx.streamer.roomId },
    select: { tiktokId: true, hostUserId: true },
  });
  if (room && room.hostUserId === null) {
    void backfillHostUserIds([room.tiktokId], { maxPerRun: 1 }).catch(() => {});
  }

  let range: { start: Date; end: Date };
  let dateRange: { start: string; end: string };
  if (query.value.mode === "custom") {
    const { start, end } = query.value;
    range = { start, end };
    dateRange = { start: start.toISOString(), end: end.toISOString() };
  } else {
    range = jstDateRangeToUtc(query.value.period, query.value.date);
    dateRange = getDateRange(query.value.period, query.value.date);
  }

  const { battles } = await queryBattles(ctx.streamer.roomId, ctx.streamer.id, range);

  return NextResponse.json(
    {
      battles,
      dateRange,
      hasMore: battles.length >= BATTLE_LIST_LIMIT,
      verified: ctx.streamer.verified,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
