import { prisma } from "@/lib/prisma";
import type { PlanTier } from "./types";

// Subscription行が無いUser = FREE扱い(全Userに先回りして行を作らない)。
export async function getUserPlan(userId: string): Promise<PlanTier> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { plan: true },
  });
  return subscription?.plan ?? "FREE";
}
