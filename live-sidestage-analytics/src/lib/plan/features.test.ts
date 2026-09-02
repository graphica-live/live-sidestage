import { describe, it, expect } from "vitest";
import { hasFeature, hasFeatureAccessSync, FEATURE_POLICIES, type FeatureKey } from "./features";

describe("hasFeature", () => {
  it("未登録キーはfail-closed(常にfalse)", () => {
    // FeatureKeyの型ガードをすり抜けた実行時の不正値(typo・削除済みキー等)を想定。
    expect(hasFeature("ULTRA", "no-such-feature" as FeatureKey)).toBe(false);
  });

  it("要求プラン未満はfalse", () => {
    const feature = Object.keys(FEATURE_POLICIES)[0] as FeatureKey;
    expect(hasFeature("FREE", feature)).toBe(false);
  });

  it("要求プラン以上はtrue", () => {
    const feature = Object.keys(FEATURE_POLICIES)[0] as FeatureKey;
    expect(hasFeature("ULTRA", feature)).toBe(true);
  });
});

describe("hasFeatureAccessSync", () => {
  it("未登録キーはfail-closed(常にfalse)", () => {
    expect(hasFeatureAccessSync("ULTRA", "no-such-feature" as FeatureKey, {})).toBe(false);
  });

  it("要求プランを満たせばβ状態に関わらずtrue", () => {
    expect(hasFeatureAccessSync("PRO", "mobile.history.extendedRange", {})).toBe(true);
  });

  it("要求プラン未満でも対応領域のβが有効ならtrue", () => {
    expect(
      hasFeatureAccessSync("FREE", "mobile.history.extendedRange", { analytics: true })
    ).toBe(true);
  });

  it("要求プラン未満で対応領域のβが無効ならfalse", () => {
    expect(
      hasFeatureAccessSync("FREE", "mobile.history.extendedRange", { analytics: false })
    ).toBe(false);
  });

  it("別領域のβが有効でも対象機能には影響しない", () => {
    expect(
      hasFeatureAccessSync("FREE", "mobile.history.extendedRange", { events: true, mobile: true })
    ).toBe(false);
  });

  it("betaAreaが未設定の機能は、βに関わらず要求プラン未満なら常にfalse", () => {
    expect(
      hasFeatureAccessSync("FREE", "mobile.entitlementProbe", {
        mobile: true,
        analytics: true,
        events: true,
      })
    ).toBe(false);
  });
});
