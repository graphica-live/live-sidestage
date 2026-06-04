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

  type RawRow = {
    uniqueId: string;
    nickname: string;
    profileImageUrl: string | null;
    giftCount: bigint;
    totalDiamonds: bigint;
    lastGiftAt: Date;
  };

  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      unique_id AS "uniqueId",
      (
        SELECT nickname FROM gifts g2
        WHERE g2.unique_id = g.unique_id
          AND g2.streamer_id = ${streamer.id}
        ORDER BY received_at DESC
        LIMIT 1
      ) AS nickname,
      (
        SELECT profile_image_url FROM gifts g2
        WHERE g2.unique_id = g.unique_id
          AND g2.streamer_id = ${streamer.id}
        ORDER BY received_at DESC
        LIMIT 1
      ) AS "profileImageUrl",
      SUM(repeat_count)::bigint AS "giftCount",
      SUM(total_diamonds)::bigint AS "totalDiamonds",
      MAX(received_at) AS "lastGiftAt"
    FROM gifts g
    WHERE streamer_id = ${streamer.id}
      AND day_key >= ${start}
      AND day_key <= ${end}
    GROUP BY unique_id
  `;

  const users = rows.map((r) => ({
    uniqueId: r.uniqueId,
    nickname: r.nickname ?? r.uniqueId,
    profileImageUrl: r.profileImageUrl ?? null,
    giftCount: Number(r.giftCount),
    totalDiamonds: Number(r.totalDiamonds),
    lastGiftAt: r.lastGiftAt.toISOString(),
  }));

  const total = users.reduce(
    (acc, u) => ({
      giftCount: acc.giftCount + u.giftCount,
      totalDiamonds: acc.totalDiamonds + u.totalDiamonds,
    }),
    { giftCount: 0, totalDiamonds: 0 }
  );

  return NextResponse.json({ users, dateRange: { start, end }, total });
}
