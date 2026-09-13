import { NextRequest, NextResponse } from "next/server";
import { rotateDesktopRefreshToken } from "@/lib/desktop-auth";

const MAX_REFRESH_TOKEN_LENGTH = 512;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
  if (!refreshToken || refreshToken.length > MAX_REFRESH_TOKEN_LENGTH) {
    return NextResponse.json({ error: "refreshTokenが必要です" }, { status: 400 });
  }

  const result = await rotateDesktopRefreshToken(refreshToken);

  if ("error" in result) {
    return NextResponse.json(
      {
        error:
          result.error === "TOKEN_REUSE_DETECTED"
            ? "セッションが無効化されました。もう一度ログインしてください"
            : "リフレッシュトークンが無効です",
        code: result.error,
      },
      { status: 401 },
    );
  }

  return NextResponse.json({ token: result.accessToken, refreshToken: result.refreshToken });
}