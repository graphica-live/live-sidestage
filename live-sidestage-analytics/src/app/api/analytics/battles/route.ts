import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { queryBattles, jstDateRangeToUtc } from "@/lib/battle-history";
import { backfillHostUserIds } from "@/lib/tiktok-host-id";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { id: true, roomId: true, verified: true, room: { select: { tiktokId: true, hostUserId: true } } },
  });

  if (!streamer || !streamer.roomId) {
    return NextResponse.json({ battles: [], dateRange: { start: "", end: "" }, verified: false });
  }

  // hostUserId(TikTokの数値userId)はfill-onceの不変値で、スコア表示の消去法に要る。
  // avatarキャッシュと同じ「閲覧契機で引く」パターン: レスポンスはブロックしない。
  if (streamer.room && streamer.room.hostUserId === null) {
    void backfillHostUserIds([streamer.room.tiktokId], { maxPerRun: 1 }).catch(() => {});
  }

  const { searchParams } = new URL(req.url);
  const startDatetime = searchParams.get("startDatetime");
  const endDatetime = searchParams.get("endDatetime");

  let range: { start: Date; end: Date };
  let dateRange: { start: string; end: string };

  if (startDatetime && endDatetime) {
    range = { start: new Date(startDatetime), end: new Date(endDatetime) };
    dateRange = { start: startDatetime, end: endDatetime };
  } else {
    const period = searchParams.get("period") ?? "day";
    const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    range = jstDateRangeToUtc(period, date);
    dateRange = { start: range.start.toISOString(), end: range.end.toISOString() };
  }

  const { battles } = await queryBattles(streamer.roomId, streamer.id, range);
  return NextResponse.json({ battles, dateRange, verified: streamer.verified });
}
