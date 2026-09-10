// webAppleConfig() が redirectUri を返さないこと(Batch 01)と、
// feature flag挙動(env var有無でnull/値を返す)を固定する。
import { describe, it, expect, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { generateKeyPairSync } from "crypto";
import { webAppleConfig, buildWebClientSecret } from "./web-apple-auth";

function stubAppleEnv() {
  vi.stubEnv("APPLE_TEAM_ID", "TEAM123456");
  vi.stubEnv("APPLE_KEY_ID", "KEY1234567");
  vi.stubEnv("APPLE_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----");
  vi.stubEnv("APPLE_SERVICES_ID", "com.example.service");
  vi.stubEnv("APPLE_REDIRECT_URI", "https://example.test/api/mobile/auth/apple/callback");
  vi.stubEnv("APPLE_WEB_REDIRECT_URI", "https://example.test/api/auth/callback/apple");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("webAppleConfig", () => {
  it("redirectUriプロパティを含まない", () => {
    stubAppleEnv();
    const result = webAppleConfig();
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("redirectUri");
  });

  it("servicesIdはそのまま返す(feature flagとしてclientIdに使われる)", () => {
    stubAppleEnv();
    expect(webAppleConfig()?.servicesId).toBe("com.example.service");
  });

  it("APPLE_WEB_REDIRECT_URI未設定ならnullを返す", () => {
    stubAppleEnv();
    vi.stubEnv("APPLE_WEB_REDIRECT_URI", "");
    expect(webAppleConfig()).toBeNull();
  });

  it("モバイル向けAPPLE_REDIRECT_URI等が未設定ならnullを返す", () => {
    vi.stubEnv("APPLE_WEB_REDIRECT_URI", "https://example.test/api/auth/callback/apple");
    expect(webAppleConfig()).toBeNull();
  });
});

describe("buildWebClientSecret", () => {
  it("redirectUriを持たないWebAppleConfigからでも有効なclient_secret(JWT)を生成する", () => {
    const ec = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const config = {
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      privateKey: ec.privateKey,
      servicesId: "com.example.web",
      bundleId: null,
    };

    const secret = buildWebClientSecret(config, config.servicesId);
    const decoded = jwt.verify(secret, ec.publicKey, {
      algorithms: ["ES256"],
    }) as jwt.JwtPayload;

    expect(decoded.iss).toBe(config.teamId);
    expect(decoded.sub).toBe(config.servicesId);
    expect(decoded.aud).toBe("https://appleid.apple.com");
  });
});
