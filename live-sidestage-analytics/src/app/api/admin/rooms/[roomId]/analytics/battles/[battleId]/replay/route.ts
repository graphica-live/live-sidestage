import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { queryBattleReplay } from "@/lib/battle-replay";

export async function GET(
  req: NextRequest,
  { params }: { params: { roomId: string; battleId: string } }
) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await queryBattleReplay(params.roomId, params.battleId);
  if (!result.ok) {
    return NextResponse.json({ error: "Replay unavailable", ...result.availability }, { status: 409 });
  }

  return NextResponse.json(result.payload, { headers: { "Cache-Control": "private, no-store" } });
}
