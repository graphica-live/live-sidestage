import { NextRequest, NextResponse } from "next/server";
import { resolveActiveMobileUser } from "@/lib/mobile-auth";
import { getEffectiveMobilePlan } from "@/lib/plan/effective-mobile-plan";
import { FEATURE_REQUIREMENTS, hasFeature, type FeatureKey } from "@/lib/plan/features";
import {
  getMobileLatestVersion,
  getMobileMinSupportedVersion,
  isMobileMaintenanceMode,
} from "@/lib/mobile-settings";

// このレスポンスはUser個別の課金状態を含むため、CDN/共有キャッシュは不可。
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveActiveMobileUser(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const [{ plan, betaAccess }, minimumSupportedVersion, latestVersion, maintenanceMode] = await Promise.all([
    getEffectiveMobilePlan(auth.userId),
    getMobileMinSupportedVersion(),
    getMobileLatestVersion(),
    isMobileMaintenanceMode(),
  ]);

  const features = (Object.keys(FEATURE_REQUIREMENTS) as FeatureKey[]).filter((key) => hasFeature(plan, key));

  return NextResponse.json(
    {
      userId: auth.userId,
      effectivePlan: plan,
      // mobileBetaEnabled(全体設定)が現在有効かどうか。plan=ULTRAの理由がβ由来かを
      // 説明するためのフラグで、ユーザー個別の参加可否ではない(現状は全員一律)。
      betaAccess,
      features,
      minimumSupportedVersion,
      latestVersion,
      maintenanceMode,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
