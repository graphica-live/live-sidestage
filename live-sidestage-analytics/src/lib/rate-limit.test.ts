import { describe, it, expect, beforeEach, vi } from "vitest";
import { isRateLimited, resetRateLimit } from "./rate-limit";

describe("isRateLimited", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("上限に達するまでは制限しない", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect(isRateLimited(key, { max: 3, windowMs: 60_000 })).toBe(false);
    }
  });

  it("上限に達したら制限する", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      isRateLimited(key, { max: 3, windowMs: 60_000 });
    }
    expect(isRateLimited(key, { max: 3, windowMs: 60_000 })).toBe(true);
  });

  it("ウィンドウが過ぎたらリセットされる", () => {
    vi.useFakeTimers();
    try {
      const key = `test-${Math.random()}`;
      for (let i = 0; i < 3; i++) {
        isRateLimited(key, { max: 3, windowMs: 1_000 });
      }
      expect(isRateLimited(key, { max: 3, windowMs: 1_000 })).toBe(true);

      vi.advanceTimersByTime(1_001);
      expect(isRateLimited(key, { max: 3, windowMs: 1_000 })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resetRateLimitで即座にカウントが消える", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      isRateLimited(key, { max: 3, windowMs: 60_000 });
    }
    expect(isRateLimited(key, { max: 3, windowMs: 60_000 })).toBe(true);

    resetRateLimit(key);
    expect(isRateLimited(key, { max: 3, windowMs: 60_000 })).toBe(false);
  });

  it("異なるキーは互いに干渉しない", () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    isRateLimited(keyA, { max: 1, windowMs: 60_000 });
    expect(isRateLimited(keyA, { max: 1, windowMs: 60_000 })).toBe(true);
    expect(isRateLimited(keyB, { max: 1, windowMs: 60_000 })).toBe(false);
  });
});
