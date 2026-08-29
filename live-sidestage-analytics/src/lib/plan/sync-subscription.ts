import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { planForPriceId } from "./price-map";

// past_dueは決済失敗直後の猶予期間として有償プランを維持する(即FREEに落とすと
// リトライ中の正規ユーザーが機能を失う)。それ以外の終端ステータスはFREEへ収束させる。
const PLAN_RETAINING_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
]);

// Stripe Webhookの3イベント(checkout.session.completed / customer.subscription.updated /
// customer.subscription.deleted)全てがこの関数を呼ぶだけにする。event payloadの値は
// 信用せず、常にStripeへ`retrieve`して現在状態を取り直してから書き込む「収束的」設計:
// イベントの配信順序や重複配信があっても、最終的に正しい状態へ収束する。
export async function syncSubscriptionFromStripe(stripeSubscriptionId: string): Promise<void> {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

  const item = subscription.items.data[0] as Stripe.SubscriptionItem | undefined;
  const priceId = item?.price.id;
  const plan =
    PLAN_RETAINING_STATUSES.has(subscription.status) && priceId
      ? (planForPriceId(priceId) ?? "FREE")
      : "FREE";

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const data = {
    plan,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId ?? null,
    status: subscription.status,
    // basil世代以降、current_period_endはSubscription直下ではなく各itemに付く
    currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };

  const existing = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
    select: { id: true },
  });

  if (existing) {
    await prisma.subscription.update({ where: { id: existing.id }, data });
    return;
  }

  // まだstripeSubscriptionIdが紐付いていない(初回のcheckout完了)場合、
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

  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
