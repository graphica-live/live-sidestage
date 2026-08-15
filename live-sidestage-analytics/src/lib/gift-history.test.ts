import { describe, it, expect } from "vitest";
import { parseGiftEditInput, applyGiftEdit } from "./gift-history";

describe("parseGiftEditInput", () => {
  it("正常な入力を受け入れる", () => {
    expect(parseGiftEditInput({ giftName: "Rose", totalDiamonds: 100 })).toEqual({
      ok: true,
      giftName: "Rose",
      totalDiamonds: 100,
    });
  });

  it("ギフト名の前後空白をtrimする", () => {
    expect(parseGiftEditInput({ giftName: "  Rose  ", totalDiamonds: 1 })).toEqual({
      ok: true,
      giftName: "Rose",
      totalDiamonds: 1,
    });
  });

  it("コイン数は負の整数も許可する(大なり小なり両方OK)", () => {
    expect(parseGiftEditInput({ giftName: "Rose", totalDiamonds: -50 })).toEqual({
      ok: true,
      giftName: "Rose",
      totalDiamonds: -50,
    });
  });

  it("コイン数0も許可する", () => {
    expect(parseGiftEditInput({ giftName: "Rose", totalDiamonds: 0 })).toEqual({
      ok: true,
      giftName: "Rose",
      totalDiamonds: 0,
    });
  });

  it("ギフト名が空文字だとエラー", () => {
    const result = parseGiftEditInput({ giftName: "", totalDiamonds: 1 });
    expect(result.ok).toBe(false);
  });

  it("ギフト名が空白のみだとエラー", () => {
    const result = parseGiftEditInput({ giftName: "   ", totalDiamonds: 1 });
    expect(result.ok).toBe(false);
  });

  it("ギフト名が未指定だとエラー", () => {
    const result = parseGiftEditInput({ totalDiamonds: 1 });
    expect(result.ok).toBe(false);
  });

  it("コイン数が非数値だとエラー", () => {
    const result = parseGiftEditInput({ giftName: "Rose", totalDiamonds: "abc" });
    expect(result.ok).toBe(false);
  });

  it("コイン数が小数だとエラー", () => {
    const result = parseGiftEditInput({ giftName: "Rose", totalDiamonds: 1.5 });
    expect(result.ok).toBe(false);
  });

  it("bodyがnull/undefinedでも例外を投げない", () => {
    expect(parseGiftEditInput(null).ok).toBe(false);
    expect(parseGiftEditInput(undefined).ok).toBe(false);
  });
});

describe("applyGiftEdit", () => {
  const base = {
    id: "gift1",
    giftName: "Rose",
    totalDiamonds: 100,
  };

  it("editがnullならオリジナル値のまま、edited=false", () => {
    const result = applyGiftEdit({ ...base, edit: null });
    expect(result).toEqual({ id: "gift1", giftName: "Rose", totalDiamonds: 100, edited: false });
  });

  it("editがあれば表示値だけ上書きし、edited=trueになる", () => {
    const result = applyGiftEdit({ ...base, edit: { giftName: "修正後", totalDiamonds: -50 } });
    expect(result).toEqual({ id: "gift1", giftName: "修正後", totalDiamonds: -50, edited: true });
  });

  it("戻り値にeditキーを含めない", () => {
    const result = applyGiftEdit({ ...base, edit: { giftName: "X", totalDiamonds: 1 } });
    expect(result).not.toHaveProperty("edit");
  });
});
