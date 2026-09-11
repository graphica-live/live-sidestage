import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureContributionShareToken, validateShareRequestBody } from "@/lib/contribution-share";
import { canonicalOrigin } from "@/lib/canonical-origin";

/**
 * 貢献ランキング(期間集計)のシェアリンクを遅延発行する。既に同一期間定義で発行済みなら
 * 同じトークンを返す(再発行しない)。オリジンはサーバー側が `canonicalOrigin("analytics")` で組む
 * (`/api/analytics/battles/[battleId]/share` と同じ設計)。
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { principalId: session.user.id },
    select: { roomId: true },
  });

  if (!streamer || !streamer.roomId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const validated = validateShareRequestBody(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const token = await ensureContributionShareToken(streamer.roomId, validated.value);
  return NextResponse.json({ url: `${canonicalOrigin("analytics")}/c/${token}` });
}
