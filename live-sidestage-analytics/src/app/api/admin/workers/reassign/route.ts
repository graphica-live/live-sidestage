import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { reassignRoomWorker, notifyWorkersOfManualReassign, parseWorkerInternalUrls } from "@/lib/worker-status";

// 管理画面から特定の部屋(TiktokRoom)の担当 worker を手動で切り替える。
// worker-guardian の自動フェイルオーバーとは独立の、人間による即時操作用。
//
// expectedWorkerId は「画面に表示されていた時点の担当」。渡さなければ楽観排他を取らず、
// worker-guardian が同時に動かした直後の上書きに気づけないため、UI からは必ず渡す。
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

  const parsed = body as { roomId?: unknown; toWorkerIndex?: unknown; expectedWorkerId?: unknown } | null;
  const roomId = parsed?.roomId;
  const toWorkerIndex = parsed?.toWorkerIndex;
  const expectedWorkerIdRaw = parsed?.expectedWorkerId;
  if (typeof roomId !== "string" || roomId.length === 0) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }
  if (typeof toWorkerIndex !== "number" || !Number.isInteger(toWorkerIndex)) {
    return NextResponse.json({ error: "toWorkerIndex must be an integer" }, { status: 400 });
  }
  if (
    expectedWorkerIdRaw !== null &&
    (typeof expectedWorkerIdRaw !== "number" || !Number.isInteger(expectedWorkerIdRaw))
  ) {
    return NextResponse.json({ error: "expectedWorkerId must be an integer or null" }, { status: 400 });
  }
  const expectedWorkerId: number | null = expectedWorkerIdRaw ?? null;

  const rawWorkerCount = Number(process.env.WORKER_COUNT);
  const workerCount = Number.isInteger(rawWorkerCount) && rawWorkerCount >= 1 ? rawWorkerCount : null;
  if (workerCount == null) {
    return NextResponse.json({ error: "WORKER_COUNT is not configured properly" }, { status: 500 });
  }
  if (toWorkerIndex < 0 || toWorkerIndex >= workerCount) {
    return NextResponse.json(
      { error: `toWorkerIndex must be between 0 and ${workerCount - 1}` },
      { status: 400 }
    );
  }

  try {
    const result = await reassignRoomWorker(
      roomId,
      toWorkerIndex,
      workerCount,
      expectedWorkerId,
      session.user.email ?? null
    );
    if (result.status === "not_found") {
      return NextResponse.json({ error: "room not found" }, { status: 404 });
    }
    if (result.status === "conflict") {
      return NextResponse.json(
        {
          error: "担当workerが画面表示時点から変わっている。再読み込みしてから移動し直す",
          actualWorkerId: result.actualWorkerId,
        },
        { status: 409 }
      );
    }
    // fire-and-forget: レスポンスは待たない。届かなくても最大30秒のreconcile周期へ自然に劣化する。
    notifyWorkersOfManualReassign({
      fromWorker: result.fromWorker,
      toWorker: toWorkerIndex,
      urls: parseWorkerInternalUrls(process.env.WORKER_INTERNAL_URLS),
      secret: process.env.INTERNAL_API_SECRET,
    });
    return NextResponse.json({ ok: true, roomId: result.roomId, tiktokId: result.tiktokId, fromWorker: result.fromWorker });
  } catch (err) {
    console.error("[admin/workers/reassign] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
