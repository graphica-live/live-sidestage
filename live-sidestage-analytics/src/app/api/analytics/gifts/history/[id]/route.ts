import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseGiftEditInput } from "@/lib/gift-history";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { id: true, roomId: true },
  });
  if (!streamer) return NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 });

  const { id } = await params;
  const gift = await prisma.gift.findUnique({
    where: { id },
    select: { id: true, roomId: true, giftName: true, totalDiamonds: true },
  });
  // 同じTikTok IDの登録者(=同じroomId)であれば編集可能。編集内容は編集した本人にしか見えない。
  if (!gift || !streamer.roomId || gift.roomId !== streamer.roomId) {
    return NextResponse.json({ error: "ギフトが見つかりません。" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const input = parseGiftEditInput(body);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }
  const { giftName, totalDiamonds } = input;

  const edit = await prisma.giftEdit.upsert({
    where: { giftId_streamerId: { giftId: gift.id, streamerId: streamer.id } },
    create: { giftId: gift.id, streamerId: streamer.id, giftName, totalDiamonds },
    update: { giftName, totalDiamonds },
    select: { giftName: true, totalDiamonds: true },
  });

  return NextResponse.json({ id: gift.id, giftName: edit.giftName, totalDiamonds: edit.totalDiamonds, edited: true });
}
