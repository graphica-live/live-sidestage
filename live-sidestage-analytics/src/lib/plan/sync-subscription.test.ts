import { describe, it, expect, vi, beforeEach } from "vitest";

const retrieve = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ subscriptions: { retrieve } }),
}));

const findUnique = vi.fn();
const update = vi.fn();
const upsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
      upsert: (...args: unknown[]) => upsert(...args),
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
  update.mockReset();
  upsert.mockReset();
});

describe("syncSubscriptionFromStripe", () => {
  it("既存行がある場合はstripeSubscriptionIdで更新する(payloadでなくretrieve結果を使う)", async () => {
    retrieve.mockResolvedValue(fakeSubscription());
    findUnique.mockResolvedValue({ id: "row_1" });

    await syncSubscriptionFromStripe("sub_123");

    expect(retrieve).toHaveBeenCalledWith("sub_123");
    expect(update).toHaveBeenCalledWith({
      where: { id: "row_1" },
      data: expect.objectContaining({
        plan: "PRO",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        stripePriceId: "price_pro_123",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(1_700_000_000 * 1000),
      }),
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("既存行が無ければmetadata.userIdでupsertする", async () => {
    retrieve.mockResolvedValue(fakeSubscription());
    findUnique.mockResolvedValue(null);

    await syncSubscriptionFromStripe("sub_123");

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_123" },
        create: expect.objectContaining({ userId: "user_123", plan: "PRO" }),
      }),
    );
  });

  it("canceledはFREEへ収束する(price/plan導出よりstatusを優先)", async () => {
    retrieve.mockResolvedValue(fakeSubscription({ status: "canceled" }));
    findUnique.mockResolvedValue({ id: "row_1" });

    await syncSubscriptionFromStripe("sub_123");

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ plan: "FREE", status: "canceled" }) }),
    );
  });

  it("past_dueは猶予期間として有償プランを維持する", async () => {
    retrieve.mockResolvedValue(fakeSubscription({ status: "past_due" }));
    findUnique.mockResolvedValue({ id: "row_1" });

    await syncSubscriptionFromStripe("sub_123");

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ plan: "PRO" }) }),
    );
  });

  it("既存行が無くmetadata.userIdも無ければ例外を投げる", async () => {
    retrieve.mockResolvedValue(fakeSubscription({ metadata: {} }));
    findUnique.mockResolvedValue(null);

    await expect(syncSubscriptionFromStripe("sub_123")).rejects.toThrow(/metadata\.userId/);
    expect(upsert).not.toHaveBeenCalled();
  });
});
