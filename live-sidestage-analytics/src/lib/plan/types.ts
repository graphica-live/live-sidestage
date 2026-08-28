export const PLAN_ORDER = ["FREE", "PRO", "ULTRA"] as const;

export type PlanTier = (typeof PLAN_ORDER)[number];

export function meetsPlan(userPlan: PlanTier, required: PlanTier): boolean {
  return PLAN_ORDER.indexOf(userPlan) >= PLAN_ORDER.indexOf(required);
}
