import { describe, it, expect } from "vitest";
import { normalizeTiktokId, TIKTOK_ID_PATTERN } from "./tiktok-room";

describe("normalizeTiktokId", () => {
  it("先頭の @ を1個だけ除去する", () => {
    expect(normalizeTiktokId("@alice")).toBe("alice");
    expect(normalizeTiktokId("@@alice")).toBe("@alice");
  });

  it("前後の空白を除去し小文字化する", () => {
    expect(normalizeTiktokId("  Alice  ")).toBe("alice");
  });

  it("@ と空白の組み合わせを正しく処理する", () => {
    expect(normalizeTiktokId("  @Alice2  ")).toBe("alice2");
  });

  it("空文字はそのまま空文字", () => {
    expect(normalizeTiktokId("")).toBe("");
    expect(normalizeTiktokId("@")).toBe("");
  });
});

describe("TIKTOK_ID_PATTERN", () => {
  it("英数字・アンダースコア・ピリオドを許可する", () => {
    expect(TIKTOK_ID_PATTERN.test("alice_02.chan")).toBe(true);
  });

  it("64文字ちょうどは許可、65文字は拒否する", () => {
    expect(TIKTOK_ID_PATTERN.test("a".repeat(64))).toBe(true);
    expect(TIKTOK_ID_PATTERN.test("a".repeat(65))).toBe(false);
  });

  it("空文字は拒否する", () => {
    expect(TIKTOK_ID_PATTERN.test("")).toBe(false);
  });

  it("記号(@ を含む)は拒否する", () => {
    expect(TIKTOK_ID_PATTERN.test("@alice")).toBe(false);
    expect(TIKTOK_ID_PATTERN.test("alice-chan")).toBe(false);
    expect(TIKTOK_ID_PATTERN.test("alice chan")).toBe(false);
  });

  it("全角文字は拒否する", () => {
    expect(TIKTOK_ID_PATTERN.test("あいこ")).toBe(false);
  });

  it("大文字は拒否する(normalizeTiktokId で小文字化してから検証する前提)", () => {
    expect(TIKTOK_ID_PATTERN.test("Alice")).toBe(false);
  });
});
