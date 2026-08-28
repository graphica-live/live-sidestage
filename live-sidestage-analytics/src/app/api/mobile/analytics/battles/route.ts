import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { queryBattles, jstDateRangeToUtc } from "@/lib/battle-history";
import { getDateRange } from "@/lib/gift-analytics";
import { backfillHostUserIds } from "@/lib/tiktok-host-id";
import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/overlay/day-key";
import { parsePeriodQuery } from "@/lib/mobile-analytics-query";

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
  const query = parsePeriodQuery(searchParams, jstDateKey());
  if (!query.ok) return query.response;
  const { period, date } = query.value;

  // hostUserId(TikTokの数値userId)はfill-onceの不変値で、スコア表示の消去法に要る。
  // Web版(analytics/battles/route.ts)と同じくレスポンスはブロックしない。
  const room = await prisma.tiktokRoom.findUnique({
    where: { id: ctx.streamer.roomId },
    select: { tiktokId: true, hostUserId: true },
  });
  if (room && room.hostUserId === null) {
    void backfillHostUserIds([room.tiktokId], { maxPerRun: 1 }).catch(() => {});
  }

  const range = jstDateRangeToUtc(period, date);
  const { battles } = await queryBattles(ctx.streamer.roomId, ctx.streamer.id, range);
  const { start, end } = getDateRange(period, date);

  return NextResponse.json(
    {
      battles,
      dateRange: { start, end },
      hasMore: battles.length >= BATTLE_LIST_LIMIT,
      verified: ctx.streamer.verified,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
