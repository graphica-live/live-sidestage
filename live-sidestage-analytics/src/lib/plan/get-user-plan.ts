import { prisma } from "@/lib/prisma";
import type { PlanTier } from "./types";
import { highestPlan } from "./types";
import { isEntitlementRowValid } from "./effective-entitlement";

// Subscription行が無いUser = FREE扱い(全Userに先回りして行を作らない)。
// 同一userIdが複数provider(Stripe/Google Play/Apple)で有効な行を持ちうるため、
// 有効な全行から最上位プランを算出する。
export async function getUserPlan(userId: string): Promise<PlanTier> {
  // entitlementActive:trueだけでなく、バックフィル未実行の旧Stripe行(provider未設定)も
  // 拾う必要があるため、userId一致の全行を読んでisEntitlementRowValidで判定する。
  const [subscriptions, ambassador] = await Promise.all([
    prisma.subscription.findMany({
      where: { userId },
      select: { plan: true, entitlementActive: true, currentPeriodEnd: true, provider: true, status: true },
    }),
    prisma.ambassador.findUnique({ where: { userId }, select: { id: true } }),
  ]);
  const now = new Date();
  const activePlans = subscriptions
    .filter((s) => isEntitlementRowValid(s, now))
    .map((s) => s.plan);
  // アンバサダーはPROプラン無料。Subscription行の有無・状態に関わらず底上げする
  // (Stripe課金は発生しないため、Subscription行自体は作らない)。
  if (ambassador) activePlans.push("PRO");
  return highestPlan(activePlans);
}
