import type { PlanTier } from "./types";

export const PAID_PLANS = ["PRO", "ULTRA"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

function envPriceId(plan: PaidPlan): string | undefined {
  const value = plan === "PRO" ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_ULTRA;
  return value && value.length > 0 ? value : undefined;
}

// アンバサダー(PROは無料特典)がULTRAへアップグレードする際の差額専用Price ID。
// ULTRA本体(STRIPE_PRICE_ULTRA)とは別のStripe Priceとして用意する想定
// (ULTRA月額 - PRO月額 の差額を金額として設定する運用はStripe管理画面側で行う)。
// 未設定の間はアンバサダーのULTRA購入自体を許可しない(checkout/route.ts参照。
// 通常ULTRA価格へのフォールバックはしない — 設定漏れをユーザー負担に転嫁しないため)。
function envAmbassadorUltraDiffPriceId(): string | undefined {
  const value = process.env.STRIPE_PRICE_ULTRA_AMBASSADOR_DIFF;
  return value && value.length > 0 ? value : undefined;
}

// 未設定(空文字含む)のPrice IDは「そのプランは購入不可」として扱う。
// Stripeのアカウント・Product/Priceがまだ無い環境でも500にならないようにするため。
export function priceIdForPlan(plan: PaidPlan): string | undefined {
  return envPriceId(plan);
}

export function priceIdForAmbassadorUltraUpgrade(): string | undefined {
  return envAmbassadorUltraDiffPriceId();
}

export function isPlanPurchasable(plan: PaidPlan): boolean {
  return priceIdForPlan(plan) !== undefined;
}

export function isAmbassadorUltraUpgradePurchasable(): boolean {
  return priceIdForAmbassadorUltraUpgrade() !== undefined;
}

// stripe webhook(sync-subscription.ts)がPrice IDからplanを逆引きする際に使う。
// アンバサダー差額Priceで決済が成立した場合もULTRAとして解決できないと、
// entitlementActiveがfalseのままFREE行として保存されてしまう。
export function planForPriceId(priceId: string): PlanTier | undefined {
  for (const plan of PAID_PLANS) {
    if (envPriceId(plan) === priceId) return plan;
  }
  if (envAmbassadorUltraDiffPriceId() === priceId) return "ULTRA";
  return undefined;
}

// Web(Stripe)の表示価格。ストア価格帯手動設定という設計上、動的検証は行わない(表示専用定数)。
// undefinedは「価格未定」を意味し、表示側は「未定」等のプレースホルダを出す。
export const WEB_MONTHLY_PRICE_JPY: Record<PaidPlan, number | undefined> = {
  PRO: 980,
  ULTRA: undefined,
};
