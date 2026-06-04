import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getListenerStatus } from "@/lib/tiktok-listener";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
  });

  if (!streamer?.verified) {
    return NextResponse.json({ listener: null });
  }

  const live = getListenerStatus(streamer.id);

  const listener = live ?? {
    streamerId: streamer.id,
    tiktokId: streamer.tiktokId,
    status: "idle",
    message: "停止中",
    updatedAt: new Date().toISOString(),
  };

  return NextResponse.json({ listener });
}
