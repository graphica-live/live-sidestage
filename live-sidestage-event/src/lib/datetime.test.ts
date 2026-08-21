import { describe, it, expect } from "vitest";
import { formatJst, parseJstLocal, toJstInputValue } from "./datetime";

describe("parseJstLocal", () => {
  it("入力値をJSTとして解釈する(サーバーのタイムゾーンに依存しない)", () => {
    // JST 20:00 = UTC 11:00
    expect(parseJstLocal("2026-09-01T20:00")?.toISOString()).toBe("2026-09-01T11:00:00.000Z");
  });

  it("JSTの0時台はUTCでは前日になる", () => {
    expect(parseJstLocal("2026-09-01T00:30")?.toISOString()).toBe("2026-08-31T15:30:00.000Z");
  });

  it("形式が違えばnullを返す", () => {
    expect(parseJstLocal("2026-09-01")).toBeNull();
    expect(parseJstLocal("2026/09/01 20:00")).toBeNull();
    expect(parseJstLocal("")).toBeNull();
  });
});

describe("toJstInputValue", () => {
  it("UTCのDateをJSTのinput値に戻す", () => {
    expect(toJstInputValue(new Date("2026-09-01T11:00:00.000Z"))).toBe("2026-09-01T20:00");
  });

  it("日付をまたぐ場合も正しく戻す", () => {
    expect(toJstInputValue(new Date("2026-08-31T15:30:00.000Z"))).toBe("2026-09-01T00:30");
  });

  it("parseJstLocalと往復できる", () => {
    const input = "2026-12-31T23:59";
    expect(toJstInputValue(parseJstLocal(input)!)).toBe(input);
  });
});

describe("formatJst", () => {
  it("JSTで表示する", () => {
    // ロケール実装の差を避けるため、数値の並びだけを確認する
    const formatted = formatJst(new Date("2026-09-01T11:00:00.000Z"));
    expect(formatted).toContain("2026");
    expect(formatted).toContain("20:00");
  });
});
