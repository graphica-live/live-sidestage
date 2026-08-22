import { describe, it, expect } from "vitest";
import { formatJst, formatJstRange, parseJstLocal, toJstInputValue } from "./datetime";

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

  it("実在しない日時は繰り上げずにnullを返す", () => {
    // Date.UTC は黙って繰り上げる("2026-02-31" → 3/3、"25:00" → 翌日1時)。
    // 日程を複数入力させるので、こういう値が混ざると重なり検査まで狂う。
    expect(parseJstLocal("2026-02-31T20:00")).toBeNull();
    expect(parseJstLocal("2026-13-01T20:00")).toBeNull();
    expect(parseJstLocal("2026-09-01T25:00")).toBeNull();
    expect(parseJstLocal("2026-09-01T20:60")).toBeNull();
  });

  it("うるう年の2/29は通す", () => {
    expect(parseJstLocal("2028-02-29T20:00")?.toISOString()).toBe("2028-02-29T11:00:00.000Z");
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

describe("formatJstRange", () => {
  it("同じ日に収まるなら終わりは時刻だけ", () => {
    expect(
      formatJstRange(new Date("2026-09-01T13:00:00.000Z"), new Date("2026-09-01T14:00:00.000Z"))
    ).toBe("2026/09/01 22:00 〜 23:00");
  });

  it("JSTで日をまたぐなら終わりも日付から出す", () => {
    expect(
      formatJstRange(new Date("2026-09-01T14:00:00.000Z"), new Date("2026-09-01T16:00:00.000Z"))
    ).toBe("2026/09/01 23:00 〜 2026/09/02 01:00");
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
