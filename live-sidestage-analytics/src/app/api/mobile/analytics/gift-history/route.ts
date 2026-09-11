import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { getDateRange } from "@/lib/gift-analytics";
import { queryGiftHistory } from "@/lib/gift-history";
import { sanitizeAvatarUrl } from "@/lib/tiktok-profile";
import { jstDateKey } from "@/lib/overlay/day-key";
import { parseRangeQuery, parseLimit, parseListenerQuery, requireHistoryPlan } from "@/lib/mobile-analytics-query";
import {
  clampGiftHistoryDayRange,
  clampGiftHistoryDatetimeRange,
} from "@/lib/gift-history-range";
import { currentVersion } from "@/lib/realtime-sync/version-store";

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

  const planDenied = await requireHistoryPlan(ctx.streamer.principalId, {
    range: query.value,
    listenerQuery: listenerQuery.value,
  });
  if (planDenied) return planDenied;

  // version取得をDBクエリの前に行う(race condition対策)。
  // version取得後にDB保存されたイベントは「snapshotに含まれないが、
  // 後続pushでより大きいversionとして届く」形になり欠落しない。
  const { bootId, version } = currentVersion("gift-history", ctx.streamer.id);

  let where: Parameters<typeof queryGiftHistory>[1];
  let dateRange: { start: string; end: string };
  // 明細は90日で削除されるので、参照期間もそこへ切り詰める(period=year・任意の範囲指定)。
  // 集計系(貢献ランキング)は長期ロールアップで賄えるので parseRangeQuery 側の
  // MAX_RANGE_DAYS(366)はそのまま。ここは履歴一覧だけの上限。
  if (query.value.mode === "custom") {
    const clamped = clampGiftHistoryDatetimeRange(query.value);
    where = { receivedAt: { gte: clamped.start, lte: clamped.end } };
    dateRange = { start: clamped.start.toISOString(), end: clamped.end.toISOString() };
  } else {
    const clamped = clampGiftHistoryDayRange(getDateRange(query.value.period, query.value.date));
    where = { dayKey: { gte: clamped.start, lte: clamped.end } };
    dateRange = { start: clamped.start, end: clamped.end };
  }

  const { events, total, hasMore } = await queryGiftHistory(
    ctx.streamer.roomId,
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
      bootId,
      version,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
