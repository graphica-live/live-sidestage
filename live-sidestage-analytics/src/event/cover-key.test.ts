import { describe, it, expect } from "vitest";
import { buildCoverKey, isValidCoverKey } from "./cover-key";

describe("buildCoverKey", () => {
  it("Content-Typeから拡張子を決めてキーを組み立てる", () => {
    const key = buildCoverKey("evt1", "image/png");
    expect(key).toMatch(/^events\/evt1\/cover-\d+\.png$/);
  });

  it("未対応のContent-Typeはnull", () => {
    expect(buildCoverKey("evt1", "image/gif")).toBeNull();
    expect(buildCoverKey("evt1", "application/pdf")).toBeNull();
  });
});

describe("isValidCoverKey", () => {
  it("自分のイベントの命名規則に一致すればtrue", () => {
    expect(isValidCoverKey("events/evt1/cover-1700000000000.jpg", "evt1")).toBe(true);
    expect(isValidCoverKey("events/evt1/cover-1700000000000.webp", "evt1")).toBe(true);
  });

  it("他イベントのキーはfalse(所有者検証)", () => {
    expect(isValidCoverKey("events/evt2/cover-1700000000000.jpg", "evt1")).toBe(false);
  });

  it("prefix一致だけでは通さない(完全一致)", () => {
    expect(isValidCoverKey("events/evt1/cover-1700000000000.jpg.evil", "evt1")).toBe(false);
    expect(isValidCoverKey("events/evt1/../evt2/cover-1.jpg", "evt1")).toBe(false);
  });

  it("命名規則から外れたキーはfalse", () => {
    expect(isValidCoverKey("events/evt1/not-a-cover.jpg", "evt1")).toBe(false);
    expect(isValidCoverKey("random-key", "evt1")).toBe(false);
  });
});
