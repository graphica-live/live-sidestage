import { normalizeEmail } from "@/lib/agency/agency";
import { prisma } from "@/lib/prisma";
import type { BetaArea } from "./beta-settings";
import { getBetaStatuses } from "./beta-settings";
import { getUserPlan } from "./get-user-plan";
import { getPlanDisplay, type PlanDisplay } from "./plan-display";

/** Webヘッダーのプランバッジが参照するβ領域(mobile除く)。 */
export type WebPlanBadgeArea = Exclude<BetaArea, "mobile">;

/**
 * 表向き別サービスとβ領域の対応。Overlaysは専用キーが無くanalytics領域を共有する。
 * billingは製品横断のためβ前置きしない(betaArea=null)。
 */
export const WEB_PLAN_BADGE_AREA: Record<
  "analytics" | "events" | "overlays" | "agency" | "billing",
  WebPlanBadgeArea | null
> = {
  analytics: "analytics",
  events: "events",
  overlays: "analytics",
  agency: "agency",
  billing: null,
};

async function planDisplayWithBetaArea(
  plan: Awaited<ReturnType<typeof getUserPlan>>,
  betaArea: WebPlanBadgeArea | null,
): Promise<PlanDisplay> {
  if (!betaArea) {
    return getPlanDisplay(plan, false);
  }
  const statuses = await getBetaStatuses([betaArea]);
  return getPlanDisplay(plan, statuses[betaArea]);
}

export async function getWebPlanBadgeDisplay(
  principalId: string,
  context: keyof typeof WEB_PLAN_BADGE_AREA,
): Promise<PlanDisplay> {
  const plan = await getUserPlan(principalId);
  return planDisplayWithBetaArea(plan, WEB_PLAN_BADGE_AREA[context]);
}

/** 事務所コンソールなどPrincipal行が無いセッション向け。未登録emailはFREE扱い。 */
export async function getWebPlanBadgeDisplayForEmail(
  email: string | null | undefined,
  context: keyof typeof WEB_PLAN_BADGE_AREA,
): Promise<PlanDisplay> {
  const normalized = normalizeEmail(email ?? "");
  if (!normalized) {
    return planDisplayWithBetaArea("FREE", WEB_PLAN_BADGE_AREA[context]);
  }
  const principal = await prisma.principal.findFirst({
    where: { email: normalized },
    select: { id: true },
  });
  if (!principal) {
    return planDisplayWithBetaArea("FREE", WEB_PLAN_BADGE_AREA[context]);
  }
  return getWebPlanBadgeDisplay(principal.id, context);
}
