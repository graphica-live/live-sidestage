import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { PAID_PLANS, priceIdForAmbassadorUltraUpgrade, priceIdForPlan, type PaidPlan } from "@/lib/plan/price-map";
import { canonicalOrigin } from "@/lib/canonical-origin";
import { isEntitlementRowValid } from "@/lib/plan/effective-entitlement";

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

  const userId = session.user.id;
  const ambassador = await prisma.ambassador.findUnique({ where: { userId }, select: { id: true } });

  // アンバサダーはPROが無料特典なので、通常のPRO課金は行わせない
  // (誤って二重に支払わせないためのfail-closed)。
  if (ambassador && plan === "PRO") {
    return NextResponse.json(
      { error: "アンバサダー特典によりPROは既に無料でご利用いただけます" },
      { status: 400 }
    );
  }

  // アンバサダーのULTRAは「ULTRA - PRO」の差額専用Priceでのみ購入できる。
  // 未設定の場合、通常ULTRA価格へのフォールバックはしない(設定漏れを
  // ユーザー負担に転嫁しないため。price-map.ts参照)。
  const priceId =
    ambassador && plan === "ULTRA" ? priceIdForAmbassadorUltraUpgrade() : priceIdForPlan(plan);
  if (!priceId) {
    return NextResponse.json({ error: `${plan}は現在購入できません` }, { status: 503 });
  }

  const baseUrl = canonicalOrigin("analytics");

  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json({ error: "Stripeが設定されていません" }, { status: 503 });
  }

  // cross-provider二重課金防止: providerを問わず、既に有効なentitlementを持つ行が
  // あれば拒否する。プラン変更はBilling Portal経由(Stripeの場合)に誘導する。
  // entitlementActive:trueだけでなく、バックフィル未実行の旧Stripe行(provider未設定)も
  // isEntitlementRowValidのフォールバックで拾えるよう、userId一致の全行を読む。
  const activeRows = await prisma.subscription.findMany({
    where: { userId },
    select: { plan: true, provider: true, entitlementActive: true, currentPeriodEnd: true, status: true },
  });
  // アンバサダーのULTRA差額アップグレードは、特典で無料になっているPROの実購読行と
  // 重複してよい(それ自体が「無料PRO→差額でULTRAへ」というアップグレード導線のため)。
  // 判定対象からPRO行を除外しないと、後からアンバサダー指定された既存PRO課金者が
  // 一生ULTRA差額を購入できなくなる(409で弾かれ続ける)。
  const rowsForDuplicateCheck =
    ambassador && plan === "ULTRA" ? activeRows.filter((r) => r.plan !== "PRO") : activeRows;
  // provider未設定の旧行は実質STRIPE(バックフィル前)なので、それ以外のみ「ストア契約」扱いにする。
  const activeNonStripe = rowsForDuplicateCheck.find(
    (r) => isEntitlementRowValid(r) && r.provider && r.provider !== "STRIPE",
  );
  if (activeNonStripe) {
    return NextResponse.json(
      { error: "ストアで契約中のプランがあります。プラン変更はモバイルアプリのストア購読管理から行ってください" },
      { status: 409 },
    );
  }
  const activeStripe = rowsForDuplicateCheck.find(
    (r) => isEntitlementRowValid(r) && (!r.provider || r.provider === "STRIPE"),
  );
  if (activeStripe) {
    return NextResponse.json(
      { error: "既に有効なプランをご利用中です。プラン変更は「プランを管理する」から行ってください" },
      { status: 409 },
    );
  }

  let link = await prisma.stripeCustomerLink.findUnique({
    where: { userId },
    select: { stripeCustomerId: true },
  });

  let customerId = link?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email ?? undefined,
      metadata: { userId },
    });
    customerId = customer.id;

    try {
      await prisma.stripeCustomerLink.create({
        data: { userId, stripeCustomerId: customerId },
      });
    } catch (err) {
      // 同時リクエストでCustomer作成が競合した場合のP2002。孤児Customerが1件残るだけで実害はない。
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        link = await prisma.stripeCustomerLink.findUnique({
          where: { userId },
          select: { stripeCustomerId: true },
        });
        customerId = link?.stripeCustomerId ?? customerId;
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
