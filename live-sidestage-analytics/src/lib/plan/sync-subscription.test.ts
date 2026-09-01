import { describe, it, expect, vi, beforeEach } from "vitest";

const retrieve = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ subscriptions: { retrieve } }),
}));

const findUnique = vi.fn();
const findFirst = vi.fn();
const findMany = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
const create = vi.fn();
const findUserUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      findFirst: (...args: unknown[]) => findFirst(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      update: (...args: unknown[]) => update(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
      create: (...args: unknown[]) => create(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => findUserUnique(...args),
    },
  },
}));

vi.mock("./price-map", () => ({
  planForPriceId: (priceId: string) => (priceId === "price_pro_123" ? "PRO" : undefined),
}));

import { syncSubscriptionFromStripe } from "./sync-subscription";

function fakeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    cancel_at_period_end: false,
    metadata: { userId: "user_123" },
    items: {
      data: [
        {
          price: { id: "price_pro_123" },
          current_period_end: 1_700_000_000,
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  retrieve.mockReset();
  findUnique.mockReset();
  findFirst.mockReset();
  findMany.mockReset();
  update.mockReset();
  updateMany.mockReset();
  create.mockReset();
  findUserUnique.mockReset();
  // upsert経路(既存Subscription行が無い)のテストは、Userが実在する前提のものが大半。
  // no-op分岐だけ個別に上書きする。
  findUserUnique.mockResolvedValue({ id: "user_123" });
  // detectMultiProviderが呼ぶfindMany(cross-provider検知)。テスト対象外なので空配列固定。
  findMany.mockResolvedValue([]);
  // 既存行更新パスはCAS(条件付きupdateMany)。既定は「自分の書き込みが勝つ」を1件更新扱いにする。
  updateMany.mockResolvedValue({ count: 1 });
});

describe("syncSubscriptionFromStripe", () => {
  it("既存行がある場合はproviderSubscriptionIdで更新する(payloadでなくretrieve結果を使う)", async () => {
    retrieve.mockResolvedValue(fakeSubscription());
    findUnique.mockResolvedValue({ id: "row_1", userId: "user_123", lastVerifiedAt: null });

    await syncSubscriptionFromStripe("sub_123");

    expect(retrieve).toHaveBeenCalledWith("sub_123");
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider_providerSubscriptionId: { provider: "STRIPE", providerSubscriptionId: "sub_123" } },
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "row_1",
        OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lte: expect.any(Date) } }],
      },
      data: expect.objectContaining({
        plan: "PRO",
        provider: "STRIPE",
        providerSubscriptionId: "sub_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        stripePriceId: "price_pro_123",
        status: "active",
        entitlementActive: true,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(1_700_000_000 * 1000),
      }),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("既存行が無ければmetadata.userIdでcreateする", async () => {
    retrieve.mockResolvedValue(fakeSubscription());
    findUnique.mockResolvedValue(null);

    await syncSubscriptionFromStripe("sub_123");

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user_123", plan: "PRO", provider: "STRIPE" }),
    });
  });

  it("canceledはFREEへ収束する(price/plan導出よりstatusを優先)", async () => {
    retrieve.mockResolvedValue(fakeSubscription({ status: "canceled" }));
    findUnique.mockResolvedValue({ id: "row_1", userId: "user_123", lastVerifiedAt: null });

    await syncSubscriptionFromStripe("sub_123");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plan: "FREE", status: "canceled", entitlementActive: false }),
      }),
    );
  });

  it("past_dueは猶予期間として有償プランを維持する", async () => {
    retrieve.mockResolvedValue(fakeSubscription({ status: "past_due" }));
    findUnique.mockResolvedValue({ id: "row_1", userId: "user_123", lastVerifiedAt: null });

    await syncSubscriptionFromStripe("sub_123");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ plan: "PRO", entitlementActive: true }) }),
    );
  });

  it("並行呼び出しが先に新しいlastVerifiedAtを書いていた場合、updateManyのWHEREに一致せずcount:0になる(古いfetch結果による上書き防止)", async () => {
    retrieve.mockResolvedValue(fakeSubscription());
    findUnique.mockResolvedValue({
      id: "row_1",
      userId: "user_123",
      lastVerifiedAt: new Date(Date.now() + 60_000),
    });
    updateMany.mockResolvedValue({ count: 0 });

    await syncSubscriptionFromStripe("sub_123");

    expect(updateMany).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    // count:0(WHERE不一致)ならdetectMultiProviderも呼ばない= 追加のfindManyが起きない。
    expect(findMany).not.toHaveBeenCalled();
  });

  it("既存行が無くmetadata.userIdも無ければ例外を投げる", async () => {
    retrieve.mockResolvedValue(fakeSubscription({ metadata: {} }));
    findUnique.mockResolvedValue(null);

    await expect(syncSubscriptionFromStripe("sub_123")).rejects.toThrow(/metadata\.userId/);
    expect(create).not.toHaveBeenCalled();
  });

  it("既存行が無くUserも既に削除済みならno-opで例外を投げない(アカウント削除後の遅延webhook対策)", async () => {
    retrieve.mockResolvedValue(fakeSubscription());
    findUnique.mockResolvedValue(null);
    findUserUnique.mockResolvedValue(null);

    await expect(syncSubscriptionFromStripe("sub_123")).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it("createが複合unique(provider, providerSubscriptionId)とのレースでP2002を返したら同じ複合keyでupdateへフォールバックする", async () => {
    retrieve.mockResolvedValue(fakeSubscription());
    // 1回目(既存行チェック)はnull、2回目(P2002後の再取得)はレース相手の行を返す。
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "row_race" });
    const { Prisma } = await import("@prisma/client");
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      }),
    );

    await syncSubscriptionFromStripe("sub_123");

    expect(findFirst).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { provider_providerSubscriptionId: { provider: "STRIPE", providerSubscriptionId: "sub_123" } },
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "row_race" } }),
    );
  });
});
