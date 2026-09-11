import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { ensureContributionShareToken, validateShareRequestBody } from "@/lib/contribution-share";
import { canonicalOrigin } from "@/lib/canonical-origin";

const buildUnregisteredResponse = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/**
 * mobile向けの貢献ランキングシェアリンク発行エンドポイント(既存Web版と同じ設計)。
 * 既に同一期間定義で発行済みなら同じトークンを返す。
 */
export async function POST(req: NextRequest) {
  const ctx = await resolveMobileAnalyticsContext(req, buildUnregisteredResponse);
  if (!ctx.ok) return ctx.response;

  const body = await req.json().catch(() => null);
  const validated = validateShareRequestBody(body);
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.error },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const token = await ensureContributionShareToken(ctx.streamer.roomId, validated.value);
  return NextResponse.json(
    { url: `${canonicalOrigin("analytics")}/c/${token}` },
    { headers: { "Cache-Control": "no-store" } }
  );
}
