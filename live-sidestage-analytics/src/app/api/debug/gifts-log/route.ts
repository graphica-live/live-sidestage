import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getGiftLog } from "@/lib/tiktok-listener";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Token-based access (for direct API calls / Claude Code)
  const token = searchParams.get("token");
  const envToken = process.env.GIFT_LOG_TOKEN;
  const tokenValid = envToken && token === envToken;

  // Session-based access (for browser)
  const session = tokenValid ? null : await getServerSession(authOptions);

  if (!tokenValid && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let streamerId: string | undefined;

  if (!searchParams.get("all")) {
    if (session) {
      const streamer = await prisma.streamer.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      });
      streamerId = streamer?.id;
    }
    // token access without ?all=1 returns all logs
  }

  const log = getGiftLog(streamerId);

  return NextResponse.json({ count: log.length, log });
}
