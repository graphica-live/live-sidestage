import { describe, it, expect } from "vitest";
import { normalizeEmail, readPassword, MAX_PASSWORD_BYTES } from "./email-auth";

describe("normalizeEmail", () => {
  it("trimして小文字化する", () => {
    expect(normalizeEmail("  User@Example.com  ")).toBe("user@example.com");
  });

  it("不正な形式はnull", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("no-at-sign.com")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
  });

  it("文字列以外はnull", () => {
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(123)).toBeNull();
  });

  it("254文字を超えるとnull", () => {
    const local = "a".repeat(250);
    expect(normalizeEmail(`${local}@example.com`)).toBeNull();
  });
});

describe("readPassword", () => {
  it("有効な範囲の文字列をそのまま返す", () => {
    expect(readPassword("password123")).toBe("password123");
  });

  it("空文字はnull", () => {
    expect(readPassword("")).toBeNull();
  });

  it("文字列以外はnull", () => {
    expect(readPassword(undefined)).toBeNull();
    expect(readPassword(12345678)).toBeNull();
  });

  it(`${MAX_PASSWORD_BYTES}バイトちょうどは許可する`, () => {
    const value = "a".repeat(MAX_PASSWORD_BYTES);
    expect(readPassword(value)).toBe(value);
  });

  it(`${MAX_PASSWORD_BYTES}バイトを超えるとnull(文字数ではなくバイト長で判定)`, () => {
    const overByte = "a".repeat(MAX_PASSWORD_BYTES + 1);
    expect(readPassword(overByte)).toBeNull();

    // マルチバイト文字は1文字で3byte以上になりうるため、文字数は少なくてもnullになる。
    const multibyte = "あ".repeat(25); // 25 * 3 = 75 byte > 72
    expect(readPassword(multibyte)).toBeNull();
  });
});
