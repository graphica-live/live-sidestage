import { NextRequest, NextResponse } from "next/server";
import { revokeRefreshTokenFamily } from "@/lib/mobile-auth";

const MAX_REFRESH_TOKEN_LENGTH = 512;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
  if (refreshToken && refreshToken.length <= MAX_REFRESH_TOKEN_LENGTH) {
    try {
      await revokeRefreshTokenFamily(refreshToken);
    } catch (err) {
      console.error("[desktop-auth] ログアウト時のrefresh token失効に失敗:", err);
    }
  }

  return NextResponse.json({ ok: true });
}