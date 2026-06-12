import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function getDateRange(
  period: string,
  date: string
): { start: string; end: string } {
  const d = new Date(date + "T00:00:00Z");

  if (period === "week") {
    const day = d.getUTCDay();
    const daysToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() + daysToMon);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    return {
      start: mon.toISOString().slice(0, 10),
      end: sun.toISOString().slice(0, 10),
    };
  }

  if (period === "month") {
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const first = new Date(Date.UTC(year, month, 1));
    const last = new Date(Date.UTC(year, month + 1, 0));
    return {
      start: first.toISOString().slice(0, 10),
      end: last.toISOString().slice(0, 10),
    };
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
    return NextResponse.json({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") ?? "day";
  const date =
    searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  const { start, end } = getDateRange(period, date);

  // Group by uniqueId using ORM to avoid raw SQL column-name issues
  const grouped = await prisma.gift.groupBy({
    by: ["uniqueId"],
    where: {
      streamerId: streamer.id,
      dayKey: { gte: start, lte: end },
    },
    _sum: { repeatCount: true, totalDiamonds: true },
    _max: { receivedAt: true },
  });

  if (grouped.length === 0) {
    return NextResponse.json({
      users: [],
      dateRange: { start, end },
      total: { giftCount: 0, totalDiamonds: 0 },
    });
  }

  // Fetch latest nickname + avatar per uniqueId
  const profiles = await prisma.gift.findMany({
    where: {
      streamerId: streamer.id,
      uniqueId: { in: grouped.map((g) => g.uniqueId) },
    },
    orderBy: { receivedAt: "desc" },
    distinct: ["uniqueId"],
    select: { uniqueId: true, nickname: true, profileImageUrl: true },
  });

  const profileMap = new Map(profiles.map((p) => [p.uniqueId, p]));

  const users = grouped.map((g) => {
    const profile = profileMap.get(g.uniqueId);
    return {
      uniqueId: g.uniqueId,
      nickname: profile?.nickname ?? g.uniqueId,
      profileImageUrl: profile?.profileImageUrl ?? null,
      giftCount: g._sum.repeatCount ?? 0,
      totalDiamonds: g._sum.totalDiamonds ?? 0,
      lastGiftAt: (g._max.receivedAt ?? new Date()).toISOString(),
    };
  });

  const total = users.reduce(
    (acc, u) => ({
      giftCount: acc.giftCount + u.giftCount,
      totalDiamonds: acc.totalDiamonds + u.totalDiamonds,
    }),
    { giftCount: 0, totalDiamonds: 0 }
  );

  return NextResponse.json({ users, dateRange: { start, end }, total });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  if (!streamer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const { count } = await prisma.gift.deleteMany({
    where: { streamerId: streamer.id, dayKey: date },
  });

  return NextResponse.json({ deleted: count });
}
