// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// Google Play Developer APIは実際には呼ばない(vi.mockで差し替える)。ここで検証したいのは
// 「既存Subscription行が本人名義なら再送(restored)としてintent照合をスキップする」
// 「他人名義の行・intent不一致は403で弾く」という認可境界そのもの(実装後レビュー指摘、
// 修正後diffの再レビューでテスト不在を指摘された)。
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-verify-purchase-secret";
process.env.GOOGLE_PLAY_PRODUCT_ID_PRO ||= "itest_google_play_pro_product";

vi.mock("@/lib/google-play", () => ({
  getSubscriptionV2: vi.fn(),
  acknowledgeSubscription: vi.fn(),
}));

import { getSubscriptionV2 } from "@/lib/google-play";
import { POST } from "./route";

const mockedGetSubscriptionV2 = vi.mocked(getSubscriptionV2);

function activeSubscription(obfuscatedAccountId: string) {
  return {
    lineItems: [{ productId: process.env.GOOGLE_PLAY_PRODUCT_ID_PRO, expiryTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }],
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    externalAccountIdentifiers: { obfuscatedExternalAccountId: obfuscatedAccountId },
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
  };
}

let userAId: string;
let userBId: string;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  const userA = await prisma.user.create({ data: { email: `itest-verify-purchase-a-${Date.now()}@local.test` } });
  userAId = userA.id;
  tokenA = signMobileToken({ userId: userAId });

  const userB = await prisma.user.create({ data: { email: `itest-verify-purchase-b-${Date.now()}@local.test` } });
  userBId = userB.id;
  tokenB = signMobileToken({ userId: userBId });
});

afterEach(async () => {
  mockedGetSubscriptionV2.mockReset();
  await prisma.subscription.deleteMany({ where: { userId: { in: [userAId, userBId] } } }).catch(() => {});
  await prisma.pendingPurchaseIntent.deleteMany({ where: { userId: { in: [userAId, userBId] } } }).catch(() => {});
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userAId } }).catch(() => {});
  await prisma.user.delete({ where: { id: userBId } }).catch(() => {});
  await prisma.$disconnect();
});

function request(bearer: string | undefined, purchaseToken: string | undefined) {
  return new NextRequest("http://localhost/api/mobile/billing/google/verify-purchase", {
    method: "POST",
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(purchaseToken === undefined ? {} : { purchaseToken }),
  });
}

describe("POST /api/mobile/billing/google/verify-purchase", () => {
  it("トークンが無ければ401", async () => {
    const res = await POST(request(undefined, "some-purchase-token"));
    expect(res.status).toBe(401);
  });

  it("purchaseTokenが無ければ400", async () => {
    const res = await POST(request(tokenA, undefined));
    expect(res.status).toBe(400);
  });

  it("新規購入: 本人が発行したPendingPurchaseIntentと一致すれば同期される", async () => {
    const obfuscatedAccountId = "itest-obfuscated-a-new";
    await prisma.pendingPurchaseIntent.create({
      data: {
        provider: "GOOGLE_PLAY",
        token: obfuscatedAccountId,
        userId: userAId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    mockedGetSubscriptionV2.mockResolvedValue(activeSubscription(obfuscatedAccountId) as never);

    const purchaseToken = "itest-purchase-token-new-1";
    const res = await POST(request(tokenA, purchaseToken));
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findUnique({
      where: { provider_providerSubscriptionId: { provider: "GOOGLE_PLAY", providerSubscriptionId: purchaseToken } },
    });
    expect(sub?.userId).toBe(userAId);
    expect(sub?.entitlementActive).toBe(true);
  });

  it("新規購入: 対応するPendingPurchaseIntentが無ければ403(別アカウントでの横流し防止)", async () => {
    mockedGetSubscriptionV2.mockResolvedValue(activeSubscription("itest-obfuscated-unmatched") as never);

    const res = await POST(request(tokenA, "itest-purchase-token-new-2"));
    expect(res.status).toBe(403);
  });

  it("既存Subscription行が本人名義なら、intentが無くても再送として通す(restored再検証)", async () => {
    const purchaseToken = "itest-purchase-token-existing-self";
    await prisma.subscription.create({
      data: {
        userId: userAId,
        provider: "GOOGLE_PLAY",
        providerSubscriptionId: purchaseToken,
        plan: "PRO",
        entitlementActive: true,
        lastVerifiedAt: new Date(Date.now() - 60_000),
      },
    });
    mockedGetSubscriptionV2.mockResolvedValue(activeSubscription("itest-obfuscated-existing-self") as never);

    const res = await POST(request(tokenA, purchaseToken));
    expect(res.status).toBe(200);
    expect(mockedGetSubscriptionV2).toHaveBeenCalled();
  });

  it("既存Subscription行が別ユーザー名義なら403(他人のpurchaseTokenの横取り不可)", async () => {
    const purchaseToken = "itest-purchase-token-existing-other";
    await prisma.subscription.create({
      data: {
        userId: userBId,
        provider: "GOOGLE_PLAY",
        providerSubscriptionId: purchaseToken,
        plan: "PRO",
        entitlementActive: true,
        lastVerifiedAt: new Date(Date.now() - 60_000),
      },
    });

    const res = await POST(request(tokenA, purchaseToken));
    expect(res.status).toBe(403);
    // 他人名義行の存在確認だけで弾いており、Google Play APIへは問い合わせない。
    expect(mockedGetSubscriptionV2).not.toHaveBeenCalled();
  });
});
