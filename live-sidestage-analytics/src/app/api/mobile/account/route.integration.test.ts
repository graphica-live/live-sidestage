// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// DELETE /api/mobile/account: 実DB上でUser/Account/Subscriptionを作り、
// cascade削除・冪等性(再送で200)・Event.ownerUserIdには触れないことを確認する。
// Stripe/Apple revokeへの実際のHTTP疎通はunit(stripe/apple-auth)側で見るので、
// ここではモックして「呼ばれたか」「失敗時にどう振る舞うか」だけを見る。
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { APPLE_PROVIDER } from "@/lib/apple-account";

const deleteStripeCustomer = vi.fn();
vi.mock("@/lib/stripe", () => ({
  deleteStripeCustomer: (...args: unknown[]) => deleteStripeCustomer(...args),
}));

const revokeAppleToken = vi.fn();
vi.mock("@/lib/apple-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apple-auth")>();
  return {
    ...actual,
    revokeAppleToken: (...args: unknown[]) => revokeAppleToken(...args),
  };
});

const { DELETE: deleteAccount } = await import("./route");

const PREFIX = "itest-delacct-";

process.env.MOBILE_JWT_SECRET ||= "itest-delacct-secret";
vi.stubEnv("APPLE_TEAM_ID", "TEAM123456");
vi.stubEnv("APPLE_KEY_ID", "KEY1234567");
vi.stubEnv("APPLE_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----");
vi.stubEnv("APPLE_SERVICES_ID", "com.example.service");
vi.stubEnv("APPLE_REDIRECT_URI", "https://example.test/api/mobile/auth/apple/callback");

function authedRequest(token: string) {
  return new NextRequest("https://example.test/api/mobile/account", {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.subscription.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.account.deleteMany({ where: { providerAccountId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  deleteStripeCustomer.mockResolvedValue(undefined);
  revokeAppleToken.mockResolvedValue(undefined);
  await cleanup();
});
afterAll(cleanup);

describe("DELETE /api/mobile/account", () => {
  it("トークンが無ければ401", async () => {
    const response = await deleteAccount(
      new NextRequest("https://example.test/api/mobile/account", { method: "DELETE" }),
    );
    expect(response.status).toBe(401);
  });

  it("DBに既に存在しないUserのトークンは200(削除リクエストの再送を冪等に成功扱いする)", async () => {
    const token = signMobileToken({ userId: `${PREFIX}already-gone` });
    const response = await deleteAccount(authedRequest(token));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("Userとcascade先(Account/Subscription)を削除する", async () => {
    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}basic@local.test`,
        accounts: {
          create: { type: "oauth", provider: "google", providerAccountId: `${PREFIX}google-basic` },
        },
        subscription: { create: { plan: "PRO", stripeCustomerId: `${PREFIX}cus-basic` } },
      },
    });
    const token = signMobileToken({ userId: user.id });

    const response = await deleteAccount(authedRequest(token));

    expect(response.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(0);
    expect(deleteStripeCustomer).toHaveBeenCalledWith(`${PREFIX}cus-basic`);
  });

  it("Appleアカウントはrefresh_tokenとclientIdでrevokeを呼ぶ(失敗しても削除は継続)", async () => {
    revokeAppleToken.mockRejectedValueOnce(new Error("apple down"));
    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}apple@local.test`,
        accounts: {
          create: {
            type: "oauth",
            provider: APPLE_PROVIDER,
            providerAccountId: `${PREFIX}apple-sub`,
            refresh_token: "rtok",
            appleClientId: "com.example.app",
          },
        },
      },
    });
    const token = signMobileToken({ userId: user.id });

    const response = await deleteAccount(authedRequest(token));

    expect(response.status).toBe(200);
    expect(revokeAppleToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ refreshToken: "rtok", clientId: "com.example.app" }),
    );
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it("refresh_tokenが無いApple移行前ユーザーはrevokeを呼ばずに削除する", async () => {
    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}apple-legacy@local.test`,
        accounts: {
          create: {
            type: "oauth",
            provider: APPLE_PROVIDER,
            providerAccountId: `${PREFIX}apple-legacy-sub`,
          },
        },
      },
    });
    const token = signMobileToken({ userId: user.id });

    const response = await deleteAccount(authedRequest(token));

    expect(response.status).toBe(200);
    expect(revokeAppleToken).not.toHaveBeenCalled();
  });

  it("Stripe削除が失敗したら500で中断し、Userは削除されない(課金だけ残る事故を防ぐ)", async () => {
    deleteStripeCustomer.mockRejectedValueOnce(new Error("stripe down"));
    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}stripe-fail@local.test`,
        subscription: { create: { plan: "PRO", stripeCustomerId: `${PREFIX}cus-fail` } },
      },
    });
    const token = signMobileToken({ userId: user.id });

    const response = await deleteAccount(authedRequest(token));

    expect(response.status).toBe(500);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it("所有していたEventのownerUserIdには触れない(削除もブロックもしない)", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}organizer@local.test` } });
    const event = await prisma.event.create({
      data: {
        slug: `${PREFIX}cup`,
        title: "test cup",
        ownerUserId: user.id,
        format: "TOURNAMENT",
        entryMode: "SOLO",
        startAt: new Date("2026-09-01T00:00:00Z"),
        endAt: new Date("2026-09-02T00:00:00Z"),
      },
    });
    const token = signMobileToken({ userId: user.id });

    const response = await deleteAccount(authedRequest(token));

    expect(response.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();

    const stillThere = await prisma.event.findUnique({ where: { id: event.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.ownerUserId).toBe(user.id);
  });
});
