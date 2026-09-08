import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { queryBattleReplay } from "@/lib/battle-replay";

export async function GET(req: NextRequest, { params }: { params: { battleId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { principalId: session.user.id },
    select: { roomId: true },
  });

  if (!streamer || !streamer.roomId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await queryBattleReplay(streamer.roomId, params.battleId);
  // 再生不可は 404 ではなく 409。「バトルは在るが再生に必要なデータが無い」を
  // クライアントが理由コードごと表示できるようにする。
  if (!result.ok) {
    return NextResponse.json({ error: "Replay unavailable", ...result.availability }, { status: 409 });
  }

  return NextResponse.json(result.payload, { headers: { "Cache-Control": "private, no-store" } });
}
