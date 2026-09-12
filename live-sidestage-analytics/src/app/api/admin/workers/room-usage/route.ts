import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { fetchAdminRoomList } from "@/lib/worker-status";

// /admin/workers の監視対象一覧向け。週間/24h/コラボ署名消費の集計のみ。
// 本体 GET /api/admin/workers の15秒ポーリングから切り離し、初回表示と手動更新だけで叩く。

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  try {
    const list = await fetchAdminRoomList(now, {
      includeWeeklyEulerUsage: true,
      includeSignatureUsage24h: true,
    });
    const rooms = list.map((r) => ({
      roomId: r.roomId,
      weeklyEulerSignUsageCount: r.weeklyEulerSignUsageCount ?? 0,
      signatureUsage24hCount: r.signatureUsage24hCount ?? 0,
      collabSignatureUsage24hCount: r.collabSignatureUsage24hCount ?? 0,
    }));
    return NextResponse.json(
      { generatedAt: now.toISOString(), rooms },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[admin/workers/room-usage] 取得に失敗:", err);
    return NextResponse.json({ error: "Failed to load room usage" }, { status: 500 });
  }
}
