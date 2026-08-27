import type { PlanTier } from "./types";

export const PAID_PLANS = ["PRO", "ULTRA"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

function envPriceId(plan: PaidPlan): string | undefined {
  const value = plan === "PRO" ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_ULTRA;
  return value && value.length > 0 ? value : undefined;
}

// 未設定(空文字含む)のPrice IDは「そのプランは購入不可」として扱う。
// Stripeのアカウント・Product/Priceがまだ無い環境でも500にならないようにするため。
export function priceIdForPlan(plan: PaidPlan): string | undefined {
  return envPriceId(plan);
}

export function isPlanPurchasable(plan: PaidPlan): boolean {
  return priceIdForPlan(plan) !== undefined;
}

export function planForPriceId(priceId: string): PlanTier | undefined {
  for (const plan of PAID_PLANS) {
    if (envPriceId(plan) === priceId) return plan;
  }
  return undefined;
}
