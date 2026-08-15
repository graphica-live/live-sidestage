import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWorkerCount, resolveWorkerForRoom } from "@/lib/tiktok-listener";
import { resolveRoomForStreamer } from "@/lib/tiktok-room";

// Webプロセスはリスナーを持たないため、ここでは配信者を担当Workerへ割り当てるだけ。
// 実際の接続開始は担当Workerのensure loop(最大60秒間隔)が拾う。
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
  });

  if (!streamer) {
    return NextResponse.json(
      { error: "先にTikTok IDを設定してください" },
      { status: 400 }
    );
  }

  const roomId = await resolveRoomForStreamer(streamer.id);
  await resolveWorkerForRoom(roomId, getWorkerCount());

  const room = await prisma.tiktokRoom.findUnique({
    where: { id: roomId },
    select: { listenerStatus: true, listenerMessage: true, listenerUpdatedAt: true },
  });

  return NextResponse.json({
    listener: {
      streamerId: streamer.id,
      tiktokId: streamer.tiktokId,
      status: room?.listenerStatus ?? "connecting",
      message: room?.listenerMessage ?? "起動中(最大60秒)",
      updatedAt: room?.listenerUpdatedAt?.toISOString() ?? new Date().toISOString(),
    },
  });
}
