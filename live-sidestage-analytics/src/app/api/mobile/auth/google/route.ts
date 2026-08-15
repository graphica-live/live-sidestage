import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export async function POST(req: NextRequest) {
  const { idToken } = await req.json();

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json({ error: "idTokenが必要です" }, { status: 400 });
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return NextResponse.json({ error: "Google認証トークンの検証に失敗しました" }, { status: 401 });
  }

  if (!payload?.sub || !payload.email) {
    return NextResponse.json({ error: "不正なトークンです" }, { status: 401 });
  }
  if (payload.email_verified === false) {
    return NextResponse.json({ error: "メールアドレスが未確認です" }, { status: 401 });
  }

  const providerAccountId = payload.sub;
  const email = payload.email.toLowerCase();

  const account = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: "google", providerAccountId } },
    include: { user: { include: { streamer: true } } },
  });

  let user;
  if (account) {
    user = account.user;
  } else {
    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { streamer: true },
    });

    if (existingUser) {
      await prisma.account.create({
        data: { userId: existingUser.id, type: "oauth", provider: "google", providerAccountId },
      });
      user = existingUser;
    } else {
      user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: { email, name: payload!.name ?? null, image: payload!.picture ?? null },
        });
        await tx.account.create({
          data: { userId: newUser.id, type: "oauth", provider: "google", providerAccountId },
        });
        return { ...newUser, streamer: null };
      });
    }
  }

  const token = signMobileToken({ userId: user.id, streamerId: user.streamer?.id });

  return NextResponse.json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
    streamer: user.streamer
      ? {
          id: user.streamer.id,
          tiktokId: user.streamer.tiktokId,
          verified: user.streamer.verified,
          apiKey: user.streamer.apiKey,
        }
      : null,
    onboardingRequired: !user.streamer,
  });
}
