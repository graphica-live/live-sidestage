import { prisma } from "@/lib/prisma";

export function getDateRange(
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

export type GiftAnalyticsUser = {
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  giftCount: number;
  totalDiamonds: number;
  lastGiftAt: string;
};

export async function queryGifts(
  streamerId: string,
  where: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } }
): Promise<{ users: GiftAnalyticsUser[]; total: { giftCount: number; totalDiamonds: number } }> {
  const fullWhere = { streamerId, ...where };

  const grouped = await prisma.gift.groupBy({
    by: ["uniqueId"],
    where: fullWhere,
    _sum: { repeatCount: true, totalDiamonds: true },
    _max: { receivedAt: true },
  });

  if (grouped.length === 0) return { users: [], total: { giftCount: 0, totalDiamonds: 0 } };

  const profiles = await prisma.gift.findMany({
    where: { ...fullWhere, uniqueId: { in: grouped.map((g) => g.uniqueId) } },
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
    (acc, u) => ({ giftCount: acc.giftCount + u.giftCount, totalDiamonds: acc.totalDiamonds + u.totalDiamonds }),
    { giftCount: 0, totalDiamonds: 0 }
  );

  return { users, total };
}
