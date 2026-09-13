import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserPlan } from "@/lib/plan/get-user-plan";
import {
  WEB_PLAN_BADGE_AREA,
  getWebPlanBadgeDisplay,
} from "@/lib/plan/web-plan-badge";

// `/setup`はclient componentなので、プラン表示のためにこのAPIをfetchする。
// `/events/settings`・`/overlays/settings`・`/billing`はserver componentなので
// このAPIを使わずgetUserPlan()を直接呼べる。
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const badgeContext = new URL(req.url).searchParams.get("badgeContext");

  const [plan, link] = await Promise.all([
    getUserPlan(session.user.id),
    prisma.stripeCustomerLink.findUnique({
      where: { principalId: session.user.id },
      select: { stripeCustomerId: true },
    }),
  ]);

  let planLabel: string = plan;
  if (badgeContext && badgeContext in WEB_PLAN_BADGE_AREA) {
    const display = await getWebPlanBadgeDisplay(
      session.user.id,
      badgeContext as keyof typeof WEB_PLAN_BADGE_AREA,
    );
    planLabel = display.label;
  }

  return NextResponse.json({
    plan,
    planLabel,
    hasStripeCustomer: Boolean(link?.stripeCustomerId),
  });
}
