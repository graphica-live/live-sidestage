import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { PlanTier } from "@/lib/plan/types";
import { highestPlan } from "@/lib/plan/types";
import {
  isAmbassadorUltraUpgradePurchasable,
  isPlanPurchasable,
  WEB_MONTHLY_PRICE_JPY,
  type PaidPlan,
} from "@/lib/plan/price-map";
import { isEntitlementRowValid } from "@/lib/plan/effective-entitlement";
import { UpgradeButton, ManageBillingButton } from "./UpgradeActions";

export const dynamic = "force-dynamic";

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

  const [subscriptions, link, ambassador] = await Promise.all([
    prisma.subscription.findMany({
      where: { principalId: session.user.id },
      select: { plan: true, provider: true, entitlementActive: true, currentPeriodEnd: true, status: true },
    }),
    prisma.stripeCustomerLink.findUnique({
      where: { principalId: session.user.id },
      select: { stripeCustomerId: true },
    }),
    prisma.ambassador.findUnique({ where: { principalId: session.user.id }, select: { id: true } }),
  ]);

  const isAmbassador = Boolean(ambassador);
  const activeRows = subscriptions.filter((s) => isEntitlementRowValid(s));
  // アンバサダーはPROが無料特典。Subscription行が無くても最低PROまで底上げする
  // (getUserPlan()と同じ考え方。実際の課金有無はisActivePaidで別途判定する)。
  const effectivePlans: PlanTier[] = activeRows.map((r) => r.plan);
  if (isAmbassador) effectivePlans.push("PRO");
  const currentPlan: PlanTier = highestPlan(effectivePlans);
  // アンバサダーのPRO実購読行(特典と重複)はULTRA差額アップグレードの妨げにしない。
  // これを除外しないと、後からアンバサダー指定された既存PRO課金者のULTRAカードが
  // 「プラン変更はプランを管理するから」に固定され、差額アップグレード導線が出せない
  // (checkout/route.tsの二重課金防止チェックと対にした判定。同ファイル参照)。
  const rowsForActivePaidCheck = isAmbassador ? activeRows.filter((r) => r.plan !== "PRO") : activeRows;
  const isActivePaid = rowsForActivePaidCheck.length > 0;
  // provider問わず現在有効な行があるが、それがSTRIPEでない(=ストア経由)場合は
  // Portal誘導ではなく「ストアで契約中」の案内だけを出す。
  const activeStripeRow = activeRows.find((r) => !r.provider || r.provider === "STRIPE");
  const activeStoreRow = activeRows.find((r) => r.provider === "GOOGLE_PLAY" || r.provider === "APPLE");
  const hasStripeCustomer = Boolean(link?.stripeCustomerId);
  const checkout = searchParams.checkout;

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand">プラン</h1>
            <p className="text-sm text-muted mt-1">
              analyticsとイベント運営で共通のプランです。
            </p>
          </div>
          {hasStripeCustomer && activeStripeRow && <ManageBillingButton />}
        </div>

        {checkout === "success" && (
          <div className="card border-brand/40 mb-6 text-sm text-brand">
            お支払いありがとうございます。プランの反映まで数秒かかることがあります。反映されない場合はページを再読み込みしてください。
          </div>
        )}
        {checkout === "cancel" && (
          <div className="card mb-6 text-sm text-muted">決済はキャンセルされました。</div>
        )}
        {activeStoreRow && (
          <div className="card mb-6 text-sm text-muted">
            モバイルアプリのストア購入でご契約中です。プラン変更・解約はアプリ内のストア購読管理から行ってください。
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <PlanCard plan="FREE" current={currentPlan === "FREE"} />
          <PlanCard
            plan="PRO"
            current={currentPlan === "PRO"}
            isActivePaid={isActivePaid}
            isAmbassador={isAmbassador}
          />
          <PlanCard
            plan="ULTRA"
            current={currentPlan === "ULTRA"}
            isActivePaid={isActivePaid}
            isAmbassador={isAmbassador}
          />
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  isActivePaid = false,
  isAmbassador = false,
}: {
  plan: PlanTier;
  current: boolean;
  isActivePaid?: boolean;
  isAmbassador?: boolean;
}) {
  const price = plan !== "FREE" ? WEB_MONTHLY_PRICE_JPY[plan as PaidPlan] : undefined;
  // アンバサダーのPROは特典無料。ULTRAは通常価格ではなく「PROからの差額」課金になるため
  // 通常のWEB_MONTHLY_PRICE_JPYの数字はそのまま出さない。
  const showAmbassadorFreePro = isAmbassador && plan === "PRO";
  return (
    <div className={`card flex flex-col gap-3 ${current ? "border-brand/60" : ""}`}>
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-strong">{plan}</h2>
          {current && (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">
              現在のプラン
            </span>
          )}
        </div>
        {plan !== "FREE" && (
          <p className="mt-1 text-2xl font-bold text-strong">
            {showAmbassadorFreePro ? (
              <span className="text-base font-normal text-brand">アンバサダー特典で無料</span>
            ) : plan === "ULTRA" && isAmbassador ? (
              <span className="text-base font-normal text-muted">PROからの差額でアップグレード</span>
            ) : price !== undefined ? (
              <>
                ¥{price.toLocaleString()}
                <span className="text-xs font-normal text-muted"> /月</span>
              </>
            ) : (
              <span className="text-base font-normal text-muted">価格未定</span>
            )}
          </p>
        )}
        <p className="mt-2 text-xs text-muted">{PLAN_DESCRIPTIONS[plan]}</p>
      </div>

      <div className="mt-auto">{renderAction(plan, current, isActivePaid, isAmbassador)}</div>
    </div>
  );
}

function renderAction(plan: PlanTier, current: boolean, isActivePaid: boolean, isAmbassador: boolean) {
  if (plan === "FREE") return null;

  const paidPlan = plan as PaidPlan;

  // アンバサダーのPROは特典無料。通常のCheckout(二重課金)には進ませない。
  if (isAmbassador && plan === "PRO") return null;

  // 既に有効な有償プラン(provider問わず)を持っている場合、Stripe Checkoutは二重課金を防ぐため
  // 409を返す(src/app/api/billing/checkout/route.ts参照)。プラン変更はPortal経由に一本化する。
  if (isActivePaid) {
    if (current) return null;
    return <p className="text-xs text-muted">プラン変更は「プランを管理する」から行えます</p>;
  }

  // アンバサダーのULTRAは差額専用Priceでのみ購入可(checkout/route.ts参照)。
  // 通常のisPlanPurchasable(ULTRA本体価格)とは別に判定する。
  const purchasable = isAmbassador && plan === "ULTRA" ? isAmbassadorUltraUpgradePurchasable() : isPlanPurchasable(paidPlan);
  if (!purchasable) {
    return (
      <button disabled className="btn-primary w-full text-sm opacity-50">
        準備中
      </button>
    );
  }

  return <UpgradeButton plan={paidPlan} label={`${plan}にアップグレード`} />;
}
