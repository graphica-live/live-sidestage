import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBreakdownRange, queryGiftBreakdown } from "@/lib/gift-breakdown";

// 貢献ランキングの行を展開したときに出す、送信者1人ぶんのギフト名別内訳。
// 期間の指定方法(period+date / startDatetime+endDatetime)は /api/analytics/gifts と同じ。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const uniqueId = searchParams.get("uniqueId");
  if (!uniqueId) return NextResponse.json({ error: "uniqueId is required" }, { status: 400 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { roomId: true },
  });

  if (!streamer || !streamer.roomId) {
    return NextResponse.json({
      uniqueId,
      gifts: [],
      total: { repeatCount: 0, totalDiamonds: 0 },
      coverage: { detailAvailable: false, rawFrom: null, partial: false },
      dateRange: { start: "", end: "" },
    });
  }

  const range = parseBreakdownRange(searchParams);
  if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });

  const result = await queryGiftBreakdown(streamer.roomId, uniqueId, range.where);
  return NextResponse.json({ ...result, dateRange: range.dateRange });
}
