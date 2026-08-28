import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

const sync = vi.fn();
vi.mock("@/lib/plan/sync-subscription", () => ({
  syncSubscriptionFromStripe: (...args: unknown[]) => sync(...args),
}));

const webhookSecret = "whsec_test_secret";
// constructEvent/generateTestHeaderStringは純粋な署名計算でネットワークアクセスしないため、
// ダミーのsecret keyでも実際のStripeインスタンスを使って本物の署名検証を通せる。
const stripe = new Stripe("sk_test_dummy");

vi.mock("@/lib/stripe", () => ({
  getStripe: () => stripe,
}));

import { POST } from "./route";

function buildPayload(type: string, object: unknown) {
  return JSON.stringify({
    id: "evt_test",
    object: "event",
    type,
    data: { object },
  });
}

function buildRequest(payload: string, signature: string | null = null) {
  const headers = new Headers();
  if (signature !== null) headers.set("stripe-signature", signature);
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: payload,
  });
}

function sign(payload: string) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
}

beforeEach(() => {
  sync.mockReset();
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
});

describe("POST /api/webhooks/stripe", () => {
  it("STRIPE_WEBHOOK_SECRET未設定なら400", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const payload = buildPayload("ping", {});
    const res = await POST(buildRequest(payload, sign(payload)));
    expect(res.status).toBe(400);
    expect(sync).not.toHaveBeenCalled();
  });

  it("stripe-signatureヘッダが無ければ400", async () => {
    const res = await POST(buildRequest(buildPayload("ping", {}), null));
    expect(res.status).toBe(400);
    expect(sync).not.toHaveBeenCalled();
  });

  it("署名が不正なら400", async () => {
    const res = await POST(buildRequest(buildPayload("ping", {}), "t=1,v1=invalid"));
    expect(res.status).toBe(400);
    expect(sync).not.toHaveBeenCalled();
  });

  it("checkout.session.completed(subscription mode)はsession.subscriptionでsyncする", async () => {
    const payload = buildPayload("checkout.session.completed", {
      mode: "subscription",
      subscription: "sub_123",
    });
    const res = await POST(buildRequest(payload, sign(payload)));
    expect(res.status).toBe(200);
    expect(sync).toHaveBeenCalledWith("sub_123");
  });

  it("checkout.session.completed(payment mode)はsyncしない", async () => {
    const payload = buildPayload("checkout.session.completed", {
      mode: "payment",
      subscription: null,
    });
    const res = await POST(buildRequest(payload, sign(payload)));
    expect(res.status).toBe(200);
    expect(sync).not.toHaveBeenCalled();
  });

  it("customer.subscription.updatedはevent.data.object.idでsyncする", async () => {
    const payload = buildPayload("customer.subscription.updated", { id: "sub_456" });
    const res = await POST(buildRequest(payload, sign(payload)));
    expect(res.status).toBe(200);
    expect(sync).toHaveBeenCalledWith("sub_456");
  });

  it("customer.subscription.deletedも同じ関数でsyncする", async () => {
    const payload = buildPayload("customer.subscription.deleted", { id: "sub_789" });
    const res = await POST(buildRequest(payload, sign(payload)));
    expect(res.status).toBe(200);
    expect(sync).toHaveBeenCalledWith("sub_789");
  });

  it("未対応イベントはreceived:trueで早期returnする", async () => {
    const payload = buildPayload("invoice.paid", {});
    const res = await POST(buildRequest(payload, sign(payload)));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(sync).not.toHaveBeenCalled();
  });

  it("ハンドラ内で例外が起きたら握り潰さず500を返す", async () => {
    sync.mockRejectedValueOnce(new Error("stripe api down"));
    const payload = buildPayload("customer.subscription.updated", { id: "sub_err" });
    const res = await POST(buildRequest(payload, sign(payload)));
    expect(res.status).toBe(500);
  });
});
