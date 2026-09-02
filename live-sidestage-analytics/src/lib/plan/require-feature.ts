import { NextResponse } from "next/server";
import { getUserPlan } from "./get-user-plan";
import { isBetaEnabled } from "./beta-settings";
import { getFeaturePolicy, type FeatureKey } from "./features";
import type { PlanTier } from "./types";
import { meetsPlan } from "./types";

export interface FeatureAccessResult {
  allowed: boolean;
  plan: PlanTier;
}

/**
 * 実プランを変更せず、要求プランに満たない場合だけ対応するβ領域のフラグを確認する。
 * betaAccess(旧設計)のようにplanそのものをULTRAへ書き換えないため、
 * β中でも他の(β領域に紐づかない)機能制限には影響しない。
 */
export async function hasFeatureAccess(userId: string, feature: FeatureKey): Promise<FeatureAccessResult> {
  const plan = await getUserPlan(userId);
  const policy = getFeaturePolicy(feature);
  // FeatureKeyは型的にFEATURE_POLICIESのキーで保証されるが、hasFeature/hasFeatureAccessSyncと
  // 同じfail-closed方針に揃えるため、実行時にtypoや古いキーがすり抜けた場合も500ではなく
  // 不許可(403)に倒す。
  if (policy === undefined) return { allowed: false, plan };

  if (meetsPlan(plan, policy.requiredPlan)) {
    return { allowed: true, plan };
  }
  if (policy.betaArea && (await isBetaEnabled(policy.betaArea))) {
    return { allowed: true, plan };
  }
  return { allowed: false, plan };
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
