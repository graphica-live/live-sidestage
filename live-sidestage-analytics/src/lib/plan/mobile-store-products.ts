import type { PaidPlan } from "./price-map";
import type { PlanTier } from "./types";

function googleProductIdFor(plan: PaidPlan): string | undefined {
  const value =
    plan === "PRO" ? process.env.GOOGLE_PLAY_PRODUCT_ID_PRO : process.env.GOOGLE_PLAY_PRODUCT_ID_ULTRA;
  return value && value.length > 0 ? value : undefined;
}

function appleProductIdFor(plan: PaidPlan): string | undefined {
  const value = plan === "PRO" ? process.env.APPLE_PRODUCT_ID_PRO : process.env.APPLE_PRODUCT_ID_ULTRA;
  return value && value.length > 0 ? value : undefined;
}

export function planForGoogleProductId(productId: string): PlanTier | undefined {
  for (const plan of ["PRO", "ULTRA"] as const) {
    if (googleProductIdFor(plan) === productId) return plan;
  }
  return undefined;
}

export function planForAppleProductId(productId: string): PlanTier | undefined {
  for (const plan of ["PRO", "ULTRA"] as const) {
    if (appleProductIdFor(plan) === productId) return plan;
  }
  return undefined;
}
