// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// App Store Server APIは実際には呼ばない(vi.mockで差し替える)。ここで検証したいのは
// (1) クライアントが送るtransactionId(現在のtransaction)がoriginalTransactionIdと異なる
//     場合でも、サーバー側でoriginalTransactionIdを解決してから既存Subscription行を
//     照合できること(更新後・復元時の403回帰防止。Design Modeレビュー指摘、HIGH)
// (2) 既存Subscription行が本人名義なら再送(restored/更新)としてintent照合をスキップする
// (3) 他人名義の行・intent不一致は403で弾く、という認可境界そのもの
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-apple-verify-purchase-secret";
process.env.APPLE_PRODUCT_ID_PRO ||= "itest_apple_pro_product";

vi.mock("@/lib/apple-store-server", () => ({
  getAllSubscriptionStatuses: vi.fn(),
  verifyAndDecodeTransaction: vi.fn(),
}));

import { getAllSubscriptionStatuses, verifyAndDecodeTransaction } from "@/lib/apple-store-server";
import { POST } from "./route";

const mockedGetAllSubscriptionStatuses = vi.mocked(getAllSubscriptionStatuses);
const mockedVerifyAndDecodeTransaction = vi.mocked(verifyAndDecodeTransaction);

// getAllSubscriptionStatusesは常に「signedTransactionInfoを1件含むlastTransactions」を
// 返すダミー構造にしておき、実際のdecode結果はverifyAndDecodeTransaction側のmockで決める
// (route.ts側はsignedTransactionInfoの中身自体は見ず、decode結果のtransactionId/
// originalTransactionIdだけで一致判定する)。ただしsyncSubscriptionFromApple自身も
// 同じgetAllSubscriptionStatusesを呼び直し、そちらはApp Store Server APIの
// lastTransactions要素が持つoriginalTransactionIdフィールドで一致を探すため、
// ここにも同じ値を含めておく必要がある。
function statusesResponse(originalTransactionId: string) {
  return {
    data: [{ lastTransactions: [{ signedTransactionInfo: "dummy-jws", originalTransactionId }] }],
  } as never;
}

function decodedPayload(opts: {
  transactionId: string;
  originalTransactionId: string;
  appAccountToken?: string;
}) {
  return {
    transactionId: opts.transactionId,
    originalTransactionId: opts.originalTransactionId,
    appAccountToken: opts.appAccountToken,
    productId: process.env.APPLE_PRODUCT_ID_PRO,
  } as never;
}

let userAId: string;
let userBId: string;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  // email prefixは"itest-apple-"にしないこと。apple-account.integration.test.tsの
  // PREFIX="itest-apple-"のdeleteMany({ email: { startsWith } })と前方一致し、全体テスト実行時に
  // 他ファイルのクリーンアップでここのuserA/Bが消され、Subscription.createがFK違反で落ちる
  // (実装後レビュー指摘。単体実行では再現せず、pre-commitのnpm test全体実行でのみ再現した)。
  const userA = await prisma.user.create({ data: { email: `itest-applebilling-verify-a-${Date.now()}@local.test` } });
  userAId = userA.id;
  tokenA = signMobileToken({ userId: userAId });

  const userB = await prisma.user.create({ data: { email: `itest-applebilling-verify-b-${Date.now()}@local.test` } });
  userBId = userB.id;
  tokenB = signMobileToken({ userId: userBId });
});

afterEach(async () => {
  mockedGetAllSubscriptionStatuses.mockReset();
  mockedVerifyAndDecodeTransaction.mockReset();
  await prisma.subscription.deleteMany({ where: { userId: { in: [userAId, userBId] } } }).catch(() => {});
  await prisma.pendingPurchaseIntent.deleteMany({ where: { userId: { in: [userAId, userBId] } } }).catch(() => {});
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userAId } }).catch(() => {});
  await prisma.user.delete({ where: { id: userBId } }).catch(() => {});
  await prisma.$disconnect();
});

function request(bearer: string | undefined, transactionId: string | undefined) {
  return new NextRequest("http://localhost/api/mobile/billing/apple/verify-purchase", {
    method: "POST",
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(transactionId === undefined ? {} : { transactionId }),
  });
}

