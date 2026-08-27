import { NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { loadCandidateDiamonds } from "@/event/candidate-diamonds";
import { prisma } from "@/lib/prisma";

// 候補選択UI(候補調整モード/CANDIDATES_EXCEEDED)の「1000ダイヤ以下のバトルを隠す」
// トグル用の、候補ごとの生ダイヤ集計。**主催者が候補パネルを開いたときだけ叩く。**
//
// 読み取り専用なので `acquireEventLock` もトランザクションも取らない(同階層の PATCH は
// 結果を変えるので両方取る)。集計ワーカーと競合しても、次に開けば揃う。
//
// 認可は `requireEventOwner` + `findFirst({ id: matchId, eventId })`(loadCandidateDiamonds
// 内)の2段。他人のイベントの matchId を渡しても、後者で引けないので 404 になる。

export async function GET(
  _req: Request,
  { params }: { params: { id: string; matchId: string } }
) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: {
      startAt: true,
      endAt: true,
      sessions: {
        orderBy: { startAt: "asc" },
        select: { id: true, startAt: true, endAt: true, name: true },
      },
    },
  });
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const candidates = await loadCandidateDiamonds(prisma, {
    event,
    matchId: params.matchId,
    eventId: params.id,
    now: new Date(),
  });
  if (!candidates) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 主催者向けの生データ。共有キャッシュに載せない。
  return NextResponse.json({ candidates }, { headers: { "Cache-Control": "no-store" } });
}
