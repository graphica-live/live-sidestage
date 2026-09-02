import { describe, expect, it } from "vitest";
import { hasProtectedActiveWatcher, isLowValueCleanupDisabled } from "./tiktok-low-value-cleanup";

describe("isLowValueCleanupDisabled", () => {
  it("'true'文字列のときのみ無効扱い", () => {
    expect(isLowValueCleanupDisabled("true")).toBe(true);
    expect(isLowValueCleanupDisabled("false")).toBe(false);
    expect(isLowValueCleanupDisabled(null)).toBe(false);
    expect(isLowValueCleanupDisabled("")).toBe(false);
  });
});

describe("hasProtectedActiveWatcher", () => {
  const now = new Date("2026-09-02T00:00:00Z");

  it("lastActiveAtがnull(未記録)のユーザーは保護対象", () => {
    expect(hasProtectedActiveWatcher([{ lastActiveAt: null }], now)).toBe(true);
  });

  it("90日以内にアクティブなユーザーは保護対象", () => {
    const recent = new Date(now.getTime() - 10 * 86_400_000);
    expect(hasProtectedActiveWatcher([{ lastActiveAt: recent }], now)).toBe(true);
  });

  it("90日超アクティブが無いユーザーのみなら保護されない", () => {
    const old = new Date(now.getTime() - 100 * 86_400_000);
    expect(hasProtectedActiveWatcher([{ lastActiveAt: old }], now)).toBe(false);
  });

  it("視聴者がいない場合は保護されない", () => {
    expect(hasProtectedActiveWatcher([], now)).toBe(false);
  });

  it("1人でも保護対象がいれば全体として保護扱い", () => {
    const old = new Date(now.getTime() - 100 * 86_400_000);
    const recent = new Date(now.getTime() - 1 * 86_400_000);
    expect(hasProtectedActiveWatcher([{ lastActiveAt: old }, { lastActiveAt: recent }], now)).toBe(true);
  });
});
