import { NextResponse } from "next/server";
import { verifyAndDecodeNotification, verifyAndDecodeTransaction } from "@/lib/apple-store-server";
import { syncSubscriptionFromApple } from "@/lib/plan/sync-subscription-apple";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const signedPayload = body?.signedPayload;
  if (typeof signedPayload !== "string") {
    return NextResponse.json({ error: "missing signedPayload" }, { status: 400 });
  }

  let originalTransactionId: string | undefined;
  try {
    const notification = await verifyAndDecodeNotification(signedPayload);
    const transactionInfo = notification.data?.signedTransactionInfo
      ? await verifyAndDecodeTransaction(notification.data.signedTransactionInfo)
      : undefined;
    originalTransactionId = transactionInfo?.originalTransactionId;
  } catch (err) {
    console.error("apple webhook signature verification failed", err);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  if (!originalTransactionId) {
    // subscriptionに関係ない通知種別(REFUND等でtransaction infoを含まないもの)は無視する。
    return NextResponse.json({ received: true });
  }

  try {
    await syncSubscriptionFromApple(originalTransactionId);
  } catch (err) {
    // 握り潰して200を返さない。App Store Server Notifications側の自動再送に乗せる。
    console.error("apple webhook handler failed", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
