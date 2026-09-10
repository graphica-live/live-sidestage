import { describe, it, expect, vi, beforeEach } from "vitest";

// cookies()/redirect() をモックして、callbackPathFromCookie() 起点の
// event/overlay 分岐だけを直接検証する(Codex-lunaレビュー指摘: 従来は
// login-path.test.ts / middleware.test.ts しかなく、この分岐自体は未検証だった)。
const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
  }),
}));

class RedirectSignal extends Error {
  constructor(public target: string) {
    super("NEXT_REDIRECT");
  }
}

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new RedirectSignal(target);
  },
}));

vi.mock("@/lib/canonical-origin", () => ({
  canonicalOrigin: () => "https://analytics.example.com",
}));

vi.mock("../GoogleLoginPanel", () => ({
  default: () => null,
}));

async function renderWithCallbackCookie(cookieName: string, value: string | undefined, searchParams: Record<string, string> = {}) {
  cookieStore.clear();
  if (value !== undefined) cookieStore.set(cookieName, value);
  const { default: LoginPage } = await import("./page");
  try {
    LoginPage({ searchParams });
    return null;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.target;
    throw e;
  }
}

describe("LoginPage の callback-url cookie 起点のredirect分岐", () => {
  beforeEach(() => {
    vi.resetModules();
    cookieStore.clear();
  });

  it("cookie が /events 配下なら /event/login へ redirect する", async () => {
    const target = await renderWithCallbackCookie(
      "next-auth.callback-url",
      "https://analytics.example.com/events/abc"
    );
    expect(target).toBe("/event/login");
  });

  it("__Secure- 付きcookieでも同様に動く(本番)", async () => {
    const target = await renderWithCallbackCookie(
      "__Secure-next-auth.callback-url",
      "https://analytics.example.com/events/abc"
    );
    expect(target).toBe("/event/login");
  });

  it("cookie が /overlays 配下なら /overlays/login へ redirect する", async () => {
    const target = await renderWithCallbackCookie(
      "next-auth.callback-url",
      "https://analytics.example.com/overlays/settings"
    );
    expect(target).toBe("/overlays/login");
  });

  it("query パラメータを引き継ぐ", async () => {
    const target = await renderWithCallbackCookie(
      "next-auth.callback-url",
      "https://analytics.example.com/overlays",
      { error: "AccessDenied" }
    );
    expect(target).toBe("/overlays/login?error=AccessDenied");
  });

  it("cookie が無ければ redirect しない(analyticsのログイン画面をそのまま描画)", async () => {
    const target = await renderWithCallbackCookie("next-auth.callback-url", undefined);
    expect(target).toBeNull();
  });

  it("壊れたURL値は無視して redirect しない", async () => {
    const target = await renderWithCallbackCookie("next-auth.callback-url", "not a url::");
    expect(target).toBeNull();
  });

  it("/events でも /overlays でもないパスは redirect しない", async () => {
    const target = await renderWithCallbackCookie(
      "next-auth.callback-url",
      "https://analytics.example.com/analytics"
    );
    expect(target).toBeNull();
  });
});
