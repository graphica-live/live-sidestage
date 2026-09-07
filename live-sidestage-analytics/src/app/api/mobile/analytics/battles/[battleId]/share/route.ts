import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { ensureShareToken } from "@/lib/battle-replay";
import { canonicalOrigin } from "@/lib/canonical-origin";

const buildUnregisteredResponse = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/**
 * シェアリンクを遅延発行する(既存Web版share routeと同じ設計)。既に発行済みなら同じトークンを返す。
 *
 * **再生適格性はここでは判定しない。** 不適格なバトルでも token は発行され `{url}` は 200 で返る。
 * 404 になるのは `/b/[token]` アクセス時(`queryBattleReplayByShareToken` → `isReplayable`)。
 * 既存Web版share routeと挙動を揃えるため、この route 独自の適格性チェックは追加しない。
 */
export async function POST(req: NextRequest, { params }: { params: { battleId: string } }) {
  const ctx = await resolveMobileAnalyticsContext(req, buildUnregisteredResponse);
  if (!ctx.ok) return ctx.response;

  const token = await ensureShareToken(ctx.streamer.roomId, params.battleId);
  if (token === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(
    { url: `${canonicalOrigin("analytics")}/b/${token}` },
    { headers: { "Cache-Control": "no-store" } }
  );
}
