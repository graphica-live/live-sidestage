import { describe, it, expect } from "vitest";
import { clampCallbackUrl, safeCallbackUrl } from "./callback-url";

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

  it("イベント側のログイン画面自身も既定へ落とす", () => {
    expect(safeCallbackUrl("/event/login", ORIGIN)).toBe("/");
    expect(safeCallbackUrl("/agency/login", ORIGIN)).toBe("/");
  });

  it("/event/login で始まるだけの別パスは通す", () => {
    expect(safeCallbackUrl("/event/logins", ORIGIN)).toBe("/event/logins");
  });

  // fallback は「弾いたときの戻り先」なので、**拒否する枝すべて**が返さなければならない。
  // 1つでも "/" のまま残すと、その入力のときだけイベント主催者が analytics へ流れる。
  describe("fallback 指定時、拒否する枝はすべて fallback を返す", () => {
    const FB = "/events";

    it("未指定", () => {
      expect(safeCallbackUrl(null, ORIGIN, FB)).toBe(FB);
      expect(safeCallbackUrl("", ORIGIN, FB)).toBe(FB);
    });

    it("origin が壊れている(parse失敗)", () => {
      expect(safeCallbackUrl("/events/abc", "", FB)).toBe(FB);
    });

    it("別オリジン", () => {
      expect(safeCallbackUrl("https://evil.example/steal", ORIGIN, FB)).toBe(FB);
    });

    it("ログイン画面自身(ループガード)", () => {
      expect(safeCallbackUrl("/event/login", ORIGIN, FB)).toBe(FB);
      expect(safeCallbackUrl("/login?callbackUrl=%2Fevents", ORIGIN, FB)).toBe(FB);
    });

    it("プロトコル相対・バックスラッシュ", () => {
      expect(safeCallbackUrl("//evil.example/steal", ORIGIN, FB)).toBe(FB);
      expect(safeCallbackUrl("/\\evil.example", ORIGIN, FB)).toBe(FB);
    });

    it("通す入力には影響しない", () => {
      expect(safeCallbackUrl("/events/abc?tab=1", ORIGIN, FB)).toBe("/events/abc?tab=1");
    });
  });
});

describe("clampCallbackUrl", () => {
  const FB = "/events";

  it("prefix 配下はそのまま通す", () => {
    expect(clampCallbackUrl("/events", "/events", FB)).toBe("/events");
    expect(clampCallbackUrl("/events/abc/matches?tab=1", "/events", FB)).toBe(
      "/events/abc/matches?tab=1"
    );
  });

  it("prefix の外は fallback へ落とす", () => {
    expect(clampCallbackUrl("/analytics", "/events", FB)).toBe(FB);
    expect(clampCallbackUrl("/setup", "/events", FB)).toBe(FB);
  });

  // 事務所ログインの既存実装は境界なしの startsWith で、ここを通してしまう。
  it("前置一致ではなくパス境界で判定する", () => {
    expect(clampCallbackUrl("/eventsomething", "/events", FB)).toBe(FB);
  });

  it("クエリ・ハッシュに prefix が現れても騙されない", () => {
    expect(clampCallbackUrl("/analytics?next=/events", "/events", FB)).toBe(FB);
    expect(clampCallbackUrl("/analytics#/events", "/events", FB)).toBe(FB);
  });
});
