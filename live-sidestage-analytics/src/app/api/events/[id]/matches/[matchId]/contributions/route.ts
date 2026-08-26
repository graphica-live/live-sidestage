import { NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { loadMatchContributions } from "@/event/match-contributions";
import { prisma } from "@/lib/prisma";

// 対戦1件の枠ごとリスナー貢献。**主催者の管理画面から、モーダルを開いたときだけ叩く。**
//
// 読み取り専用なので `acquireEventLock` もトランザクションも取らない(同階層の PATCH は
// 結果を変えるので両方取る)。集計ワーカーと競合しても、次に開けば揃う。
//
// 認可は `requireEventOwner` + `findFirst({ id: matchId, eventId })` の2段。
// 他人のイベントの matchId を渡しても、後者で引けないので 404 になる。

export async function GET(
  _req: Request,
  { params }: { params: { id: string; matchId: string } }
) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await loadMatchContributions(prisma, {
    eventId: params.id,
    matchId: params.matchId,
    now: new Date(),
  });
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 主催者向けの生データ。共有キャッシュに載せない。
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
