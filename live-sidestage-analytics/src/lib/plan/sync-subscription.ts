import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { planForPriceId } from "./price-map";
import { detectMultiProvider } from "./detect-multi-provider";

// past_dueは決済失敗直後の猶予期間として有償プランを維持する(即FREEに落とすと
// リトライ中の正規ユーザーが機能を失う)。それ以外の終端ステータスはFREEへ収束させる。
const PLAN_RETAINING_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
]);

// Prismaのunique constraint違反(P2002)かどうかを判定する。
function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

// Stripe Webhookの3イベント(checkout.session.completed / customer.subscription.updated /
// customer.subscription.deleted)全てがこの関数を呼ぶだけにする。event payloadの値は
// 信用せず、常にStripeへ`retrieve`して現在状態を取り直してから書き込む「収束的」設計:
// イベントの配信順序や重複配信があっても、最終的に正しい状態へ収束する。
export async function syncSubscriptionFromStripe(stripeSubscriptionId: string): Promise<void> {
  const fetchStartedAt = new Date();
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

  const item = subscription.items.data[0] as Stripe.SubscriptionItem | undefined;
  const priceId = item?.price.id;
  const isRetaining = PLAN_RETAINING_STATUSES.has(subscription.status);
  const plan = isRetaining && priceId ? (planForPriceId(priceId) ?? "FREE") : "FREE";
  // 未知のpriceId(設定漏れ・変更)ならplanはFREEに落ちるが、entitlementActiveを
  // isRetainingだけで決めるとFREEなのにactiveな行ができてしまう(実装後レビュー指摘)。
  // 課金確定(active等)でも機能を紐付けられない場合はfail closedにする。
  const entitlementActive = isRetaining && plan !== "FREE";

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const data = {
    plan,
    provider: "STRIPE" as const,
    providerSubscriptionId: subscription.id,
    // 旧列(フェーズBまで併存)。checkout/portal route等の旧参照が生きている間は書き続ける。
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId ?? null,
    status: subscription.status,
    rawStatus: subscription.status,
    entitlementActive,
    lastVerifiedAt: fetchStartedAt,
    // basil世代以降、current_period_endはSubscription直下ではなく各itemに付く
    currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };

  const existing = await prisma.subscription.findUnique({
    where: { provider_providerSubscriptionId: { provider: "STRIPE", providerSubscriptionId: subscription.id } },
    select: { id: true, userId: true, lastVerifiedAt: true },
  });

  if (existing) {
    // 2つのwebhook配信がほぼ同時にre-fetchした場合、後勝ちの書き込みがより古いfetch結果で
    // 上書きしないよう、既に新しいlastVerifiedAtが書かれていればskipする。
    // check-then-actでは2並行呼び出しが両方とも古いlastVerifiedAtを読んで両方通過し得るため
    // (実装後レビュー指摘)、比較をupdateMany自体のWHEREへ入れて原子的にする。
    const result = await prisma.subscription.updateMany({
      where: {
        id: existing.id,
        OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lte: fetchStartedAt } }],
      },
      data,
    });
    if (result.count === 0) return;
    await detectMultiProvider(existing.userId);
    return;
  }

  // まだproviderSubscriptionIdが紐付いていない(初回のcheckout完了)場合、
  // Checkout Session作成時にsubscription_data.metadata.userIdを付けているのでそこから解決する。
  const userId = subscription.metadata.userId;
  if (!userId) {
    throw new Error(
      `stripe subscription ${subscription.id} has no metadata.userId and no existing row to update`,
    );
  }

  // アカウント削除でUserが既に消えている場合、Subscription.userIdはUserへのFK
  // (onDelete: Cascade)なのでcreateがP2003で失敗し続ける。削除は
  // DELETE /api/mobile/account 側でCustomer自体をStripeから消しているはずで、
  // ここへ遅延webhookが届いても復元すべきデータが無いのでno-opにする。
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return;

  try {
    await prisma.subscription.create({ data: { userId, ...data } });
  } catch (error) {
    // userIdに一意制約は無いため、ここで起きうるP2002は複合unique
    // (provider, providerSubscriptionId)の衝突のみ(並行webhookが同時にcreateを試みた場合)。
    // userId基準でfindFirstすると、同一ユーザーの別provider行を誤って
    // このStripeデータで上書きしてしまう(実装後レビュー指摘)ため、
    // 必ず衝突した複合key自身で再取得する。
    if (isUniqueConstraintError(error)) {
      const raceRow = await prisma.subscription.findUnique({
        where: { provider_providerSubscriptionId: { provider: "STRIPE", providerSubscriptionId: subscription.id } },
        select: { id: true },
      });
      if (raceRow) {
        await prisma.subscription.update({ where: { id: raceRow.id }, data });
        await detectMultiProvider(userId);
        return;
      }
    }
    throw error;
  }
  await detectMultiProvider(userId);
}
