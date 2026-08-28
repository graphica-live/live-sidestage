import { NextRequest, NextResponse } from "next/server";
import { resolveActiveMobileUser } from "@/lib/mobile-auth";
import { requireFeature } from "@/lib/plan/require-feature";

export const dynamic = "force-dynamic";

// requireFeature()の配管が実際のHTTPリクエストを通じて機能することを示すためだけの
// エンドポイント。実際のmobile限定機能ではないので、本番UIから日常的に叩かれる想定はない。
// FEATURE_REQUIREMENTSへ実機能を足すときの参照実装として残す。
export async function GET(req: NextRequest) {
  const auth = await resolveActiveMobileUser(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const denied = await requireFeature(auth.userId, "mobile.entitlementProbe");
  if (denied) return denied;

  return NextResponse.json({ ok: true });
}
