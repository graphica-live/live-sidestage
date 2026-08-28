import { getUserPlan } from "./get-user-plan";
import { isMobileBetaEnabled } from "../mobile-settings";
import type { PlanTier } from "./types";

export interface EffectiveMobilePlan {
  plan: PlanTier;
  /** mobileBetaEnabled(全体設定)が現在有効かどうか。plan=ULTRAの理由がβ由来かの説明用。 */
  betaAccess: boolean;
}

/**
 * mobileクライアント向けの実効プランを解決する。
 *
 * **Web向けの機能判定には使わないこと。** mobileBetaEnabled=true の間は
 * Subscriptionの有無に関わらずULTRA相当を返す設計で、これはmobile無料β期間の
 * 特例。Webの契約プラン判定にこの関数を流用すると、mobile向けのβがWebの
 * 有料機能まで無条件で開放してしまう。Web側は引き続き getUserPlan() を使うこと。
 */
export async function getEffectiveMobilePlan(userId: string): Promise<EffectiveMobilePlan> {
  const betaAccess = await isMobileBetaEnabled();
  if (betaAccess) {
    return { plan: "ULTRA", betaAccess };
  }
  const plan = await getUserPlan(userId);
  return { plan, betaAccess };
}
