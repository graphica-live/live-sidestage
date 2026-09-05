import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { queryBattleContributors } from "@/lib/battle-history";

export async function GET(
  req: NextRequest,
  { params }: { params: { roomId: string; battleId: string } }
) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await queryBattleContributors(params.roomId, params.roomId, params.battleId);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(result);
}
