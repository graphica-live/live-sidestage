import { NextResponse } from "next/server";
import { getEffectiveMobilePlan } from "./effective-mobile-plan";
import { hasFeature, type FeatureKey } from "./features";
import type { PlanTier } from "./types";

export interface FeatureAccessResult {
  allowed: boolean;
  plan: PlanTier;
}

export async function hasFeatureAccess(userId: string, feature: FeatureKey): Promise<FeatureAccessResult> {
  const { plan } = await getEffectiveMobilePlan(userId);
  return { allowed: hasFeature(plan, feature), plan };
}

/**
 * userIdがfeatureを利用できなければ403のNextResponseを返す(利用できれば null)。
 *
 * ルートハンドラでは以下のように使う。Flutter側でボタンを隠すこととは独立に、
 * サーバー側で必ずこのチェックを通す。
 *
 *   const denied = await requireFeature(auth.userId, "mobile.entitlementProbe");
 *   if (denied) return denied;
 */
export async function requireFeature(userId: string, feature: FeatureKey): Promise<NextResponse | null> {
  const { allowed } = await hasFeatureAccess(userId, feature);
  if (allowed) return null;
  return NextResponse.json({ error: "この機能を利用する権限がありません", feature }, { status: 403 });
}
