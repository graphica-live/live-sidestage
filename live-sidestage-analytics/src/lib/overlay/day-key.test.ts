import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jstDateKey, shiftDayKey, resolveOverlayDayKey, inferOverlayDisplayReference } from "./day-key";

describe("jstDateKey", () => {
  beforeEach(() => {
    // UTC 2026-08-15T20:00:00Z = JST 2026-08-16T05:00:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T20:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("UTC日付をまたいでいてもJSTの日付を返す", () => {
    expect(jstDateKey()).toBe("2026-08-16");
  });

  it("offsetDaysで日付をずらせる", () => {
    expect(jstDateKey(-1)).toBe("2026-08-15");
    expect(jstDateKey(1)).toBe("2026-08-17");
  });
});

describe("shiftDayKey", () => {
  it("正のoffsetで日付を進める", () => {
    expect(shiftDayKey("2026-08-15", 1)).toBe("2026-08-16");
  });

  it("負のoffsetで日付を戻す", () => {
    expect(shiftDayKey("2026-08-15", -1)).toBe("2026-08-14");
  });

  it("月末をまたぐ加算を正しく処理する", () => {
    expect(shiftDayKey("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("年末をまたぐ加算を正しく処理する", () => {
    expect(shiftDayKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("offset=0なら同じ日付を返す", () => {
    expect(shiftDayKey("2026-08-15", 0)).toBe("2026-08-15");
  });
});

describe("resolveOverlayDayKey", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("referenceがtodayなら常に現在のJST日付を返す", () => {
    const result = resolveOverlayDayKey({ overlayDisplayReference: "today", overlayDisplayDate: "2020-01-01" });
    expect(result).toBe(jstDateKey());
  });

  it("referenceがfixedなら指定日付を返す", () => {
    const result = resolveOverlayDayKey({ overlayDisplayReference: "fixed", overlayDisplayDate: "2026-01-01" });
    expect(result).toBe("2026-01-01");
  });

  it("fixedだが日付未設定なら現在のJST日付にフォールバックする", () => {
    const result = resolveOverlayDayKey({ overlayDisplayReference: "fixed", overlayDisplayDate: null });
    expect(result).toBe(jstDateKey());
  });
});

describe("inferOverlayDisplayReference", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("今日の日付ならtodayを返す", () => {
    expect(inferOverlayDisplayReference(jstDateKey())).toBe("today");
  });

  it("今日以外の日付ならfixedを返す", () => {
    expect(inferOverlayDisplayReference("2020-01-01")).toBe("fixed");
  });
});
