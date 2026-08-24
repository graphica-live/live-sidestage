// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// **メール一致で既存 User へ繋いでよいのは `Account` を1件も持たない User だけ**、を固定する。
//
// 旧 `/api/mobile/auth/register` は所有確認なしに User を作れたので、`User.email` は
// 「そのメールの所有者である」ことを証明しない。Account を持つ現役ユーザーまでメール一致で
// 拾わせると、同じメールを後から入手できた別人がそのアカウントへ正面からログインできる。
//
// 一方、旧 register で作られた User は Account を持たない。そこだけ通すことで
// Google への移行経路は保ったまま、危険な側だけ閉じている。
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const PREFIX = "itest-emaillink-";
const EMAIL = `${PREFIX}victim@local.test`;

const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = (...args: unknown[]) => verifyIdToken(...args);
  },
}));

const { POST: googlePost } = await import("./route");

process.env.MOBILE_JWT_SECRET ||= "itest-email-link-secret";
process.env.GOOGLE_CLIENT_ID ||= "itest-google-client-id";

function googleRequest() {
  return new NextRequest("https://example.test/api/mobile/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: "dummy-id-token" }),
  });
}

function stubGoogle(sub: string, email: string) {
  verifyIdToken.mockResolvedValue({
    getPayload: () => ({ sub, email, email_verified: true, name: `${PREFIX}name` }),
  });
}

async function cleanup() {
  await prisma.account.deleteMany({ where: { providerAccountId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});
afterAll(cleanup);

describe("メール一致リンクの制限", () => {
  it("Account を持たない旧ユーザーへは繋ぐ（移行経路を壊していない）", async () => {
    // 旧 /api/mobile/auth/register 相当。password を持ち Account は無い。
    const legacy = await prisma.user.create({
      data: { email: EMAIL, name: `${PREFIX}legacy`, password: "hashed" },
    });

    stubGoogle(`${PREFIX}sub-legacy`, EMAIL);
    const response = await googlePost(googleRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.id).toBe(legacy.id);
    expect(
      await prisma.account.count({ where: { userId: legacy.id, provider: "google" } }),
    ).toBe(1);
  });

  it("既に Google Account を持つ User へは、同じメールでも別 sub なら繋がない", async () => {
    const owner = await prisma.user.create({
      data: {
        email: EMAIL,
        name: `${PREFIX}owner`,
        accounts: {
          create: { type: "oauth", provider: "google", providerAccountId: `${PREFIX}sub-owner` },
        },
      },
    });

    // 同じメールを後から入手した別の Google アカウント。
    stubGoogle(`${PREFIX}sub-attacker`, EMAIL);
    const response = await googlePost(googleRequest());

    expect(response.status).toBe(409);
    // 乗っ取り側の Account が生えていないこと。
    expect(await prisma.account.count({ where: { userId: owner.id } })).toBe(1);
    expect(
      await prisma.account.count({ where: { providerAccountId: `${PREFIX}sub-attacker` } }),
    ).toBe(0);
  });

  it("Apple Account だけを持つ User へも繋がない（Google と Apple を統合しない方針）", async () => {
    // 8c03fc4 以前の Apple 経路が作りえた「メールを持つ Apple ユーザー」を想定する。
    const appleUser = await prisma.user.create({
      data: {
        email: EMAIL,
        name: `${PREFIX}apple`,
        accounts: {
          create: { type: "oauth", provider: "apple", providerAccountId: `${PREFIX}sub-apple` },
        },
      },
    });

    stubGoogle(`${PREFIX}sub-google`, EMAIL);
    const response = await googlePost(googleRequest());

    expect(response.status).toBe(409);
    expect(await prisma.account.count({ where: { userId: appleUser.id } })).toBe(1);
  });

  it("該当 User が居なければ従来どおり新規作成する", async () => {
    stubGoogle(`${PREFIX}sub-new`, EMAIL);
    const response = await googlePost(googleRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.email).toBe(EMAIL);
    expect(
      await prisma.account.count({ where: { providerAccountId: `${PREFIX}sub-new` } }),
    ).toBe(1);
  });

  it("同じ sub の再ログインは Account 一次キーで解決し、409 にならない", async () => {
    stubGoogle(`${PREFIX}sub-repeat`, EMAIL);
    const first = await (await googlePost(googleRequest())).json();

    const response = await googlePost(googleRequest());
    const second = await response.json();

    expect(response.status).toBe(200);
    expect(second.user.id).toBe(first.user.id);
  });
});
