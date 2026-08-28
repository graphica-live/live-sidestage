import { describe, it, expect } from "vitest";
import { hasFeature, FEATURE_REQUIREMENTS, type FeatureKey } from "./features";

describe("hasFeature", () => {
  it("未登録キーはfail-closed(常にfalse)", () => {
    // FeatureKeyの型ガードをすり抜けた実行時の不正値(typo・削除済みキー等)を想定。
    expect(hasFeature("ULTRA", "no-such-feature" as FeatureKey)).toBe(false);
  });

  it("要求プラン未満はfalse", () => {
    const feature = Object.keys(FEATURE_REQUIREMENTS)[0] as FeatureKey;
    expect(hasFeature("FREE", feature)).toBe(false);
  });

  it("要求プラン以上はtrue", () => {
    const feature = Object.keys(FEATURE_REQUIREMENTS)[0] as FeatureKey;
    expect(hasFeature("ULTRA", feature)).toBe(true);
  });
});
