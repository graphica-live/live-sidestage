import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserPlan } from "@/lib/plan/get-user-plan";

// `/setup`はclient componentなので、プラン表示のためにこのAPIをfetchする。
// `/events/settings`・`/overlays/settings`・`/billing`はserver componentなので
// このAPIを使わずgetUserPlan()を直接呼べる。
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [plan, link] = await Promise.all([
    getUserPlan(session.user.id),
    prisma.stripeCustomerLink.findUnique({
      where: { userId: session.user.id },
      select: { stripeCustomerId: true },
    }),
  ]);

  return NextResponse.json({
    plan,
    hasStripeCustomer: Boolean(link?.stripeCustomerId),
  });
}
