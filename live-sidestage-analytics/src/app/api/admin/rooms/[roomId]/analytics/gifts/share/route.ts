import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { ensureContributionShareToken, validateShareRequestBody } from "@/lib/contribution-share";
import { canonicalOrigin } from "@/lib/canonical-origin";

/**
 * 管理者向けの貢献ランキングシェアリンク発行エンドポイント。
 * `/api/admin/rooms/[roomId]/analytics/battles/[battleId]/share` と同じ設計。
 */
export async function POST(req: NextRequest, { params }: { params: { roomId: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const room = await prisma.tiktokRoom.findUnique({
    where: { id: params.roomId },
    select: { id: true },
  });

  if (!room) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const validated = validateShareRequestBody(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const token = await ensureContributionShareToken(params.roomId, validated.value);
  return NextResponse.json({ url: `${canonicalOrigin("analytics")}/c/${token}` });
}
