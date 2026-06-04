import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode } from "@/lib/tiktok-verify";

// GET: return existing pending code for current user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { tiktokId: true, verificationCode: true, verified: true },
  });

  if (!streamer || streamer.verified) return NextResponse.json({});

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

  // Check if this tiktokId is claimed by another verified user
  const existingVerified = await prisma.streamer.findFirst({
    where: { tiktokId: clean, verified: true },
  });

  if (existingVerified && existingVerified.userId !== session.user.id) {
    return NextResponse.json(
      { error: "このTikTok IDは既に他のアカウントで認証済みです" },
      { status: 400 }
    );
  }

  const code = generateVerificationCode();

  await prisma.streamer.upsert({
    where: { userId: session.user.id },
    update: { tiktokId: clean, verificationCode: code, verified: false, verifiedAt: null },
    create: {
      userId: session.user.id,
      tiktokId: clean,
      verificationCode: code,
    },
  });

  return NextResponse.json({ tiktokId: clean, code });
}
