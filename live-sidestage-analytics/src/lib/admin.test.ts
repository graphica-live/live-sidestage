import { describe, it, expect } from "vitest";
import { ADMIN_EMAIL, isAdminEmail } from "@/lib/admin";

describe("isAdminEmail", () => {
  it("完全一致ならtrue", () => {
    expect(isAdminEmail(ADMIN_EMAIL)).toBe(true);
  });

  it("大文字小文字が違えばfalse(厳密一致)", () => {
    expect(isAdminEmail(ADMIN_EMAIL.toUpperCase())).toBe(false);
  });

  it("前後に空白があればfalse(厳密一致)", () => {
    expect(isAdminEmail(` ${ADMIN_EMAIL} `)).toBe(false);
  });

  it("nullならfalse", () => {
    expect(isAdminEmail(null)).toBe(false);
  });

  it("undefinedならfalse", () => {
    expect(isAdminEmail(undefined)).toBe(false);
  });

  it("別のメールならfalse", () => {
    expect(isAdminEmail("other@example.com")).toBe(false);
  });
});
