// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// authOptions.events.createUser が、招待Cookieを見て実際にAmbassadorを付与するかを
// next/headers の cookies() をモックして検証する(実際のGoogle OAuthは通さない)。
import { describe, it, expect, vi, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { AMBASSADOR_INVITE_COOKIE } from "./ambassador/invite-cookie";
import { createInvite } from "./ambassador/ambassador";

let mockCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === AMBASSADOR_INVITE_COOKIE && mockCookieValue ? { value: mockCookieValue } : undefined),
  }),
}));

const { authOptions } = await import("./auth");

const PREFIX = "itest_auth_ambassador";
let seq = 0;
const unique = () => `${PREFIX}_${Date.now()}_${seq++}`;

const userIds: string[] = [];
const inviteIds: string[] = [];

async function createUser(): Promise<{ id: string; email: string }> {
  const email = `${unique()}@example.test`;
  const user = await prisma.user.create({ data: { email }, select: { id: true, email: true } });
  userIds.push(user.id);
  return { id: user.id, email: user.email! };
}

afterEach(async () => {
  mockCookieValue = undefined;
  await prisma.ambassador.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.ambassadorInvite.deleteMany({ where: { id: { in: inviteIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0;
  inviteIds.length = 0;
});

describe("authOptions.events.createUser (アンバサダー付与)", () => {
  it("有効な招待Cookieを持つ新規Userが作られると、Ambassadorが付与され招待が消費される", async () => {
    const invite = await createInvite();
    inviteIds.push(invite.id);
    mockCookieValue = invite.token;
    const user = await createUser();

    await authOptions.events!.createUser!({ user: { id: user.id, email: user.email } } as never);

    const ambassador = await prisma.ambassador.findUnique({ where: { userId: user.id } });
    expect(ambassador).not.toBeNull();

    const usedInvite = await prisma.ambassadorInvite.findUnique({ where: { id: invite.id } });
    expect(usedInvite?.usedAt).not.toBeNull();
  });

  it("招待Cookieが無い新規Userでは、サインアップは成功しAmbassadorは付与されない", async () => {
    mockCookieValue = undefined;
    const user = await createUser();

    await expect(
      authOptions.events!.createUser!({ user: { id: user.id, email: user.email } } as never),
    ).resolves.not.toThrow();

    const ambassador = await prisma.ambassador.findUnique({ where: { userId: user.id } });
    expect(ambassador).toBeNull();
  });

  it("無効なtokenのCookieでは、サインアップは成功しAmbassadorは付与されない", async () => {
    mockCookieValue = "invalid-token-does-not-exist";
    const user = await createUser();

    await expect(
      authOptions.events!.createUser!({ user: { id: user.id, email: user.email } } as never),
    ).resolves.not.toThrow();

    const ambassador = await prisma.ambassador.findUnique({ where: { userId: user.id } });
    expect(ambassador).toBeNull();
  });
});
