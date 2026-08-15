import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode } from "@/lib/tiktok-verify";
import { resolveUserByMobileToken, signMobileToken } from "@/lib/mobile-auth";
import { resolveRoomForStreamer } from "@/lib/tiktok-room";

export async function POST(req: NextRequest) {
  const auth = resolveUserByMobileToken(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { tiktokId } = await req.json();
  const cleanTiktokId = String(tiktokId ?? "").replace(/^@/, "").trim();
  if (!cleanTiktokId) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    include: { streamer: true },
  });
  if (!user) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 401 });
  }

  if (user.streamer) {
    return NextResponse.json({ error: "既にTikTokアカウントが登録されています" }, { status: 409 });
  }

  // 登録は無条件で許可する(Web版と同様、他アカウントとの重複登録も可)。
  const apiKey = crypto.randomBytes(32).toString("hex");
  const streamer = await prisma.streamer.create({
    data: {
      userId: user.id,
      tiktokId: cleanTiktokId,
      verificationCode: generateVerificationCode(),
      verified: true,
      verifiedAt: new Date(),
      apiKey,
    },
  });

  // 同じtiktokIdを共有するTiktokRoomへ紐付ける。
  await resolveRoomForStreamer(streamer.id);

  const token = signMobileToken({ userId: user.id, streamerId: streamer.id });

  return NextResponse.json(
    {
      token,
      streamer: {
        id: streamer.id,
        tiktokId: streamer.tiktokId,
        verified: streamer.verified,
        apiKey: streamer.apiKey,
      },
    },
    { status: 201 }
  );
}
