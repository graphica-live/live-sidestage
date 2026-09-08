import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { queryGiftBreakdown } from "@/lib/gift-breakdown";
import { getDateRange } from "@/lib/gift-analytics";
import { parseRangeQuery, requireHistoryPlan } from "@/lib/mobile-analytics-query";
import { jstDateKey } from "@/lib/overlay/day-key";

// 貢献タブ(モバイル)の行を展開したときに出す、送信者1人ぶんのギフト名別内訳。
// Web版 /api/analytics/gifts/breakdown と同じ src/lib/gift-breakdown.ts を使うが、
// 認証はNextAuthセッションでなくモバイルJWT(resolveMobileAnalyticsContext)。
// 期間の解釈は貢献/ギフト履歴/バトル履歴と同じ parseRangeQuery を通し、
// month/year/カスタム範囲は同じ requireHistoryPlan でプラン判定する
// (breakdownは単独で叩けるエンドポイントなので、ranking側のゲートに依存しない)。
const buildUnregisteredResponse = () =>
  NextResponse.json({
    tiktokUid: "",
    gifts: [],
    total: { repeatCount: 0, totalDiamonds: 0 },
    coverage: { detailAvailable: false, rawFrom: null, partial: false },
    dateRange: { start: "", end: "" },
  });

export async function GET(req: NextRequest) {
  const ctx = await resolveMobileAnalyticsContext(req, buildUnregisteredResponse);
  if (!ctx.ok) return ctx.response;

  const { searchParams } = new URL(req.url);
  const tiktokUid = searchParams.get("tiktokUid");
  if (!tiktokUid) return NextResponse.json({ error: "tiktokUid is required" }, { status: 400 });

  const query = parseRangeQuery(searchParams, jstDateKey());
  if (!query.ok) return query.response;

  const planDenied = await requireHistoryPlan(ctx.streamer.userId, { range: query.value, listenerQuery: null });
  if (planDenied) return planDenied;

  let where: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } };
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

  const result = await queryGiftBreakdown(ctx.streamer.roomId, tiktokUid, where);
  return NextResponse.json(
    { ...result, dateRange },
    { headers: { "Cache-Control": "no-store" } }
  );
}
