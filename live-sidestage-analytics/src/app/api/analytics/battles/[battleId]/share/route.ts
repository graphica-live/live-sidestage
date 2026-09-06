import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureShareToken } from "@/lib/battle-replay";
import { canonicalOrigin } from "@/lib/canonical-origin";

/**
 * シェアリンクを遅延発行する。既に発行済みなら同じトークンを返す(再発行しない)。
 *
 * オリジンはサーバー側が `canonicalOrigin("analytics")` で組む。admin 画面や別ホストから
 * 発行したときに `window.location.origin` だとずれるため。
 */
export async function POST(req: NextRequest, { params }: { params: { battleId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { roomId: true },
  });

  if (!streamer || !streamer.roomId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const token = await ensureShareToken(streamer.roomId, params.battleId);
  if (token === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ url: `${canonicalOrigin("analytics")}/b/${token}` });
}
