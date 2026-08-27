import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { queryBattleContributors } from "@/lib/battle-history";

export async function GET(req: NextRequest, { params }: { params: { battleId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { id: true, roomId: true },
  });

  if (!streamer || !streamer.roomId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await queryBattleContributors(streamer.roomId, streamer.id, params.battleId);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(result);
}
