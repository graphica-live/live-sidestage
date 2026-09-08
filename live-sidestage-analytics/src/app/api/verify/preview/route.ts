import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { previewTiktokAccount, formatExistenceGateError } from "@/lib/tiktok-existence";

// setup画面のTikTok ID登録確認モーダル用。フォーマット検証+実在確認だけ行い、
// DBへは一切書き込まない(確定は既存の POST /api/verify/generate が行う)。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tiktokHandle } = await req.json();
  if (typeof tiktokHandle !== "string" || tiktokHandle.trim().length === 0) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  const result = await previewTiktokAccount(tiktokHandle);
  if (!result.ok) {
    const { error, status } = formatExistenceGateError(result.code);
    return NextResponse.json({ error, code: result.code }, { status });
  }

  return NextResponse.json({
    ok: true,
    tiktokHandle: result.tiktokHandle,
    nickname: result.nickname,
    avatarUrl: result.preview.avatarUrl,
    signature: result.preview.signature,
    followingCount: result.preview.followingCount,
    followerCount: result.preview.followerCount,
  });
}
