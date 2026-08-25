import { describe, expect, it } from "vitest";
import { fitBracketName, nameWidthUnits } from "./bracket-name-fit";

describe("nameWidthUnits", () => {
  it("全角は1文字ぶん、半角は0.55文字ぶんとして数える", () => {
    expect(nameWidthUnits("あいう")).toBe(3);
    expect(nameWidthUnits("abc")).toBeCloseTo(1.65, 5);
    expect(nameWidthUnits("ｱｲｳ")).toBeCloseTo(1.65, 5);
  });

  it("前後の空白は数えない", () => {
    expect(nameWidthUnits("  あい  ")).toBe(2);
  });

  it("絵文字は全角より広く数え、幅を持たない合成用コードポイントは数えない", () => {
    expect(nameWidthUnits("🎤")).toBe(1.3);
    // 異体字セレクタ付きの絵文字も1文字ぶん。
    expect(nameWidthUnits("❤️")).toBe(1);
  });
});

describe("fitBracketName", () => {
  it("短い名前は上限サイズの1行になる", () => {
    expect(fitBracketName("あいう")).toEqual({ fontSizePx: 22, lines: 1 });
  });

  it("文字数が増えるほど小さくなる", () => {
    const short = fitBracketName("あいうえおか");
    const long = fitBracketName("あいうえおかき");
    expect(short.lines).toBe(1);
    expect(long.lines).toBe(1);
    expect(long.fontSizePx).toBeLessThan(short.fontSizePx);
  });

  it("半角だけの名前は同じ文字数の全角より大きく出せる", () => {
    const half = fitBracketName("abcdefg");
    const full = fitBracketName("あいうえおかき");
    expect(half.lines).toBe(1);
    expect(full.lines).toBe(1);
    expect(half.fontSizePx).toBeGreaterThan(full.fontSizePx);
  });

  it("1行だと下限を割る長さの名前は2行に折る", () => {
    const fit = fitBracketName("あいうえおかきくけ");
    expect(fit.lines).toBe(2);
    expect(fit.fontSizePx).toBe(16);
  });

  it("長い名前は1行のまま縮めず、2行に折って読めるサイズを保つ", () => {
    const fit = fitBracketName("streamer_kenta_1234");
    expect(fit.lines).toBe(2);
    // 1行のまま同じ幅へ詰めると 12px を割る長さ。2行なら上限の 16px を保てる。
    expect(fit.fontSizePx).toBe(16);
  });

  it("2行でも入りきらない名前は下限で止める", () => {
    const fit = fitBracketName("あ".repeat(40));
    expect(fit).toEqual({ fontSizePx: 9, lines: 2 });
  });

  it("scale を渡すと枠ごと拡大され、折り返しの判断は変わらない", () => {
    const short = fitBracketName("あいう", 1.2);
    expect(short).toEqual({ fontSizePx: 26.4, lines: 1 });

    // 等倍で2行に折れる名前は、拡大しても2行のまま(上限だけが上がる)。
    const long = fitBracketName("streamer_kenta_1234", 1.2);
    expect(long.lines).toBe(2);
    expect(long.fontSizePx).toBe(19.2);
  });

  it("空文字でも例外にせず上限サイズを返す", () => {
    expect(fitBracketName("")).toEqual({ fontSizePx: 22, lines: 1 });
    expect(fitBracketName("   ")).toEqual({ fontSizePx: 22, lines: 1 });
  });
});
