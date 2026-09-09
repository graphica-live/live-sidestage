import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { ensureShareToken } from "@/lib/battle-replay";
import { canonicalOrigin } from "@/lib/canonical-origin";

/**
 * 管理者向けのバトルシェアリンク発行エンドポイント。
 *
 * シェアリンクを遅延発行する。既に発行済みなら同じトークンを返す(再発行しない)。
 *
 * オリジンはサーバー側が `canonicalOrigin("analytics")` で組む。admin 画面や別ホストから
 * 発行したときに `window.location.origin` だとずれるため。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { roomId: string; battleId: string } }
) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const room = await prisma.tiktokRoom.findUnique({
    where: { id: params.roomId },
    select: { id: true },
  });

  if (!room) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const token = await ensureShareToken(params.roomId, params.battleId);
  if (token === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ url: `${canonicalOrigin("analytics")}/b/${token}` });
}
