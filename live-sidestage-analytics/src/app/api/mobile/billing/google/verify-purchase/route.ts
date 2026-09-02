import { NextRequest, NextResponse } from "next/server";
import { resolveActiveMobileUser } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { getSubscriptionV2 } from "@/lib/google-play";
import { syncSubscriptionFromGoogle } from "@/lib/plan/sync-subscription-google";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await resolveActiveMobileUser(req);
  if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const purchaseToken = body?.purchaseToken;
  if (typeof purchaseToken !== "string" || purchaseToken.length === 0) {
    return NextResponse.json({ error: "purchaseToken is required" }, { status: 400 });
  }

  // 既にこのpurchaseTokenのSubscription行が本人名義で存在するなら、再インストール後の
  // restoredフロー等での再送とみなしintent照合をスキップする(syncSubscriptionFromGoogle
  // 側も新規行作成時のみintentを要求する設計と揃える。実装後レビュー指摘: initを跨いだ
  // restoredはPendingPurchaseIntentが古い消費済みトークンのままで、ここで無条件に
  // intentを要求すると「別のアカウント」として恒久的に復元が失敗していた)。
  const existing = await prisma.subscription.findUnique({
    where: {
      provider_providerSubscriptionId: { provider: "GOOGLE_PLAY", providerSubscriptionId: purchaseToken },
    },
    select: { userId: true },
  });
  if (existing && existing.userId !== auth.userId) {
    return NextResponse.json({ error: "この購入は別のアカウントで開始されました" }, { status: 403 });
  }

  if (!existing) {
    // 横流し防止: obfuscatedExternalAccountIdが、このユーザー自身が発行させた
    // PendingPurchaseIntentと一致することを確認してから同期する(初回紐付け時のみ)。
    const sub = await getSubscriptionV2(purchaseToken);
    const obfuscatedAccountId = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if (!obfuscatedAccountId) {
      return NextResponse.json({ error: "購入情報を確認できませんでした" }, { status: 400 });
    }

    const intent = await prisma.pendingPurchaseIntent.findFirst({
      where: {
        provider: "GOOGLE_PLAY",
        token: obfuscatedAccountId,
        userId: auth.userId,
        consumedAt: null,
      },
      select: { id: true },
    });
    if (!intent) {
      return NextResponse.json({ error: "この購入は別のアカウントで開始されました" }, { status: 403 });
    }
  }

  await syncSubscriptionFromGoogle(purchaseToken);

  return NextResponse.json({ ok: true });
}
