import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { queryBattles, jstDateRangeToUtc } from "@/lib/battle-history";
import { getDateRange } from "@/lib/gift-analytics";
import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/overlay/day-key";
import { parseRangeQuery, parseListenerQuery, requireHistoryPlan } from "@/lib/mobile-analytics-query";
import { currentVersion } from "@/lib/realtime-sync/version-store";

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
  const listenerQuery = parseListenerQuery(searchParams);
  if (!listenerQuery.ok) return listenerQuery.response;

  const planDenied = await requireHistoryPlan(ctx.streamer.principalId, {
    range: query.value,
    listenerQuery: listenerQuery.value,
  });
  if (planDenied) return planDenied;

  // version取得をDBクエリの前に行う(race condition対策)。
  // version取得後にDB保存されたイベントは「snapshotに含まれないが、
  // 後続pushでより大きいversionとして届く」形になり欠落しない。
  const { bootId, version } = currentVersion("battle-history", ctx.streamer.id);

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

  const { battles, hasMore } = await queryBattles(ctx.streamer.roomId, ctx.streamer.id, range, {
    listenerQuery: listenerQuery.value,
  });

  return NextResponse.json(
    {
      battles,
      dateRange,
      hasMore,
      verified: ctx.streamer.verified,
      bootId,
      version,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
