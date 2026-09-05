import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { getSetting } from "@/lib/settings";
import { PROXY_ATTEMPT_LOG_KEY, type ProxyAttemptLogEntry } from "@/lib/tiktok-gift-catalog";

// ギフトカタログ取得(日本プロキシ経由)の直近成功/失敗履歴。読み取り専用。
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let log: ProxyAttemptLogEntry[] = [];
  try {
    const raw = await getSetting(PROXY_ATTEMPT_LOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) log = parsed;
    }
  } catch (err) {
    console.error("[admin/proxy] attempt log の取得に失敗:", err);
  }

  return NextResponse.json(
    { log: log.slice().reverse() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
