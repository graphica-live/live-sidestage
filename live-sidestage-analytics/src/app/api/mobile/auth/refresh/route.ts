import { NextRequest, NextResponse } from "next/server";
import { rotateRefreshToken } from "@/lib/mobile-auth";

/// access token(1時間)の無言再発行。**`Authorization: Bearer` は要求しない** —
/// access token が既に切れている状態で呼ばれるのが前提で、認可は refresh token 自体が担う。
///
/// 端末は `code` を見て「強制ログアウトしてよいエラー」かを判別する。どちらも 401 だが、
/// `TOKEN_REUSE_DETECTED` は family 全体が失効済み(= 再ログイン以外に復帰手段が無い)。
///
/// 猶予期間(30秒)の内側で同じ refresh token をもう一度提示した場合は**エラーにならず
/// まったく同じペア**が返る。モバイルのメイン/背景 Isolate がほぼ同時に叩く正常系のため。

// 生の値は 32byte を base64url にしたものなので43文字。桁違いの入力は読む前に切る。
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

  const result = await rotateRefreshToken(refreshToken);

  if ("error" in result) {
    // トークンの値そのものはレスポンスにもログにも出さない。
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
