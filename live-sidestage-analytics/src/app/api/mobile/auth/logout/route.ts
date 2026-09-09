import { NextRequest, NextResponse } from "next/server";
import { revokeRefreshTokenFamily } from "@/lib/mobile-auth";

/// ログアウト。その refresh token が属する family を丸ごと失効させる。
///
/// **常に 200 を返す**(ベストエフォート)。端末側はローカルのセッションを消して先へ進むので、
/// 見つからない・既に失効済みでもエラーにしない。`refresh` と同じく `Authorization: Bearer` は
/// 要求しない(access token が切れていてもログアウトできる必要がある)。
///
/// access token は stateless なので、残り有効期間(最大1時間)は失効させられない。
/// 「即座に全アクセスを止める」用途にはならない点は仕様として受け入れている。

const MAX_REFRESH_TOKEN_LENGTH = 512;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    // 本文が壊れていてもログアウトは成立させる(端末は既にローカルを消している)。
    return NextResponse.json({ ok: true });
  }

  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
  if (refreshToken && refreshToken.length <= MAX_REFRESH_TOKEN_LENGTH) {
    try {
      await revokeRefreshTokenFamily(refreshToken);
    } catch (err) {
      console.error("[mobile-auth] ログアウト時のrefresh token失効に失敗:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
