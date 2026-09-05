import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { getDateRange } from "@/lib/gift-analytics";
import { queryGiftHistory } from "@/lib/gift-history";

export async function GET(req: NextRequest, { params }: { params: { roomId: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roomId = params.roomId;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "500"), 1000);
  const startDatetime = searchParams.get("startDatetime");
  const endDatetime = searchParams.get("endDatetime");

  let giftWhere: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } };
  let dateRange: { start: string; end: string };

  if (startDatetime && endDatetime) {
    giftWhere = { receivedAt: { gte: new Date(startDatetime), lte: new Date(endDatetime) } };
    dateRange = { start: startDatetime, end: endDatetime };
  } else {
    const period = searchParams.get("period") ?? "day";
    const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const { start, end } = getDateRange(period, date);
    giftWhere = { dayKey: { gte: start, lte: end } };
    dateRange = { start, end };
  }

  const { events, total } = await queryGiftHistory(roomId, giftWhere, limit);

  return NextResponse.json({ events, dateRange, total, verified: true });
}
