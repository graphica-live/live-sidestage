import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { PlanTier } from "@/lib/plan/types";
import { isPlanPurchasable, type PaidPlan } from "@/lib/plan/price-map";
import { UpgradeButton, ManageBillingButton } from "./UpgradeActions";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

const PLAN_DESCRIPTIONS: Record<PlanTier, string> = {
  FREE: "現在はすべての機能を無料でご利用いただけます。",
  PRO: "今後、上位機能を解放する予定のプランです。",
  ULTRA: "今後、さらに上位の機能を解放する予定のプランです。",
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
    select: { plan: true, status: true, stripeCustomerId: true },
  });

  const currentPlan: PlanTier = subscription?.plan ?? "FREE";
  const isActivePaid = Boolean(subscription?.status && ACTIVE_STATUSES.has(subscription.status));
  const hasStripeCustomer = Boolean(subscription?.stripeCustomerId);
  const checkout = searchParams.checkout;

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand">プラン</h1>
            <p className="text-sm text-gray-400 mt-1">
              analyticsとイベント運営で共通のプランです。
            </p>
          </div>
          {hasStripeCustomer && <ManageBillingButton />}
        </div>

        {checkout === "success" && (
          <div className="card border-brand/40 mb-6 text-sm text-brand">
            お支払いありがとうございます。プランの反映まで数秒かかることがあります。反映されない場合はページを再読み込みしてください。
          </div>
        )}
        {checkout === "cancel" && (
          <div className="card mb-6 text-sm text-gray-400">決済はキャンセルされました。</div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <PlanCard plan="FREE" current={currentPlan === "FREE"} />
          <PlanCard plan="PRO" current={currentPlan === "PRO"} isActivePaid={isActivePaid} />
          <PlanCard plan="ULTRA" current={currentPlan === "ULTRA"} isActivePaid={isActivePaid} />
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  isActivePaid = false,
}: {
  plan: PlanTier;
  current: boolean;
  isActivePaid?: boolean;
}) {
  return (
    <div className={`card flex flex-col gap-3 ${current ? "border-brand/60" : ""}`}>
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-white">{plan}</h2>
          {current && (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">
              現在のプラン
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-400">{PLAN_DESCRIPTIONS[plan]}</p>
      </div>

      <div className="mt-auto">{renderAction(plan, current, isActivePaid)}</div>
    </div>
  );
}

function renderAction(plan: PlanTier, current: boolean, isActivePaid: boolean) {
  if (plan === "FREE") return null;

  const paidPlan = plan as PaidPlan;

  // 既に有効な有償プランを持っている場合、Stripe Checkoutは二重購読を防ぐため409を返す
  // (src/app/api/billing/checkout/route.ts参照)。プラン変更はPortal経由に一本化する。
  if (isActivePaid) {
    if (current) return null;
    return <p className="text-xs text-gray-500">プラン変更は「プランを管理する」から行えます</p>;
  }

  if (!isPlanPurchasable(paidPlan)) {
    return (
      <button disabled className="btn-primary w-full text-sm opacity-50">
        準備中
      </button>
    );
  }

  return <UpgradeButton plan={paidPlan} label={`${plan}にアップグレード`} />;
}
