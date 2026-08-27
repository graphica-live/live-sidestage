import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/overlay/day-key";
import { emitOverlayUpdate } from "@/lib/overlay/emit";

// 本日のLike数一覧(=Like貢献通知の累計とも共有)をリセットする。
// LikeTallyはroomId軸で共有されるため、同じTikTokアカウントを登録している
// 他の配信者にも影響する(設定UI側で注意書き済み)。
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({ where: { userId: session.user.id }, select: { id: true, roomId: true } });
  if (!streamer) return NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 });
  if (!streamer.roomId) return NextResponse.json({ error: "TikTok IDが未登録です。" }, { status: 400 });

  await prisma.likeTally.deleteMany({ where: { roomId: streamer.roomId, dayKey: jstDateKey() } });

  await Promise.all([
    emitOverlayUpdate(streamer.id, "tap-list"),
    emitOverlayUpdate(streamer.id, "like-contribution"),
  ]);

  return NextResponse.json({ ok: true });
}
