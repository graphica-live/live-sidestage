import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/prisma";
import { mobileAuthResponseBody } from "@/lib/mobile-oauth";

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

  // レスポンスの形は Apple 版(`../apple/route.ts`)と共通にしてある。
  // 端末の AuthSession.fromJson は1つしかないので、ここが食い違うと片方が壊れる。
  return NextResponse.json(mobileAuthResponseBody(user));
}
