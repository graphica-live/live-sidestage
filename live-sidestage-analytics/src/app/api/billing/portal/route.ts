import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { canonicalOrigin } from "@/lib/canonical-origin";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const baseUrl = canonicalOrigin("analytics");

  const link = await prisma.stripeCustomerLink.findUnique({
    where: { userId: session.user.id },
    select: { stripeCustomerId: true },
  });

  if (!link?.stripeCustomerId) {
    return NextResponse.json({ error: "有料プランのご利用がありません" }, { status: 400 });
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json({ error: "Stripeが設定されていません" }, { status: 503 });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: link.stripeCustomerId,
    return_url: `${baseUrl}/billing`,
  });

  return NextResponse.json({ url: portalSession.url });
}
