// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// **Google と Apple は同じメールでも別ユーザーになる**、を両ルートの実物で固定する。
//
// これを Apple 側の単体テストだけで担保できないのは、統合が起きる経路が
// 「Apple が先、Google が後」だから。Google ルートは `User.email` 一致で
// 無条件にリンクするので、Apple 側が User にメールを持たせた瞬間に破れる。
// Apple 側のテストは自分がメールを持たないことしか見ておらず、
// 実際に Google が拾わないことまでは見ていない。
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAppleUser, APPLE_PROVIDER, type AppleTokens } from "@/lib/apple-account";
import type { AppleIdTokenClaims } from "@/lib/apple-auth";

const PREFIX = "itest-sep-";
const SHARED_EMAIL = `${PREFIX}same@local.test`;
const TOKENS: AppleTokens = { refreshToken: null, clientId: "itest-client-id" };

// Google ルートは google-auth-library で idToken を検証する。
// 実際のトークンは用意できないので、検証だけ差し替えて後段のユーザー解決を通す。
const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = (...args: unknown[]) => verifyIdToken(...args);
  },
}));

const { POST: googlePost } = await import("./google/route");

process.env.MOBILE_JWT_SECRET ||= "itest-provider-separation-secret";
process.env.GOOGLE_CLIENT_ID ||= "itest-google-client-id";

function appleClaims(overrides: Partial<AppleIdTokenClaims> = {}): AppleIdTokenClaims {
  return {
    sub: `${PREFIX}apple-sub`,
    email: SHARED_EMAIL,
    emailVerified: true,
    isPrivateEmail: false,
    nonce: "n",
    ...overrides,
  };
}

function googleRequest(idToken = "dummy-id-token") {
  return new NextRequest("https://example.test/api/mobile/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

function stubGooglePayload(payload: Record<string, unknown>) {
  verifyIdToken.mockResolvedValue({ getPayload: () => payload });
}

async function cleanup() {
  await prisma.account.deleteMany({ where: { providerAccountId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: null, name: null, accounts: { none: {} }, streamer: null } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});
afterAll(cleanup);

describe("Google と Apple の分離", () => {
  it("Apple が先でも、あとから同じメールの Google ログインに吸収されない", async () => {
    const apple = await resolveAppleUser(appleClaims(), `${PREFIX}apple-user`, TOKENS);

    stubGooglePayload({
      sub: `${PREFIX}google-sub`,
      email: SHARED_EMAIL,
      email_verified: true,
      name: `${PREFIX}google-user`,
    });
    const response = await googlePost(googleRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    // 別ユーザーであること。
    expect(body.user.id).not.toBe(apple.id);
    // Apple の User に Google の Account が足されていないこと。
    expect(await prisma.account.count({ where: { userId: apple.id } })).toBe(1);
    expect(
      await prisma.account.count({ where: { userId: apple.id, provider: APPLE_PROVIDER } }),
    ).toBe(1);
  });

  it("Google が先でも、あとから同じメールの Apple ログインに吸収されない", async () => {
    stubGooglePayload({
      sub: `${PREFIX}google-sub`,
      email: SHARED_EMAIL,
      email_verified: true,
      name: `${PREFIX}google-user`,
    });
    const googleBody = await (await googlePost(googleRequest())).json();

    const apple = await resolveAppleUser(appleClaims(), `${PREFIX}apple-user`, TOKENS);

    expect(apple.id).not.toBe(googleBody.user.id);
    expect(await prisma.account.count({ where: { userId: googleBody.user.id } })).toBe(1);
  });

  it("Google 同士は従来どおり同じユーザーに戻る（分離で壊していないこと）", async () => {
    stubGooglePayload({
      sub: `${PREFIX}google-sub`,
      email: SHARED_EMAIL,
      email_verified: true,
      name: `${PREFIX}google-user`,
    });

    const first = await (await googlePost(googleRequest())).json();
    const second = await (await googlePost(googleRequest())).json();

    expect(second.user.id).toBe(first.user.id);
    expect(first.user.email).toBe(SHARED_EMAIL);
  });
});
