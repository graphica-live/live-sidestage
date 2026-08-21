import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
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

  let roomId: string | undefined;

  if (searchParams.get("all")) {
    // ?all=1 は全部屋のギフトログを返す。事務所の監視対象(Streamerが誰も居ない部屋)の
    // ログも含まれるため、セッション経由の場合は管理者に限定する。
    if (session && !isAdminEmail(session.user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (session) {
    const streamer = await prisma.streamer.findUnique({
      where: { userId: session.user.id },
      select: { roomId: true },
    });
    roomId = streamer?.roomId ?? undefined;
  }
  // token access without ?all=1 returns all logs

  const log = getGiftLog(roomId);

  return NextResponse.json({ count: log.length, log });
}