describe("POST /api/mobile/billing/apple/verify-purchase", () => {
  it("トークンが無ければ401", async () => {
    const res = await POST(request(undefined, "some-transaction-id"));
    expect(res.status).toBe(401);
  });

  it("transactionIdが無ければ400", async () => {
    const res = await POST(request(tokenA, undefined));
    expect(res.status).toBe(400);
  });

  it("一致するtransactionが見つからなければ400", async () => {
    mockedGetAllSubscriptionStatuses.mockResolvedValue(statusesResponse("unrelated-original"));
    mockedVerifyAndDecodeTransaction.mockResolvedValue(
      decodedPayload({ transactionId: "unrelated-tx", originalTransactionId: "unrelated-original" }),
    );

    const res = await POST(request(tokenA, "itest-apple-tx-no-match"));
    expect(res.status).toBe(400);
  });

  it("新規購入: 本人が発行したPendingPurchaseIntentと一致すれば同期される", async () => {
    const appAccountToken = "itest-apple-app-account-a-new";
    await prisma.pendingPurchaseIntent.create({
      data: {
        provider: "APPLE",
        token: appAccountToken,
        userId: userAId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const transactionId = "itest-apple-tx-new-1";
    mockedGetAllSubscriptionStatuses.mockResolvedValue(statusesResponse(transactionId));
    mockedVerifyAndDecodeTransaction.mockResolvedValue(
      decodedPayload({ transactionId, originalTransactionId: transactionId, appAccountToken }),
    );

    const res = await POST(request(tokenA, transactionId));
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findUnique({
      where: { provider_providerSubscriptionId: { provider: "APPLE", providerSubscriptionId: transactionId } },
    });
    expect(sub?.userId).toBe(userAId);
  });

  it("新規購入: 対応するPendingPurchaseIntentが無ければ403(別アカウントでの横流し防止)", async () => {
    const transactionId = "itest-apple-tx-new-2";
    mockedGetAllSubscriptionStatuses.mockResolvedValue(statusesResponse(transactionId));
    mockedVerifyAndDecodeTransaction.mockResolvedValue(
      decodedPayload({
        transactionId,
        originalTransactionId: transactionId,
        appAccountToken: "itest-apple-app-account-unmatched",
      }),
    );

    const res = await POST(request(tokenA, transactionId));
    expect(res.status).toBe(403);
  });

  it("既存Subscription行が本人名義なら、更新後のtransactionId(≠originalTransactionId)でも再送として通す", async () => {
    const originalTransactionId = "itest-apple-original-self";
    const renewedTransactionId = "itest-apple-renewed-self"; // originalとは別id(更新後)
    await prisma.subscription.create({
      data: {
        userId: userAId,
        provider: "APPLE",
        providerSubscriptionId: originalTransactionId,
        plan: "PRO",
        entitlementActive: true,
        lastVerifiedAt: new Date(Date.now() - 60_000),
      },
    });
    mockedGetAllSubscriptionStatuses.mockResolvedValue(statusesResponse(originalTransactionId));
    mockedVerifyAndDecodeTransaction.mockResolvedValue(
      decodedPayload({ transactionId: renewedTransactionId, originalTransactionId }),
    );

    // クライアントが送るのは更新後のtransactionId。intentは無い(再送/更新のため不要)。
    const res = await POST(request(tokenA, renewedTransactionId));
    expect(res.status).toBe(200);
    expect(mockedVerifyAndDecodeTransaction).toHaveBeenCalled();
  });

  it("既存Subscription行が別ユーザー名義なら403(他人のtransactionの横取り不可)", async () => {
    const originalTransactionId = "itest-apple-original-other";
    await prisma.subscription.create({
      data: {
        userId: userBId,
        provider: "APPLE",
        providerSubscriptionId: originalTransactionId,
        plan: "PRO",
        entitlementActive: true,
        lastVerifiedAt: new Date(Date.now() - 60_000),
      },
    });
    mockedGetAllSubscriptionStatuses.mockResolvedValue(statusesResponse(originalTransactionId));
    mockedVerifyAndDecodeTransaction.mockResolvedValue(
      decodedPayload({ transactionId: originalTransactionId, originalTransactionId }),
    );

    const res = await POST(request(tokenA, originalTransactionId));
    expect(res.status).toBe(403);
  });
});
