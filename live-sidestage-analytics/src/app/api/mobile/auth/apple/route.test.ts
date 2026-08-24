// Apple サインインのルート。code 交換と id_token 検証そのものは
// apple-auth.test.ts が見るので、ここは **ルートの分岐**（設定ゲート、入力検証、
// nonce の突き合わせ）だけを固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppleAuthError, type AppleIdTokenClaims } from "@/lib/apple-auth";

const exchangeAuthorizationCode = vi.fn();
const verifyAppleIdToken = vi.fn();
const resolveAppleUser = vi.fn();

vi.mock("@/lib/apple-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apple-auth")>();
  return {
    ...actual,
    exchangeAuthorizationCode: (...args: unknown[]) => exchangeAuthorizationCode(...args),
    verifyAppleIdToken: (...args: unknown[]) => verifyAppleIdToken(...args),
  };
});

vi.mock("@/lib/apple-account", () => ({
  resolveAppleUser: (...args: unknown[]) => resolveAppleUser(...args),
}));

const { POST } = await import("./route");

function request(body: unknown) {
  return new NextRequest("https://example.test/api/mobile/auth/apple", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function claims(overrides: Partial<AppleIdTokenClaims> = {}): AppleIdTokenClaims {
  return {
    sub: "apple-sub-1",
    email: "user@example.com",
    emailVerified: true,
    isPrivateEmail: false,
    nonce: "nonce-1",
    ...overrides,
  };
}

function configureApple() {
  vi.stubEnv("APPLE_TEAM_ID", "TEAM123456");
  vi.stubEnv("APPLE_KEY_ID", "KEY1234567");
  vi.stubEnv("APPLE_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----");
  vi.stubEnv("APPLE_SERVICES_ID", "com.example.service");
  vi.stubEnv("APPLE_REDIRECT_URI", "https://example.test/api/mobile/auth/apple/callback");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MOBILE_JWT_SECRET ||= "test-mobile-secret";
  exchangeAuthorizationCode.mockResolvedValue({ idToken: "id-token", clientId: "com.example.service" });
  verifyAppleIdToken.mockResolvedValue(claims());
  resolveAppleUser.mockResolvedValue({
    id: "u1",
    name: "太郎",
    email: "user@example.com",
    streamer: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/mobile/auth/apple", () => {
  it("Apple 未設定なら 503 で閉じる（中途半端にユーザーを作らない）", async () => {
    vi.stubEnv("APPLE_SERVICES_ID", "");
    const response = await POST(request({ authorizationCode: "c1", nonce: "nonce-1", clientKind: "android" }));

    expect(response.status).toBe(503);
    expect(resolveAppleUser).not.toHaveBeenCalled();
  });

  it("成功すると Google 版と同じ形のセッションを返す", async () => {
    configureApple();
    const response = await POST(
      request({
        authorizationCode: "c1",
        nonce: "nonce-1",
        clientKind: "android",
        givenName: "太郎",
        familyName: "山田",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user).toEqual({ id: "u1", name: "太郎", email: "user@example.com" });
    expect(body.streamer).toBeNull();
    expect(body.onboardingRequired).toBe(true);
    expect(typeof body.token).toBe("string");
    expect(resolveAppleUser).toHaveBeenCalledWith(claims(), "太郎 山田");
  });

  it("nonce が一致しなければ 401（他人の Apple 応答を流し込ませない）", async () => {
    configureApple();
    verifyAppleIdToken.mockResolvedValue(claims({ nonce: "someone-elses-nonce" }));

    const response = await POST(request({ authorizationCode: "c1", nonce: "nonce-1", clientKind: "android" }));

    expect(response.status).toBe(401);
    expect(resolveAppleUser).not.toHaveBeenCalled();
  });

  it("nonce クレームが無い id_token も 401", async () => {
    configureApple();
    verifyAppleIdToken.mockResolvedValue(claims({ nonce: null }));

    const response = await POST(request({ authorizationCode: "c1", nonce: "nonce-1", clientKind: "android" }));
    expect(response.status).toBe(401);
  });

  it("authorizationCode か nonce が無ければ 400", async () => {
    configureApple();
    expect((await POST(request({ nonce: "nonce-1" }))).status).toBe(400);
    expect((await POST(request({ authorizationCode: "c1" }))).status).toBe(400);
  });

  it("極端に長い入力は受けない", async () => {
    configureApple();
    const response = await POST(request({ authorizationCode: "c".repeat(5000), nonce: "nonce-1", clientKind: "android" }));
    expect(response.status).toBe(400);
  });

  it("clientKind: android で Services ID の経路を使う", async () => {
    configureApple();
    await POST(request({ authorizationCode: "c1", nonce: "nonce-1", clientKind: "android" }));
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(expect.anything(), {
      code: "c1",
      clientKind: "android",
    });
  });

  it("clientKind: ios を指定できる（将来の iOS 版）", async () => {
    configureApple();
    await POST(request({ authorizationCode: "c1", nonce: "nonce-1", clientKind: "ios" }));
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(expect.anything(), {
      code: "c1",
      clientKind: "ios",
    });
  });

  it("clientKind が欠けていたり知らない値なら 400（android へ黙って丸めない）", async () => {
    configureApple();
    expect((await POST(request({ authorizationCode: "c1", nonce: "nonce-1" }))).status).toBe(400);
    expect(
      (await POST(request({ authorizationCode: "c1", nonce: "nonce-1", clientKind: "web" }))).status,
    ).toBe(400);
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("aud は交換に使った client_id で検証する", async () => {
    configureApple();
    exchangeAuthorizationCode.mockResolvedValue({ idToken: "tok", clientId: "com.example.app" });

    await POST(request({ authorizationCode: "c1", nonce: "nonce-1", clientKind: "ios" }));

    expect(verifyAppleIdToken).toHaveBeenCalledWith("tok", "com.example.app");
  });

  it("Apple 側の失敗は AppleAuthError のステータスをそのまま返す", async () => {
    configureApple();
    exchangeAuthorizationCode.mockRejectedValue(new AppleAuthError("上流が落ちています", 502));

    const response = await POST(request({ authorizationCode: "c1", nonce: "nonce-1", clientKind: "android" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("上流が落ちています");
  });

  it("JSON でない本文は 400", async () => {
    configureApple();
    const response = await POST(
      new NextRequest("https://example.test/api/mobile/auth/apple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );
    expect(response.status).toBe(400);
  });
});
