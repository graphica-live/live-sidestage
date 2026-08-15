import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWorkerCount, resolveWorkerForStreamer } from "@/lib/tiktok-listener";

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

  await resolveWorkerForStreamer(streamer.id, getWorkerCount());

  return NextResponse.json({
    listener: {
      streamerId: streamer.id,
      tiktokId: streamer.tiktokId,
      status: streamer.listenerStatus ?? "connecting",
      message: streamer.listenerMessage ?? "起動中(最大60秒)",
      updatedAt: streamer.listenerUpdatedAt?.toISOString() ?? new Date().toISOString(),
    },
  });
}
