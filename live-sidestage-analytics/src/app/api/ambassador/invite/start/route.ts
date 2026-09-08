import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonicalOrigin } from "@/lib/canonical-origin";
import {
  AMBASSADOR_INVITE_COOKIE,
  AMBASSADOR_INVITE_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/ambassador/invite-cookie";

// 招待ページ(/invite/ambassador/[token])の「Googleでサインアップ」リンク先。
// 有効な招待ならCookieへtokenを積んでからGoogleサインインへ流す。
// 実際の招待消費・Ambassador作成は authOptions.events.createUser(src/lib/auth.ts)が
// 新規Userの作成が確定した時点で行う(ここでは事前検証と受け渡しだけ)。
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const baseUrl = canonicalOrigin("analytics");

  const invite = token
    ? await prisma.ambassadorInvite.findUnique({
        where: { token },
        select: { usedAt: true, expiresAt: true },
      })
    : null;

  const valid = invite && invite.usedAt === null && invite.expiresAt > new Date();
  if (!valid) {
    return NextResponse.redirect(`${baseUrl}/invite/ambassador/${encodeURIComponent(token)}?error=invalid`);
  }

  const signInUrl = new URL(`${baseUrl}/api/auth/signin/google`);
  signInUrl.searchParams.set("callbackUrl", `${baseUrl}/dashboard`);

  const res = NextResponse.redirect(signInUrl);
  res.cookies.set(AMBASSADOR_INVITE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: AMBASSADOR_INVITE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
