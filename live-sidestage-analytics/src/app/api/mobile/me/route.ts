import { NextRequest, NextResponse } from "next/server";
import { resolveActiveMobileUser } from "@/lib/mobile-auth";
import { getUserPlan } from "@/lib/plan/get-user-plan";
import { getBetaStatuses } from "@/lib/plan/beta-settings";
import { FEATURE_POLICIES, hasFeatureAccessSync, type FeatureKey } from "@/lib/plan/features";
import { getPlanDisplay } from "@/lib/plan/plan-display";
import {
  getMobileLatestVersion,
  getMobileMinSupportedVersion,
  isMobileMaintenanceMode,
} from "@/lib/mobile-settings";
import { prisma } from "@/lib/prisma";
import { getRecentUnacknowledgedMerge } from "@/lib/tiktok-id-migration";

// このレスポンスはUser個別の課金状態を含むため、CDN/共有キャッシュは不可。
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveActiveMobileUser(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const [plan, betaStatuses, minimumSupportedVersion, latestVersion, maintenanceMode, streamer] =
    await Promise.all([
      getUserPlan(auth.userId),
      getBetaStatuses(),
      getMobileMinSupportedVersion(),
      getMobileLatestVersion(),
      isMobileMaintenanceMode(),
      prisma.streamer.findUnique({ where: { userId: auth.userId }, select: { id: true } }),
    ]);

  const recentMerge = streamer ? await getRecentUnacknowledgedMerge(streamer.id) : null;

  // 実プランはβで書き換えない。featureの許可判定だけがβ領域のバイパスを考慮する。
  // ここは同期計算(DBは上のPromise.allで1回ずつしか叩かない)。
  const features = (Object.keys(FEATURE_POLICIES) as FeatureKey[]).filter((key) =>
    hasFeatureAccessSync(plan, key, betaStatuses)
  );

  // モバイルAppBarの単一プランバッジは「mobile」領域のβ状態だけを見る
  // (analytics/events領域のβはmobile限定機能の解禁に使うが、バッジ表記には影響しない)。
  const { betaActive: mobileBetaActive, label: planLabel } = getPlanDisplay(plan, betaStatuses.mobile);

  return NextResponse.json(
    {
      userId: auth.userId,
      plan,
      mobileBetaActive,
      planLabel,
      features,
      minimumSupportedVersion,
      latestVersion,
      maintenanceMode,
      recentMerge,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
