import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRecentUnacknowledgedMerge, acknowledgeMergeLog } from "@/lib/tiktok-id-migration";

// TikTok ID自動合流の事後通知バナー(Phase 3/4)。GETで直近の未読ログを、
// POSTで閉じる操作の既読化を扱う。

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!streamer) return NextResponse.json({ recentMerge: null });

  const recentMerge = await getRecentUnacknowledgedMerge(streamer.id);
  return NextResponse.json({ recentMerge });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!streamer) return NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const logId = body?.logId;
  if (typeof logId !== "string" || !logId) {
    return NextResponse.json({ error: "logId が必要です" }, { status: 400 });
  }

  await acknowledgeMergeLog(streamer.id, logId);
  return NextResponse.json({ ok: true });
}
