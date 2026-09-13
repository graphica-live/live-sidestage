import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { desktopAuthResponseBody } from "@/lib/desktop-oauth";
import { markLastActive } from "@/lib/mark-last-active";
import { normalizeEmail, readPassword } from "@/lib/email-auth";
import { isRateLimited, resetRateLimit } from "@/lib/rate-limit";

const LOGIN_RATE_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };
const GENERIC_ERROR = "メールアドレスまたはパスワードが正しくありません";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = readPassword(body.password);
  if (!email || !password) {
    return NextResponse.json({ error: "メールアドレスとパスワードを入力してください" }, { status: 400 });
  }

  const rateLimitKey = `desktop-email-login:${email}`;
  if (isRateLimited(rateLimitKey, LOGIN_RATE_LIMIT)) {
    return NextResponse.json(
      { error: "試行回数が上限に達しました。しばらくしてからもう一度お試しください" },
      { status: 429 },
    );
  }

  const account = await prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider: "email", providerAccountId: email } },
    select: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          password: true,
          streamer: { select: { id: true, tiktokHandle: true, verified: true } },
        },
      },
    },
  });

  if (!account || !account.user.password) {
    const existing = await prisma.principal.findUnique({
      where: { email },
      select: { accounts: { select: { provider: true } } },
    });
    if (existing?.accounts.some((a) => a.provider === "google")) {
      return NextResponse.json(
        {
          error:
            "このメールアドレスはGoogleアカウントとして登録されています。Googleでログインしてください",
        },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, account.user.password);
  if (!valid) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  resetRateLimit(rateLimitKey);
  await markLastActive(account.user.id);
  return NextResponse.json(await desktopAuthResponseBody(account.user));
}