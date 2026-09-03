import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDateRange, queryGifts } from "@/lib/gift-analytics";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { id: true, roomId: true, verified: true },
  });

  if (!streamer || !streamer.roomId) {
    return NextResponse.json({ users: [], total: { giftCount: 0, totalDiamonds: 0 }, verified: false });
  }

  const { searchParams } = new URL(req.url);
  const startDatetime = searchParams.get("startDatetime");
  const endDatetime = searchParams.get("endDatetime");

  // コイン数の実データはverified未完了でも取得する。表示のブロック(すりガラス化)はフロント側の責務。
  if (startDatetime && endDatetime) {
    const startDate = new Date(startDatetime);
    const endDate = new Date(endDatetime);
    const { users, total } = await queryGifts(streamer.roomId, streamer.id, {
      receivedAt: { gte: startDate, lte: endDate },
    });
    return NextResponse.json({
      users,
      dateRange: { start: startDatetime, end: endDatetime },
      total,
      verified: streamer.verified,
    });
  }

  const period = searchParams.get("period") ?? "day";
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const { start, end } = getDateRange(period, date);

  const { users, total } = await queryGifts(streamer.roomId, streamer.id, { dayKey: { gte: start, lte: end } });
  return NextResponse.json({ users, dateRange: { start, end }, total, verified: streamer.verified });
}
