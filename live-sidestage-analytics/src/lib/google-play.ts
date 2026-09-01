import { google, androidpublisher_v3 } from "googleapis";

// module-levelでクライアントを作らない(GOOGLE_PLAY_SERVICE_ACCOUNT_JSON未設定のローカル開発
// でimportしただけでthrowするのを防ぐ。stripe.tsと同じパターン)。
let client: androidpublisher_v3.Androidpublisher | undefined;

function getClient(): androidpublisher_v3.Androidpublisher {
  if (client) return client;

  const rawJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!rawJson) {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not set");
  }

  const credentials = JSON.parse(rawJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });

  client = google.androidpublisher({ version: "v3", auth });
  return client;
}

function packageName(): string {
  const value = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  if (!value) throw new Error("GOOGLE_PLAY_PACKAGE_NAME is not set");
  return value;
}

export async function getSubscriptionV2(purchaseToken: string) {
  const publisher = getClient();
  const res = await publisher.purchases.subscriptionsv2.get({
    packageName: packageName(),
    token: purchaseToken,
  });
  return res.data;
}

export async function acknowledgeSubscription(purchaseToken: string, productId: string): Promise<void> {
  const publisher = getClient();
  await publisher.purchases.subscriptions.acknowledge({
    packageName: packageName(),
    subscriptionId: productId,
    token: purchaseToken,
  });
}

// 次回更新で停止する(即時失効しない)。アカウント削除時のサーバー側解約に使う。
export async function cancelSubscription(purchaseToken: string, productId: string): Promise<void> {
  const publisher = getClient();
  await publisher.purchases.subscriptions.cancel({
    packageName: packageName(),
    subscriptionId: productId,
    token: purchaseToken,
  });
}

// 即時失効させる。cancelより強い操作で、通常は使わない(用途があれば呼び出し側で選ぶ)。
export async function revokeSubscription(purchaseToken: string, productId: string): Promise<void> {
  const publisher = getClient();
  await publisher.purchases.subscriptions.revoke({
    packageName: packageName(),
    subscriptionId: productId,
    token: purchaseToken,
  });
}
