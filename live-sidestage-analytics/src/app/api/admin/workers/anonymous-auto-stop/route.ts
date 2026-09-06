import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { setSetting } from "@/lib/settings";
import { ANONYMOUS_ROOM_AUTO_STOP_SETTING_KEY } from "@/lib/watched-room-filter";

// Sidestageユーザー(Streamer登録/AgencyWatch登録/イベント参加のいずれか)以外のroomid、
// つまり匿名観測room(コラボ検知等で自動発見されただけのroom)の自動停止トグル。
// ON時、直近30分監視指示を受けていない匿名roomはWorkerのreconcileが切断する
// (watched-room-filter.ts参照)。開発中・データ収集中は無効化しておきたいのでデフォルトOFF。
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled(boolean)を指定してください。" }, { status: 400 });
  }

  try {
    await setSetting(ANONYMOUS_ROOM_AUTO_STOP_SETTING_KEY, enabled ? "true" : "false");
    return NextResponse.json({ ok: true, enabled });
  } catch (err) {
    console.error("[admin/workers/anonymous-auto-stop] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
