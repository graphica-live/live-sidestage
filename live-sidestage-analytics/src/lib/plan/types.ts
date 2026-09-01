export const PLAN_ORDER = ["FREE", "PRO", "ULTRA"] as const;

export type PlanTier = (typeof PLAN_ORDER)[number];

export function meetsPlan(userPlan: PlanTier, required: PlanTier): boolean {
  return PLAN_ORDER.indexOf(userPlan) >= PLAN_ORDER.indexOf(required);
}

// 複数provider(Stripe/Google Play/Apple)の有効な行から最上位プランを算出する。
export function highestPlan(plans: PlanTier[]): PlanTier {
  return plans.reduce<PlanTier>(
    (max, plan) => (PLAN_ORDER.indexOf(plan) > PLAN_ORDER.indexOf(max) ? plan : max),
    "FREE",
  );
}
