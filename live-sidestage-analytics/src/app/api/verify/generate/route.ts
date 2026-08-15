import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode } from "@/lib/tiktok-verify";
import { resolveRoomForStreamer } from "@/lib/tiktok-room";

// GET: return existing pending code for current user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { tiktokId: true, verificationCode: true, verified: true },
  });

  if (!streamer) return NextResponse.json({});

  if (streamer.verified) {
    return NextResponse.json({ verified: true, tiktokId: streamer.tiktokId });
  }

  return NextResponse.json({
    tiktokId: streamer.tiktokId,
    code: streamer.verificationCode,
  });
}

// POST: create or update verification code for the given TikTok ID
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tiktokId } = await req.json();
  const clean = String(tiktokId || "")
    .replace(/^@/, "")
    .trim();

  if (!clean) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  // 登録は無条件で許可する(他アカウントとの重複登録も可)。
  // 実データ(コイン数・ギフト履歴)へのアクセスはBIO認証完了まで別途ブロックされる。
  const code = generateVerificationCode();

  const streamer = await prisma.streamer.upsert({
    where: { userId: session.user.id },
    update: { tiktokId: clean, verificationCode: code, verified: false, verifiedAt: null },
    create: {
      userId: session.user.id,
      tiktokId: clean,
      verificationCode: code,
    },
  });

  // 同じtiktokIdを共有するTiktokRoomへ即座に紐付ける(Workerのensure loopを待たずに
  // オーバーレイ/ギフトデータ共有を反映するため)。
  await resolveRoomForStreamer(streamer.id);

  return NextResponse.json({ tiktokId: clean, code });
}
