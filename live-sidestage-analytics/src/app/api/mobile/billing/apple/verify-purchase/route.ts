import { NextRequest, NextResponse } from "next/server";
import { resolveActiveMobileUser } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { getAllSubscriptionStatuses, verifyAndDecodeTransaction } from "@/lib/apple-store-server";
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

  // 初回購入直後のtransactionIdはoriginalTransactionIdと一致する(App Storeの仕様)。
  const statuses = await getAllSubscriptionStatuses(transactionId);
  const lastTransaction = statuses.data
    ?.flatMap((g) => g.lastTransactions ?? [])
    .find((t) => t.originalTransactionId === transactionId);
  if (!lastTransaction?.signedTransactionInfo) {
    return NextResponse.json({ error: "購入情報を確認できませんでした" }, { status: 400 });
  }

  const transactionInfo = await verifyAndDecodeTransaction(lastTransaction.signedTransactionInfo);
  const appAccountToken = transactionInfo.appAccountToken;
  if (!appAccountToken) {
    return NextResponse.json({ error: "購入情報を確認できませんでした" }, { status: 400 });
  }

  // 横流し防止: appAccountTokenが、このユーザー自身が発行させたPendingPurchaseIntentと
  // 一致することを確認してから同期する。
  const intent = await prisma.pendingPurchaseIntent.findFirst({
    where: {
      provider: "APPLE",
      token: appAccountToken,
      userId: auth.userId,
      consumedAt: null,
    },
    select: { id: true },
  });
  if (!intent) {
    return NextResponse.json({ error: "この購入は別のアカウントで開始されました" }, { status: 403 });
  }

  await syncSubscriptionFromApple(transactionId);

  return NextResponse.json({ ok: true });
}
