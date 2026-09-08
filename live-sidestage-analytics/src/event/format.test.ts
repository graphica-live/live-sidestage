import { describe, it, expect } from "vitest";
import { formatNumber, formatPoints } from "./format";

describe("formatNumber", () => {
  it("3桁ごとにカンマを入れる", () => {
    expect(formatNumber("1234567")).toBe("1,234,567");
  });

  it("3桁以下はそのまま", () => {
    expect(formatNumber("0")).toBe("0");
    expect(formatNumber("999")).toBe("999");
  });

  it("1000は境界としてカンマが1つ入る", () => {
    expect(formatNumber("1000")).toBe("1,000");
  });

  it("負数は符号を保ったまま整数部だけ区切る", () => {
    expect(formatNumber("-1234567")).toBe("-1,234,567");
  });

  it("小数部は区切らない", () => {
    expect(formatNumber("1234567.89")).toBe("1,234,567.89");
    expect(formatNumber("-1234.5")).toBe("-1,234.5");
  });

  // Number へ落とすと 2^53 超で桁が壊れる。BigInt 由来の文字列をそのまま扱うことの回帰。
  it("Number.MAX_SAFE_INTEGER を超える桁数でも精度を落とさない", () => {
    expect(formatNumber("9007199254740993")).toBe("9,007,199,254,740,993");
    expect(formatNumber("123456789012345678901234567890")).toBe(
      "123,456,789,012,345,678,901,234,567,890"
    );
  });
});

describe("formatPoints", () => {
  it("小数部が .00 なら落とす", () => {
    expect(formatPoints("1234.00")).toBe("1,234");
  });

  it(".00 以外の小数部は残す", () => {
    expect(formatPoints("1234.50")).toBe("1,234.50");
    expect(formatPoints("1234.05")).toBe("1,234.05");
  });

  it("小数部が無い値はそのまま区切る", () => {
    expect(formatPoints("1234")).toBe("1,234");
  });

  it("負数でも .00 を落とす", () => {
    expect(formatPoints("-1234.00")).toBe("-1,234");
  });
});
