import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getListenerStatus } from "@/lib/tiktok-listener";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { principalId: session.user.id },
    select: {
      id: true,
      tiktokHandle: true,
      roomId: true,
      room: { select: { listenerStatus: true, listenerMessage: true, listenerUpdatedAt: true } },
    },
  });

  // verified未完了でもライブ接続は動いているため、ステータス表示自体はブロックしない
  // (コイン数/ギフト履歴のすりガラス表示とは別軸)。
  if (!streamer || !streamer.roomId) {
    return NextResponse.json({ listener: null });
  }

  const live = getListenerStatus(streamer.roomId);

  // In-memory state (same process) takes priority.
  // Fall back to DB-persisted state (handles multi-worker / cross-process scenarios).
  const listener = live
    ? { streamerId: streamer.id, tiktokHandle: streamer.tiktokHandle, status: live.status, message: live.message, updatedAt: live.updatedAt }
    : streamer.room?.listenerStatus
    ? {
        streamerId: streamer.id,
        tiktokHandle: streamer.tiktokHandle,
        status: streamer.room.listenerStatus,
        message: streamer.room.listenerMessage ?? "停止中",
        updatedAt: streamer.room.listenerUpdatedAt?.toISOString() ?? new Date().toISOString(),
      }
    : {
        streamerId: streamer.id,
        tiktokHandle: streamer.tiktokHandle,
        status: "idle",
        message: "停止中",
        updatedAt: new Date().toISOString(),
      };

  return NextResponse.json({ listener });
}
