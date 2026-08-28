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
