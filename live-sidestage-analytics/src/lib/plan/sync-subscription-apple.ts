import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getAllSubscriptionStatuses,
  verifyAndDecodeTransaction,
  verifyAndDecodeRenewalInfo,
} from "@/lib/apple-store-server";
import { planForAppleProductId } from "./mobile-store-products";
import { detectMultiProvider } from "./detect-multi-provider";

// Prismaのunique constraint違反(P2002)かどうかを判定する(Stripe版sync-subscription.tsと同じ)。
function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// App Store ServerのSubscriptionStatus。1=ACTIVE, 2=EXPIRED, 3=BILLING_RETRY,
// 4=BILLING_GRACE_PERIOD, 5=REVOKED。ACTIVE/BILLING_GRACE_PERIODのみentitlement維持。
const ENTITLED_STATUSES = new Set([1, 4]);

// App Store Server Notificationsは合図だけ、常にApp Store Server APIへre-fetchして収束させる。
// userId解決に失敗した場合はno-op(200)を返さず、呼び出し元(webhook route)へ例外を投げる
// (非2xxで再送されるため、verify-purchase未達の取りこぼしをリトライで拾える)。
export async function syncSubscriptionFromApple(originalTransactionId: string): Promise<void> {
  const fetchStartedAt = new Date();
  const statuses = await getAllSubscriptionStatuses(originalTransactionId);

  const lastTransaction = statuses.data
    ?.flatMap((g) => g.lastTransactions ?? [])
    .find((t) => t.originalTransactionId === originalTransactionId);
  if (!lastTransaction?.signedTransactionInfo) {
    throw new Error(`apple transaction ${originalTransactionId}: no matching lastTransaction found`);
  }

  const transactionInfo = await verifyAndDecodeTransaction(lastTransaction.signedTransactionInfo);
  const renewalInfo = lastTransaction.signedRenewalInfo
    ? await verifyAndDecodeRenewalInfo(lastTransaction.signedRenewalInfo)
    : undefined;

  const status = typeof lastTransaction.status === "number" ? lastTransaction.status : 0;
  const isEntitled = ENTITLED_STATUSES.has(status);
  const productId = transactionInfo.productId;
  const plan = isEntitled && productId ? (planForAppleProductId(productId) ?? "FREE") : "FREE";
  // 未知productId(設定漏れ・変更)ならplanはFREEに落ちるが、entitlementActiveをisEntitled
  // だけで決めるとFREEなのにactiveな行ができる(実装後レビュー指摘、Stripe/Google版と同種)。
  const entitlementActive = isEntitled && plan !== "FREE";

  const data = {
    plan,
    provider: "APPLE" as const,
    providerSubscriptionId: originalTransactionId,
    appleProductId: productId ?? null,
    rawStatus: String(status),
    entitlementActive,
    lastVerifiedAt: fetchStartedAt,
    currentPeriodEnd: transactionInfo.expiresDate ? new Date(transactionInfo.expiresDate) : null,
    cancelAtPeriodEnd: renewalInfo?.autoRenewStatus === 0,
  };

  const existing = await prisma.subscription.findUnique({
    where: {
      provider_providerSubscriptionId: {
        provider: "APPLE",
        providerSubscriptionId: originalTransactionId,
      },
    },
    select: { id: true, userId: true, lastVerifiedAt: true },
  });

  if (existing) {
    // check-then-actでは2並行呼び出しが両方とも古いlastVerifiedAtを読んで両方通過し得るため、
    // 比較をupdateMany自体のWHEREへ入れて原子的にする(Stripe/Google版と同じ理由)。
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

  const appAccountToken = transactionInfo.appAccountToken;
  if (!appAccountToken) {
    throw new Error(`apple transaction ${originalTransactionId} has no appAccountToken`);
  }

  // expiresAtで絞らない理由はGoogle版と同じ: 横流し防止の実体はTTLではなくtoken自体が
  // サーバー発行のrandomUUIDでuserIdに束縛される点にあり、TTLはあくまで掃除用の目安。
  // Notification配信はユーザー操作から独立して遅延しうるため、TTL超過だけで正規購入が
  // 永久に紐付け不能になるのを避ける。
  const intent = await prisma.pendingPurchaseIntent.findFirst({
    where: {
      provider: "APPLE",
      token: appAccountToken,
      consumedAt: null,
    },
    select: { id: true, userId: true },
  });
  if (!intent) {
    throw new Error(`apple transaction ${originalTransactionId}: no matching PendingPurchaseIntent yet`);
  }

  try {
    await prisma.$transaction([
      prisma.subscription.create({
        data: { userId: intent.userId, appleAppAccountToken: appAccountToken, ...data },
      }),
      prisma.pendingPurchaseIntent.update({
        where: { id: intent.id },
        data: { consumedAt: fetchStartedAt },
      }),
    ]);
  } catch (error) {
    // iOS版は起動時のunfinishedTransactions回収(_recoverUnfinishedTransactions)と
    // purchaseStreamの両方が同じtransactionを検証しうるため、Stripe/Google版よりも
    // createの並行衝突が起きやすい(実装後レビュー指摘、HIGH — 修正前は初回購入直後に
    // 高確率でユーザー可視のエラーになっていた)。userIdに一意制約は無いため、ここで
    // 起きうるP2002は複合unique(provider, providerSubscriptionId)の衝突のみ。
    if (isUniqueConstraintError(error)) {
      const raceRow = await prisma.subscription.findUnique({
        where: {
          provider_providerSubscriptionId: { provider: "APPLE", providerSubscriptionId: originalTransactionId },
        },
        select: { id: true },
      });
      if (raceRow) {
        await prisma.subscription.update({ where: { id: raceRow.id }, data });
        // intentは敗者側なので未消費のままになるが、consumedAt: nullのままでも次回の
        // 横流し防止判定には影響しない(勝者側で既にSubscription行が本人名義で存在する
        // ため、以後のverify-purchaseはexisting分岐に入りintent照合自体を通らない)。
        await detectMultiProvider(intent.userId);
        return;
      }
    }
    throw error;
  }
  await detectMultiProvider(intent.userId);
}
