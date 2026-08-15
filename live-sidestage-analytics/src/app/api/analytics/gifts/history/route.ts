import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDateRange } from "@/lib/gift-analytics";
import { applyGiftEdit } from "@/lib/gift-history";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { id: true, roomId: true, verified: true },
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

  let giftWhere: { roomId: string; dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } };
  let dateRange: { start: string; end: string };

  if (startDatetime && endDatetime) {
    giftWhere = { roomId: streamer.roomId, receivedAt: { gte: new Date(startDatetime), lte: new Date(endDatetime) } };
    dateRange = { start: startDatetime, end: endDatetime };
  } else {
    const period = searchParams.get("period") ?? "day";
    const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const { start, end } = getDateRange(period, date);
    giftWhere = { roomId: streamer.roomId, dayKey: { gte: start, lte: end } };
    dateRange = { start, end };
  }

  const rows = await prisma.gift.findMany({
    where: giftWhere,
    orderBy: { receivedAt: "desc" },
    take: limit,
    select: {
      id: true,
      uniqueId: true,
      nickname: true,
      profileImageUrl: true,
      giftId: true,
      giftName: true,
      giftPictureUrl: true,
      repeatCount: true,
      totalDiamonds: true,
      receivedAt: true,
      // 編集/非表示は閲覧者本人(streamer.id)のものだけを参照する。他の登録者の編集は見えない。
      edits: { where: { streamerId: streamer.id }, select: { giftName: true, totalDiamonds: true, hidden: true } },
    },
  });

  const events = rows
    .filter((row) => !row.edits[0]?.hidden)
    .map((row) => {
      const { edits, ...base } = row;
      const edit = edits[0] ? { giftName: edits[0].giftName, totalDiamonds: edits[0].totalDiamonds } : null;
      return applyGiftEdit({ ...base, edit });
    });

  const total = events.reduce(
    (acc, e) => ({ count: acc.count + e.repeatCount, diamonds: acc.diamonds + e.totalDiamonds }),
    { count: 0, diamonds: 0 }
  );

  return NextResponse.json({ events, dateRange, total, verified: streamer.verified });
}
