import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// `/setup`はclient componentなので、プラン表示のためにこのAPIをfetchする。
// `/events/settings`・`/overlays/settings`・`/billing`はserver componentなので
// このAPIを使わずgetUserPlan()を直接呼べる。
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
    select: { plan: true, stripeCustomerId: true },
  });

  return NextResponse.json({
    plan: subscription?.plan ?? "FREE",
    hasStripeCustomer: Boolean(subscription?.stripeCustomerId),
  });
}
