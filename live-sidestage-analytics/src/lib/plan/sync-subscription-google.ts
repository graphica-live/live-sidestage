import { prisma } from "@/lib/prisma";
import { getSubscriptionV2, acknowledgeSubscription } from "@/lib/google-play";
import { planForGoogleProductId } from "./mobile-store-products";
import { detectMultiProvider } from "./detect-multi-provider";

// Google Play Developer APIのSubscriptionState。ACTIVE/IN_GRACE_PERIODはentitlement維持。
// CANCELEDは「自動更新を止めただけ」でexpiryTimeまではまだ有効(Google公式のライフサイクル定義。
// 実装後レビュー指摘: 即FREEに落とすと支払済み期間中のユーザーが機能を失い、購入ガードも外れて
// 二重課金され得る)なので、expiryTime未来のCANCELEDだけ別途entitlement維持対象に含める。
const ENTITLED_STATES = new Set(["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"]);
const CANCELED_STATE = "SUBSCRIPTION_STATE_CANCELED";

// RTDN(webhook)は合図だけ、常にGoogle Play Developer APIへre-fetchして収束させる。
// userId解決に失敗した場合はno-op(200)を返さず、呼び出し元(webhook route)へ例外を投げる
// (Pub/Sub Pushは非2xxを再送するため、verify-purchase未達の取りこぼしをリトライで拾える)。
export async function syncSubscriptionFromGoogle(purchaseToken: string): Promise<void> {
  const fetchStartedAt = new Date();
  const sub = await getSubscriptionV2(purchaseToken);

  const lineItem = sub.lineItems?.[0];
  const productId = lineItem?.productId ?? undefined;
  const state = sub.subscriptionState ?? "";
  const expiryTimeMs = lineItem?.expiryTime ? new Date(lineItem.expiryTime).getTime() : null;
  const isEntitled =
    ENTITLED_STATES.has(state) ||
    (state === CANCELED_STATE && expiryTimeMs !== null && expiryTimeMs > fetchStartedAt.getTime());
  const plan = isEntitled && productId ? (planForGoogleProductId(productId) ?? "FREE") : "FREE";
  // 未知productId(設定漏れ・変更)ならplanはFREEに落ちるが、entitlementActiveをisEntitled
  // だけで決めるとFREEなのにactiveな行ができる(実装後レビュー指摘、Stripe版と同種)。
  const entitlementActive = isEntitled && plan !== "FREE";

  const data = {
    plan,
    provider: "GOOGLE_PLAY" as const,
    providerSubscriptionId: purchaseToken,
    googleProductId: productId ?? null,
    rawStatus: state,
    entitlementActive,
    lastVerifiedAt: fetchStartedAt,
    currentPeriodEnd: expiryTimeMs ? new Date(expiryTimeMs) : null,
    cancelAtPeriodEnd: sub.canceledStateContext !== undefined,
  };

  const existing = await prisma.subscription.findUnique({
    where: {
      provider_providerSubscriptionId: { provider: "GOOGLE_PLAY", providerSubscriptionId: purchaseToken },
    },
    select: { id: true, userId: true, lastVerifiedAt: true },
  });

  // 再購読・プラン変更で新purchaseTokenへ切り替わった場合、旧tokenの行をここで失効させる
  // (RTDN到達に依存させない)。
  const linkedToken = sub.linkedPurchaseToken;
  if (linkedToken) {
    await prisma.subscription.updateMany({
      where: {
        provider: "GOOGLE_PLAY",
        providerSubscriptionId: linkedToken,
        entitlementActive: true,
      },
      data: { entitlementActive: false },
    });
  }

  if (existing) {
    // check-then-actでは2並行呼び出しが両方とも古いlastVerifiedAtを読んで両方通過し得るため、
    // 比較をupdateMany自体のWHEREへ入れて原子的にする(Stripe版と同じ理由)。
    const result = await prisma.subscription.updateMany({
      where: {
        id: existing.id,
        OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lte: fetchStartedAt } }],
      },
      data,
    });
    if (result.count === 0) return;
    // Subscription行の確定後にacknowledgeする(Google要件どおり)。acknowledgementStateが
    // PENDINGのまま3日放置すると自動返金されるため、verify-purchase経路だけでなく
    // webhook経路からも冪等に到達できるようにする。
    if (sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING" && productId) {
      await acknowledgeSubscription(purchaseToken, productId);
    }
    await detectMultiProvider(existing.userId);
    return;
  }

  const obfuscatedAccountId = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (!obfuscatedAccountId) {
    throw new Error(`google subscription ${purchaseToken} has no obfuscatedExternalAccountId`);
  }

  // expiresAtで絞らない: verify-purchase route側も元々expiresAtを見ておらず、TTLでは
  // 絞っていない。横流し防止の実体はTTLではなく「tokenがサーバー発行のrandomUUIDで
  // init時点のuserIdに束縛される」点にあるため、期限切れでも他ユーザーへの付け替えは
  // 構造的に起きない。webhook(RTDN)配信はユーザー操作から独立して遅延しうるため、
  // ここでTTLを掛けると正規の購入が期限超過だけで永久に紐付け不能になる
  // (実装後レビュー指摘、Fable H-4)。expiresAtは掃除用の目安としてのみ残す
  // (未消費(consumedAt: null)であれば期限切れでも紐付けを許可する)。
  const intent = await prisma.pendingPurchaseIntent.findFirst({
    where: {
      provider: "GOOGLE_PLAY",
      token: obfuscatedAccountId,
      consumedAt: null,
    },
    select: { id: true, userId: true },
  });
  if (!intent) {
    // verify-purchase側の到達を待つ必要がある取りこぼし。リトライされるようエラーにする。
    throw new Error(`google subscription ${purchaseToken}: no matching PendingPurchaseIntent yet`);
  }

  await prisma.$transaction([
    prisma.subscription.create({
      data: { userId: intent.userId, googleObfuscatedAccountId: obfuscatedAccountId, ...data },
    }),
    prisma.pendingPurchaseIntent.update({
      where: { id: intent.id },
      data: { consumedAt: fetchStartedAt },
    }),
  ]);
  // Subscription行の確定後にacknowledgeする(既存行更新パスと同じ理由)。
  if (sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING" && productId) {
    await acknowledgeSubscription(purchaseToken, productId);
  }
  await detectMultiProvider(intent.userId);
}
