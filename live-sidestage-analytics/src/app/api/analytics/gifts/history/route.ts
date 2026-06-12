import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function getDateRange(period: string, date: string): { start: string; end: string } {
  const d = new Date(date + "T00:00:00Z");
  if (period === "week") {
    const day = d.getUTCDay();
    const daysToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() + daysToMon);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
  }
  if (period === "month") {
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const first = new Date(Date.UTC(year, month, 1));
    const last = new Date(Date.UTC(year, month + 1, 0));
    return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
  }
  return { start: date, end: date };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { id: true, verified: true },
  });

  if (!streamer?.verified) {
    return NextResponse.json({ events: [], dateRange: { start: "", end: "" }, total: { count: 0, diamonds: 0 } });
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") ?? "day";
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "500"), 1000);

  const { start, end } = getDateRange(period, date);

  const events = await prisma.gift.findMany({
    where: { streamerId: streamer.id, dayKey: { gte: start, lte: end } },
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
    },
  });

  const total = events.reduce(
    (acc, e) => ({ count: acc.count + e.repeatCount, diamonds: acc.diamonds + e.totalDiamonds }),
    { count: 0, diamonds: 0 }
  );

  return NextResponse.json({ events, dateRange: { start, end }, total });
}
