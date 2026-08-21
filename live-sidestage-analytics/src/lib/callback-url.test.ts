import { describe, it, expect } from "vitest";
import { safeCallbackUrl } from "./callback-url";

const ORIGIN = "https://liveanalytics.example.com";

describe("safeCallbackUrl", () => {
  it("同一オリジンの相対パスをそのまま返す", () => {
    expect(safeCallbackUrl("/events", ORIGIN)).toBe("/events");
  });

  it("クエリとハッシュを保持する", () => {
    expect(safeCallbackUrl("/events/abc/matches?tab=1#top", ORIGIN)).toBe(
      "/events/abc/matches?tab=1#top"
    );
  });

  it("同一オリジンの絶対URLは相対パスへ落とす", () => {
    expect(safeCallbackUrl(`${ORIGIN}/events?x=1`, ORIGIN)).toBe("/events?x=1");
  });

  it("未指定なら既定の / を返す", () => {
    expect(safeCallbackUrl(null, ORIGIN)).toBe("/");
    expect(safeCallbackUrl(undefined, ORIGIN)).toBe("/");
    expect(safeCallbackUrl("", ORIGIN)).toBe("/");
  });

  it("別オリジンの絶対URLは弾く", () => {
    expect(safeCallbackUrl("https://evil.example/steal", ORIGIN)).toBe("/");
  });

  it("オリジンの前方一致で似せた別ドメインも弾く", () => {
    expect(safeCallbackUrl(`${ORIGIN}.evil.example/steal`, ORIGIN)).toBe("/");
  });

  it("プロトコル相対URLは弾く", () => {
    expect(safeCallbackUrl("//evil.example/steal", ORIGIN)).toBe("/");
  });

  it("バックスラッシュ始まりも弾く", () => {
    expect(safeCallbackUrl("/\\evil.example", ORIGIN)).toBe("/");
    expect(safeCallbackUrl("\\\\evil.example", ORIGIN)).toBe("/");
  });

  it("javascript: スキームは弾く", () => {
    expect(safeCallbackUrl("javascript:alert(1)", ORIGIN)).toBe("/");
  });

  it("ログイン画面自身は既定へ落とす(リダイレクトループ防止)", () => {
    expect(safeCallbackUrl("/login", ORIGIN)).toBe("/");
    expect(safeCallbackUrl("/login?callbackUrl=%2Fevents", ORIGIN)).toBe("/");
  });

  it("/login で始まるだけの別パスは通す", () => {
    expect(safeCallbackUrl("/logins", ORIGIN)).toBe("/logins");
  });

  it("origin が壊れていれば既定へ落とす", () => {
    expect(safeCallbackUrl("/events", "")).toBe("/");
  });
});
