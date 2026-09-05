import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDateRange } from "@/lib/gift-analytics";
import { queryGiftHistory } from "@/lib/gift-history";
import {
  clampGiftHistoryDayRange,
  clampGiftHistoryDatetimeRange,
} from "@/lib/gift-history-range";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { roomId: true, verified: true },
  });

  if (!streamer || !streamer.roomId) {
    return NextResponse.json({
      events: [],
      dateRange: { start: "", end: "" },
      total: { count: 0, diamonds: 0 },
      verified: false,
    });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "500"), 1000);
  const startDatetime = searchParams.get("startDatetime");
  const endDatetime = searchParams.get("endDatetime");

  let giftWhere: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } };
  let dateRange: { start: string; end: string };

  // 明細は90日で削除されるので、参照期間もそこへ切り詰める(period=year・任意の範囲指定)。
  if (startDatetime && endDatetime) {
    const clamped = clampGiftHistoryDatetimeRange({
      start: new Date(startDatetime),
      end: new Date(endDatetime),
    });
    giftWhere = { receivedAt: { gte: clamped.start, lte: clamped.end } };
    dateRange = { start: clamped.start.toISOString(), end: clamped.end.toISOString() };
  } else {
    const period = searchParams.get("period") ?? "day";
    const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const clamped = clampGiftHistoryDayRange(getDateRange(period, date));
    giftWhere = { dayKey: { gte: clamped.start, lte: clamped.end } };
    dateRange = { start: clamped.start, end: clamped.end };
  }

  const { events, total } = await queryGiftHistory(streamer.roomId, giftWhere, limit);

  return NextResponse.json({ events, dateRange, total, verified: streamer.verified });
}
