// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// Subscriptionが複数行保持型になった後も、旧列(stripeCustomerId/stripeSubscriptionId)に
// @uniqueが残っていないことを実DBのスキーマに対して確認する。ここが@uniqueのままだと、
// 同一Stripe Customerが解約→再購読した際、2件目のSubscription行のcreateが一意制約違反で
// P2002になり、複合key(provider, providerSubscriptionId)基準のP2002フォールバックでは
// 救済できずwebhookが永久に失敗する(実装後レビューで発見・修正)。モックベースの
// sync-subscription.test.tsではPrismaクライアントの挙動をシミュレートするだけで実DBの
// 制約は検証できないため、実DBへの書き込みで固定する。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

const PREFIX = "itest-subschema-";

async function cleanup() {
  await prisma.subscription.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

afterAll(cleanup);

describe("Subscription旧列(stripeCustomerId/stripeSubscriptionId)にunique制約が無い", () => {
  it("同一stripeCustomerIdを持つ2行目のSubscriptionをcreateできる(解約→再購読の再現)", async () => {
    await cleanup();
    const user = await prisma.user.create({
      data: { email: `${PREFIX}${Date.now()}@example.test`, name: "itest" },
    });

    // 1件目: 解約済み(entitlementActive:false)でも行自体は残る。
    await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: "FREE",
        provider: "STRIPE",
        providerSubscriptionId: "sub_old_canceled",
        stripeCustomerId: "cus_shared",
        stripeSubscriptionId: "sub_old_canceled",
        entitlementActive: false,
      },
    });

    // 2件目: 同じCustomerが再購読して新Subscription IDでcreateする経路。
    // stripeCustomerIdのunique制約が残っていると、これがP2002で失敗する。
    await expect(
      prisma.subscription.create({
        data: {
          userId: user.id,
          plan: "PRO",
          provider: "STRIPE",
          providerSubscriptionId: "sub_new_active",
          stripeCustomerId: "cus_shared",
          stripeSubscriptionId: "sub_new_active",
          entitlementActive: true,
        },
      }),
    ).resolves.toMatchObject({ providerSubscriptionId: "sub_new_active" });

    const rows = await prisma.subscription.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
  });
});
