import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/prisma";
import { desktopAuthResponseBody } from "@/lib/desktop-oauth";
import { markLastActive } from "@/lib/mark-last-active";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function allowedAudiences(): string[] {
  const web = process.env.GOOGLE_CLIENT_ID?.trim();
  const ios = process.env.GOOGLE_IOS_CLIENT_ID?.trim();
  return [web, ios].filter((value): value is string => !!value);
}

export async function POST(req: NextRequest) {
  const { idToken } = await req.json();

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json({ error: "idTokenが必要です" }, { status: 400 });
  }

  const audience = allowedAudiences();
  if (audience.length === 0) {
    return NextResponse.json({ error: "Google認証が設定されていません" }, { status: 503 });
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience });
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

  const account = await prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider: "google", providerAccountId } },
    include: { user: { include: { streamer: true } } },
  });

  let user;
  if (account) {
    user = account.user;
  } else {
    const existingUser = await prisma.principal.findUnique({
      where: { email },
      include: { streamer: true, accounts: { select: { id: true }, take: 1 } },
    });

    if (existingUser && existingUser.accounts.length > 0) {
      return NextResponse.json(
        { error: "このメールアドレスは別のアカウントで使用されています" },
        { status: 409 },
      );
    }

    if (existingUser) {
      await prisma.oAuthAccount.create({
        data: { userId: existingUser.id, type: "oauth", provider: "google", providerAccountId },
      });
      user = existingUser;
    } else {
      user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.principal.create({
          data: { email, name: payload!.name ?? null, image: payload!.picture ?? null },
        });
        await tx.oAuthAccount.create({
          data: { userId: newUser.id, type: "oauth", provider: "google", providerAccountId },
        });
        return { ...newUser, streamer: null };
      });
    }
  }

  await markLastActive(user.id);
  return NextResponse.json(await desktopAuthResponseBody(user));
}