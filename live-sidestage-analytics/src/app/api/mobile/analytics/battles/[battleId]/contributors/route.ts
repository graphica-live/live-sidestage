import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { queryBattleContributors } from "@/lib/battle-history";
import { sanitizeAvatarUrl } from "@/lib/tiktok-profile";

const buildUnregisteredResponse = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: { battleId: string } }) {
  const ctx = await resolveMobileAnalyticsContext(req, buildUnregisteredResponse);
  if (!ctx.ok) return ctx.response;

  const result = await queryBattleContributors(ctx.streamer.roomId, ctx.streamer.id, params.battleId);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(
    {
      contributors: result.contributors.map((c) => ({ ...c, profileImageUrl: sanitizeAvatarUrl(c.profileImageUrl) })),
      status: result.status,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
