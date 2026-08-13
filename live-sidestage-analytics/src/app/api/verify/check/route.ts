import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyTikTokProfile } from "@/lib/tiktok-verify";
import { getWorkerCount, resolveWorkerForStreamer } from "@/lib/tiktok-listener";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
  });

  if (!streamer) {
    return NextResponse.json(
      { ok: false, error: "先にTikTok IDを設定してください" },
      { status: 400 }
    );
  }

  if (streamer.verified) {
    return NextResponse.json({ ok: true });
  }

  const result = await verifyTikTokProfile(
    streamer.tiktokId,
    streamer.verificationCode
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  await prisma.streamer.update({
    where: { id: streamer.id },
    data: { verified: true, verifiedAt: new Date() },
  });

  // Webプロセスはリスナーを持たないため担当Workerへの割当のみ行う。
  // 実際の接続開始は担当Workerのensure loop(最大60秒間隔)が拾う。
  resolveWorkerForStreamer(streamer.id, getWorkerCount()).catch((err) =>
    console.error("[verify] worker assignment failed:", err)
  );

  return NextResponse.json({ ok: true });
}
