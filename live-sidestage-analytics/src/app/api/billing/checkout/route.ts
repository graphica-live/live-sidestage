import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { PAID_PLANS, priceIdForPlan, type PaidPlan } from "@/lib/plan/price-map";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

function isPaidPlan(value: unknown): value is PaidPlan {
  return typeof value === "string" && (PAID_PLANS as readonly string[]).includes(value);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const plan = body?.plan;
  if (!isPaidPlan(plan)) {
    return NextResponse.json({ error: "plan must be PRO or ULTRA" }, { status: 400 });
  }

  const priceId = priceIdForPlan(plan);
  if (!priceId) {
    return NextResponse.json({ error: `${plan}は現在購入できません` }, { status: 503 });
  }

  const baseUrl = process.env.NEXTAUTH_URL;
  if (!baseUrl) {
    return NextResponse.json({ error: "NEXTAUTH_URL is not configured" }, { status: 503 });
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json({ error: "Stripeが設定されていません" }, { status: 503 });
  }

  const userId = session.user.id;
  let existing = await prisma.subscription.findUnique({
    where: { userId },
    select: { status: true, stripeCustomerId: true },
  });

  // Stripe Checkoutのsubscription modeは既存購読があっても新規購読を作れてしまうため、
  // ここでガードしないと二重課金になる。プラン変更はBilling Portal経由に誘導する。
  if (existing?.status && ACTIVE_STATUSES.has(existing.status)) {
    return NextResponse.json(
      { error: "既に有効なプランをご利用中です。プラン変更は「プランを管理する」から行ってください" },
      { status: 409 },
    );
  }

  let customerId = existing?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email ?? undefined,
      metadata: { userId },
    });
    customerId = customer.id;

    try {
      await prisma.subscription.create({
        data: { userId, stripeCustomerId: customerId },
      });
    } catch (err) {
      // 同時リクエストでCustomer作成が競合した場合のP2002。孤児Customerが1件残るだけで実害はない。
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        existing = await prisma.subscription.findUnique({
          where: { userId },
          select: { status: true, stripeCustomerId: true },
        });
        customerId = existing?.stripeCustomerId ?? customerId;
      } else {
        throw err;
      }
    }
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/billing?checkout=success`,
    cancel_url: `${baseUrl}/billing?checkout=cancel`,
    client_reference_id: userId,
    metadata: { userId },
    subscription_data: { metadata: { userId } },
  });

  if (!checkoutSession.url) {
    return NextResponse.json({ error: "Checkoutセッションの作成に失敗しました" }, { status: 502 });
  }

  return NextResponse.json({ url: checkoutSession.url });
}
