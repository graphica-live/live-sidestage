import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import {
  buildWorkerReport,
  fetchAssignedRooms,
  parseWorkerInternalUrls,
  probeWorkers,
  type AssignedRoom,
} from "@/lib/worker-status";

// Worker プロセスの稼働状況。DB(担当予定の部屋)と各 Worker の /status(実際の listener)を
// 突き合わせて返す。読み取り専用。
//
// DB と Worker のどちらかが落ちていても、取れた方だけで返す — 障害時ほど見たい画面なので、
// 片方の失敗で 500 にしない。失敗した側は dbError / worker_unreachable として現れる。

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const rawWorkerCount = Number(process.env.WORKER_COUNT);
  const workerCount = Number.isFinite(rawWorkerCount) ? rawWorkerCount : null;
  const urls = parseWorkerInternalUrls(process.env.WORKER_INTERNAL_URLS);

  let rooms: AssignedRoom[] = [];
  let dbError: string | null = null;
  try {
    rooms = await fetchAssignedRooms(now);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
    console.error("[admin/workers] DB 取得に失敗:", err);
  }

  const probes = await probeWorkers(urls, process.env.INTERNAL_API_SECRET);

  const report = buildWorkerReport({ workerCount, urls, probes, rooms, dbError, now });

  return NextResponse.json(report, {
    headers: { "Cache-Control": "no-store" },
  });
}
