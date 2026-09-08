import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { queryBattles, jstDateRangeToUtc } from "@/lib/battle-history";

export async function GET(req: NextRequest, { params }: { params: { roomId: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roomId = params.roomId;
  const room = await prisma.tiktokRoom.findUnique({
    where: { id: roomId },
    select: { tiktokHandle: true, hostTiktokUid: true },
  });
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

  const { battles } = await queryBattles(roomId, roomId, range);
  return NextResponse.json({ battles, dateRange, verified: true });
}
