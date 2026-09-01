// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// Web(NextAuthのPrismaAdapter)とMobile(独自Bearer JWT + google-auth-library)は
// 認証の実装こそ完全に別系統だが、どちらも同じ Account(provider, providerAccountId)
// 複合uniqueキーを読み書きする。モック無しで実物のPrismaAdapterとmobile google route
// の両方を動かし、同じGoogleアカウント(同じsub)が本当に同一User.idへ収束するかを固定する。
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

const PREFIX = "itest-conv-";

const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = (...args: unknown[]) => verifyIdToken(...args);
  },
}));

const { POST: googlePost } = await import("./google/route");

process.env.MOBILE_JWT_SECRET ||= "itest-convergence-secret";
process.env.GOOGLE_CLIENT_ID ||= "itest-google-client-id";

// NextAuthがGoogleサインイン中に内部で呼ぶのと同じアダプタ実装。
// authOptions側はemailLinkRestrictedAdapterで包んでいるが、ラップしているのは
// getUserByEmailだけなので、ここで検証したいcreateUser/linkAccount/getUserByAccountの
// 挙動はbaseのPrismaAdapterと同一。
const adapter = PrismaAdapter(prisma);

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
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});
afterAll(cleanup);

describe("Web/Mobileアカウント統合(同一sub→同一User.id)", () => {
  it("Webで先に作られたUserへ、同じsubのMobileログインが収束する", async () => {
    const sub = `${PREFIX}sub-web-first`;
    const email = `${PREFIX}web-first@local.test`;

    // NextAuthが初回Googleサインインで内部的に呼ぶのと同じ2手順。
    const webUser = await adapter.createUser!({
      email,
      name: `${PREFIX}web-user`,
      emailVerified: null,
    } as never);
    await adapter.linkAccount!({
      userId: webUser.id,
      type: "oauth",
      provider: "google",
      providerAccountId: sub,
    } as never);

    stubGooglePayload({ sub, email, email_verified: true, name: `${PREFIX}web-user` });
    const response = await googlePost(googleRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.id).toBe(webUser.id);
    // Accountが増えていないこと(新規作成でなく既存Accountの参照であること)。
    expect(await prisma.account.count({ where: { userId: webUser.id } })).toBe(1);
  });

  it("Mobileで先に作られたUserを、同じsubのWebアダプタ(getUserByAccount)が解決する", async () => {
    const sub = `${PREFIX}sub-mobile-first`;
    const email = `${PREFIX}mobile-first@local.test`;

    stubGooglePayload({ sub, email, email_verified: true, name: `${PREFIX}mobile-user` });
    const mobileBody = await (await googlePost(googleRequest())).json();

    const webUser = await adapter.getUserByAccount!({ provider: "google", providerAccountId: sub });

    expect(webUser?.id).toBe(mobileBody.user.id);
  });

  it("Subscriptionは(Web/Mobileどちらから見ても)同じUserId経由で共有される", async () => {
    const sub = `${PREFIX}sub-subscription`;
    const email = `${PREFIX}subscription@local.test`;

    stubGooglePayload({ sub, email, email_verified: true, name: `${PREFIX}sub-user` });
    const mobileBody = await (await googlePost(googleRequest())).json();

    // WebのStripe Webhook経由で付与されたのと同じ状態を模す。
    await prisma.subscription.create({
      data: {
        userId: mobileBody.user.id,
        plan: "PRO",
        provider: "STRIPE",
        providerSubscriptionId: `${PREFIX}sub-stripe-subscription`,
        entitlementActive: true,
      },
    });

    const webUser = await adapter.getUserByAccount!({ provider: "google", providerAccountId: sub });
    const subscription = await prisma.subscription.findFirst({ where: { userId: webUser!.id } });

    expect(subscription?.plan).toBe("PRO");
  });
});
