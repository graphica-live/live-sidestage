import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stopListener } from "@/lib/tiktok-listener";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
  });

  if (!streamer) {
    return NextResponse.json({ error: "Streamer not found" }, { status: 404 });
  }

  await stopListener(streamer.id);
  return NextResponse.json({ ok: true });
}
