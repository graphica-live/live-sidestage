// isAppleBillingConfigured()のみを対象にしたunit test(DB不要)。verify-purchase/webhookで
// 初めて環境変数不足に気づくと購入だけ成立して検証が全滅する問題への対策(Design Modeレビュー
// 指摘、HIGH)で、init APIがこれを使って導線自体を止める。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAppleBillingConfigured } from "./apple-store-server";

const REQUIRED_VARS = [
  "APPLE_APP_STORE_PRIVATE_KEY",
  "APPLE_APP_STORE_KEY_ID",
  "APPLE_APP_STORE_ISSUER_ID",
  "APPLE_BUNDLE_ID",
  "APPLE_ROOT_CA_BASE64_LIST",
  "APPLE_APP_APPLE_ID",
  "APPLE_PRODUCT_ID_PRO",
  "APPLE_PRODUCT_ID_ULTRA",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of REQUIRED_VARS) {
    savedEnv[name] = process.env[name];
    process.env[name] = `itest-${name}`;
  }
});

afterEach(() => {
  for (const name of REQUIRED_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

describe("isAppleBillingConfigured", () => {
  it("必須環境変数が全て揃っていればtrue", () => {
    expect(isAppleBillingConfigured()).toBe(true);
  });

  for (const missing of REQUIRED_VARS) {
    it(`${missing}が未設定ならfalse`, () => {
      delete process.env[missing];
      expect(isAppleBillingConfigured()).toBe(false);
    });
  }
});
