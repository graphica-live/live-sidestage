import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const del = vi.fn();

class FakeStripeInvalidRequestError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

vi.mock("stripe", () => {
  class FakeStripe {
    customers = { del: (...args: unknown[]) => del(...args) };
    static errors = { StripeInvalidRequestError: FakeStripeInvalidRequestError };
  }
  return { default: FakeStripe };
});

beforeEach(() => {
  del.mockReset();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("deleteStripeCustomer", () => {
  it("stripe.customers.del()を呼ぶ", async () => {
    del.mockResolvedValue({ deleted: true });
    const { deleteStripeCustomer } = await import("./stripe");

    await deleteStripeCustomer("cus_123");

    expect(del).toHaveBeenCalledWith("cus_123");
  });

  it("既に削除済み(resource_missing)は成功扱いにする(冪等リトライ対策)", async () => {
    del.mockRejectedValue(new FakeStripeInvalidRequestError("No such customer", "resource_missing"));
    const { deleteStripeCustomer } = await import("./stripe");

    await expect(deleteStripeCustomer("cus_gone")).resolves.toBeUndefined();
  });

  it("resource_missing以外のエラーはそのまま投げる", async () => {
    del.mockRejectedValue(new FakeStripeInvalidRequestError("rate limited", "rate_limit"));
    const { deleteStripeCustomer } = await import("./stripe");

    await expect(deleteStripeCustomer("cus_err")).rejects.toThrow("rate limited");
  });
});
