import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { getDateRange, queryGifts } from "@/lib/gift-analytics";

// admin専用: 一般ユーザー向け /api/analytics/gifts と違い roomId を直接指定できる
// (getAdminSession()配下、URLでroomId指定不可という既存の一般ユーザー認可は変更しない)。
// viewerStreamerId引数は現状表示に未使用のためroomIdを流用する。
export async function GET(req: NextRequest, { params }: { params: { roomId: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roomId = params.roomId;
  const { searchParams } = new URL(req.url);
  const startDatetime = searchParams.get("startDatetime");
  const endDatetime = searchParams.get("endDatetime");

  if (startDatetime && endDatetime) {
    const startDate = new Date(startDatetime);
    const endDate = new Date(endDatetime);
    const { users, total } = await queryGifts(roomId, roomId, {
      receivedAt: { gte: startDate, lte: endDate },
    });
    return NextResponse.json({
      users,
      dateRange: { start: startDatetime, end: endDatetime },
      total,
      verified: true,
    });
  }

  const period = searchParams.get("period") ?? "day";
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const { start, end } = getDateRange(period, date);

  const { users, total } = await queryGifts(roomId, roomId, { dayKey: { gte: start, lte: end } });
  return NextResponse.json({ users, dateRange: { start, end }, total, verified: true });
}
