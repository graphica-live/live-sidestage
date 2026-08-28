import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { priceIdForPlan, isPlanPurchasable, planForPriceId } from "./price-map";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.STRIPE_PRICE_PRO;
  delete process.env.STRIPE_PRICE_ULTRA;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("price-map", () => {
  it("Price ID未設定(空文字含む)は購入不可として扱う", () => {
    expect(priceIdForPlan("PRO")).toBeUndefined();
    expect(isPlanPurchasable("PRO")).toBe(false);

    process.env.STRIPE_PRICE_PRO = "";
    expect(priceIdForPlan("PRO")).toBeUndefined();
    expect(isPlanPurchasable("PRO")).toBe(false);
  });

  it("設定済みのPrice IDを解決できる(相互変換)", () => {
    process.env.STRIPE_PRICE_PRO = "price_pro_123";
    process.env.STRIPE_PRICE_ULTRA = "price_ultra_456";

    expect(priceIdForPlan("PRO")).toBe("price_pro_123");
    expect(isPlanPurchasable("PRO")).toBe(true);
    expect(planForPriceId("price_pro_123")).toBe("PRO");
    expect(planForPriceId("price_ultra_456")).toBe("ULTRA");
  });

  it("未知のPrice IDはundefinedを返す", () => {
    process.env.STRIPE_PRICE_PRO = "price_pro_123";
    expect(planForPriceId("price_unknown")).toBeUndefined();
  });
});
