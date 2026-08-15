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

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { id: true, roomId: true },
  });

  if (!streamer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!streamer.roomId) return NextResponse.json({ deleted: 0 });

  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") ?? "day";
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const { start, end } = getDateRange(period, date);

  // ギフトデータは同じTikTok IDの登録者全員で共有されているため、実削除すると他の登録者の
  // 履歴も消えてしまう。そのため実際にはGiftを削除せず、自分の表示からのみ除外する
  // 個人用フラグ(GiftEdit.hidden)を立てる。
  const gifts = await prisma.gift.findMany({
    where: { roomId: streamer.roomId, dayKey: { gte: start, lte: end } },
    select: { id: true, giftName: true, totalDiamonds: true },
  });

  await Promise.all(
    gifts.map((gift) =>
      prisma.giftEdit.upsert({
        where: { giftId_streamerId: { giftId: gift.id, streamerId: streamer.id } },
        update: { hidden: true },
        create: {
          giftId: gift.id,
          streamerId: streamer.id,
          giftName: gift.giftName,
          totalDiamonds: gift.totalDiamonds,
          hidden: true,
        },
      })
    )
  );

  return NextResponse.json({ deleted: gifts.length });
}
