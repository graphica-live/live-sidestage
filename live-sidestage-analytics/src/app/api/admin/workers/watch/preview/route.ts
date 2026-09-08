import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { previewTiktokAccount, formatExistenceGateError } from "@/lib/tiktok-existence";

// 監視対象IDを実際に追加する前の確認モーダル用。フォーマット検証+実在確認だけ行い、
// DBへは一切書き込まない(確定は既存の POST /api/admin/workers/watch が行う)。
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const tiktokHandle = (body as { tiktokHandle?: unknown } | null)?.tiktokHandle;
  if (typeof tiktokHandle !== "string" || tiktokHandle.trim().length === 0) {
    return NextResponse.json({ error: "TikTok IDを入力してください。" }, { status: 400 });
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
