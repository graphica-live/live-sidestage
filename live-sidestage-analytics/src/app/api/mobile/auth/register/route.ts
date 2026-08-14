import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode } from "@/lib/tiktok-verify";
import { signMobileToken } from "@/lib/mobile-auth";

export async function POST(req: NextRequest) {
  const { name, email, password, tiktokId } = await req.json();

  if (!email || !password || !name || !tiktokId) {
    return NextResponse.json({ error: "全項目を入力してください" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "パスワードは8文字以上にしてください" },
      { status: 400 }
    );
  }

  const cleanTiktokId = String(tiktokId).replace(/^@/, "").trim();
  if (!cleanTiktokId) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json(
      { error: "このメールアドレスは既に登録されています" },
      { status: 400 }
    );
  }

  const existingStreamer = await prisma.streamer.findUnique({ where: { tiktokId: cleanTiktokId } });
  if (existingStreamer) {
    return NextResponse.json(
      { error: "このTikTok IDは既に登録されています" },
      { status: 400 }
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const apiKey = crypto.randomBytes(32).toString("hex");

  const { user, streamer } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email, password: hashedPassword },
    });

    const streamer = await tx.streamer.create({
      data: {
        userId: user.id,
        tiktokId: cleanTiktokId,
        verificationCode: generateVerificationCode(),
        verified: true,
        verifiedAt: new Date(),
        apiKey,
      },
    });

    return { user, streamer };
  });

  const token = signMobileToken({ userId: user.id, streamerId: streamer.id });

  return NextResponse.json(
    {
      token,
      user: { id: user.id, name: user.name, email: user.email },
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
