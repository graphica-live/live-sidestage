import { NextRequest, NextResponse } from "next/server";
import { resolveActiveMobileUser } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import {
  getAllSubscriptionStatuses,
  verifyAndDecodeTransaction,
  isTransactionNotFoundError,
} from "@/lib/apple-store-server";
import { syncSubscriptionFromApple } from "@/lib/plan/sync-subscription-apple";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await resolveActiveMobileUser(req);
  if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const transactionId = body?.transactionId;
  if (typeof transactionId !== "string" || transactionId.length === 0) {
    return NextResponse.json({ error: "transactionId is required" }, { status: 400 });
  }

  // クライアントが送るtransactionIdは「現在のtransaction」のidで、StoreKit2では
  // 更新後・復元時にoriginalTransactionIdと異なりうる(Design Modeレビュー指摘、HIGH —
  // 以前はtransactionId===originalTransactionId前提で、更新後の復元がここで必ず失敗していた)。
  // getAllSubscriptionStatusesはサブスクグループ内の任意のtransaction idで呼べ、グループ
  // 全体のlastTransactionsを返す(Apple公式仕様)ため、まずグループを取得してから
  // decode後のpayloadでtransactionId/originalTransactionIdどちらかの一致を探す。
  let statuses;
  try {
    statuses = await getAllSubscriptionStatuses(transactionId);
  } catch (error) {
    // 実在しないtransactionId(壊れた/悪意あるクライアント)はProduction/Sandbox両方で
    // 404になり素通りだと500になる(実装後レビュー指摘、LOW)。クライアント起因なので400にする。
    if (isTransactionNotFoundError(error)) {
      return NextResponse.json({ error: "購入情報を確認できませんでした" }, { status: 400 });
    }
    throw error;
  }
  const lastTransactions = statuses.data?.flatMap((g) => g.lastTransactions ?? []) ?? [];

  let matchedOriginalTransactionId: string | undefined;
  let matchedAppAccountToken: string | undefined;
  for (const item of lastTransactions) {
    if (!item.signedTransactionInfo) continue;
    const payload = await verifyAndDecodeTransaction(item.signedTransactionInfo);
    if (payload.transactionId === transactionId || payload.originalTransactionId === transactionId) {
      matchedOriginalTransactionId = payload.originalTransactionId;
      matchedAppAccountToken = payload.appAccountToken;
      break;
    }
  }
  if (!matchedOriginalTransactionId) {
    return NextResponse.json({ error: "購入情報を確認できませんでした" }, { status: 400 });
  }

  // 既にこのoriginalTransactionIdのSubscription行が本人名義で存在するなら、更新後の
  // transactionや再インストール後のrestoredフロー等での再送とみなしintent照合をスキップする
  // (Google版verify-purchaseの再送分岐と対称。Design Modeレビュー指摘、HIGH — 従来はここが
  // 無く、restoreで恒久的に403になっていた)。
  const existing = await prisma.subscription.findUnique({
    where: {
      provider_providerSubscriptionId: {
        provider: "APPLE",
        providerSubscriptionId: matchedOriginalTransactionId,
      },
    },
    select: { userId: true },
  });
  if (existing && existing.userId !== auth.userId) {
    return NextResponse.json({ error: "この購入は別のアカウントで開始されました" }, { status: 403 });
  }

  if (!existing) {
    // 横流し防止: appAccountTokenが、このユーザー自身が発行させたPendingPurchaseIntentと
    // 一致することを確認してから同期する(初回紐付け時のみ)。
    if (!matchedAppAccountToken) {
      return NextResponse.json({ error: "購入情報を確認できませんでした" }, { status: 400 });
    }
    const intent = await prisma.pendingPurchaseIntent.findFirst({
      where: {
        provider: "APPLE",
        token: matchedAppAccountToken,
        userId: auth.userId,
        consumedAt: null,
      },
      select: { id: true },
    });
    if (!intent) {
      return NextResponse.json({ error: "この購入は別のアカウントで開始されました" }, { status: 403 });
    }
  }

  await syncSubscriptionFromApple(matchedOriginalTransactionId);

  return NextResponse.json({ ok: true });
}
