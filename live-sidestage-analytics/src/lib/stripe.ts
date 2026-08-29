import Stripe from "stripe";

// module-levelで`new Stripe(...)`しない。STRIPE_SECRET_KEY未設定の環境(Stripeをまだ
// セットアップしていないローカル開発など)でこのファイルをimportしただけでthrowするのを防ぐため、
// 実際に呼ばれるまで生成を遅らせる。呼び出し側(checkout/portal/webhookルート)は
// 未設定ならエラーを捕まえて503を返すこと。
let stripeClient: Stripe | undefined;

export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }

  stripeClient = new Stripe(secretKey);
  return stripeClient;
}

/// Customerを削除する。Stripe公式仕様上、Customer削除はactiveなsubscriptionを
/// 即時解約しカード情報も消す(個別にsubscriptions.cancel()するより単純で、
/// 複数/不整合サブスクリプションや未完了Checkout Sessionが残るケースも一括で片付く)。
///
/// 既に削除済み(resource_missing)は成功扱いにする — アカウント削除の再送(冪等リトライ)や
/// 手動でのStripe側先行削除で、対象が既に無いケースを異常系にしないため。
export async function deleteStripeCustomer(stripeCustomerId: string): Promise<void> {
  const stripe = getStripe();
  try {
    await stripe.customers.del(stripeCustomerId);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") {
      return;
    }
    throw error;
  }
}
