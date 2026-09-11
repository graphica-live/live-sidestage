import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { getDateRange, queryGifts } from "@/lib/gift-analytics";
import { sanitizeAvatarUrl } from "@/lib/tiktok-profile";
import { jstDateKey } from "@/lib/overlay/day-key";
import { parseRangeQuery, parseListenerQuery, requireHistoryPlan } from "@/lib/mobile-analytics-query";
import { currentVersion } from "@/lib/realtime-sync/version-store";

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
  const { bootId, epoch, version } = currentVersion("ranking", ctx.streamer.id);

  let where: Parameters<typeof queryGifts>[2];
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

  const { users, total } = await queryGifts(ctx.streamer.roomId, ctx.streamer.id, where, listenerQuery.value);

  // queryGifts() は groupBy の結果順(順位順ではない)を返すため、
  // 配列インデックス+1がそのまま順位になるようここで明示的にソートする。
  const sorted = [...users].sort((a, b) => {
    if (a.totalDiamonds !== b.totalDiamonds) return b.totalDiamonds - a.totalDiamonds;
    if (a.giftCount !== b.giftCount) return b.giftCount - a.giftCount;
    const ah = a.tiktokHandle ?? "";
    const bh = b.tiktokHandle ?? "";
    return ah < bh ? -1 : ah > bh ? 1 : 0;
  });

  return NextResponse.json(
    {
      users: sorted.map((u) => ({ ...u, profileImageUrl: sanitizeAvatarUrl(u.profileImageUrl) })),
      dateRange,
      total,
      verified: ctx.streamer.verified,
      bootId,
      epoch,
      version,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
