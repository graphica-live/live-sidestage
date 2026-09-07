import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { addWatchedRoom } from "@/lib/worker-status";
import { formatExistenceGateError } from "@/lib/tiktok-existence";

// 管理画面から監視対象のTikTok IDを手動で追加する。Streamer登録・AgencyWatch追加と
// 同じfail-closedな実在確認を通す。追加した部屋はworkerId未割当のまま作られ、
// 各Workerのreconcile(最大30秒間隔)がハッシュ割当を拾って実際に接続する。
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

  const tiktokId = (body as { tiktokId?: unknown } | null)?.tiktokId;
  if (typeof tiktokId !== "string" || tiktokId.trim().length === 0) {
    return NextResponse.json({ error: "TikTok IDを入力してください。" }, { status: 400 });
  }

  try {
    const result = await addWatchedRoom(tiktokId);
    if (result.status === "invalid") {
      const { error, status } = formatExistenceGateError("INVALID_FORMAT");
      return NextResponse.json({ error }, { status });
    }
    if (result.status === "not_found") {
      const { error, status } = formatExistenceGateError("USER_NOT_FOUND");
      return NextResponse.json({ error }, { status });
    }
    if (result.status === "unverified") {
      const { error, status } = formatExistenceGateError("CHECK_UNVERIFIED");
      return NextResponse.json({ error }, { status });
    }
    return NextResponse.json({
      ok: true,
      roomId: result.roomId,
      tiktokId: result.tiktokId,
      created: result.created,
      nickname: result.nickname,
    });
  } catch (err) {
    console.error("[admin/workers/watch] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
