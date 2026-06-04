import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startListener } from "@/lib/tiktok-listener";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
  });

  if (!streamer?.verified) {
    return NextResponse.json(
      { error: "TikTok IDが未認証です" },
      { status: 400 }
    );
  }

  const state = await startListener(streamer.id, streamer.tiktokId);
  return NextResponse.json({ listener: state });
}
