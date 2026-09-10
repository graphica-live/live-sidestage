// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// Web(NextAuth)側の Google/Apple 分離を、実物の `authOptions.adapter`
// (`emailLinkRestrictedAdapter()` + `linkAccountRestrictedAdapter()` の合成)に対して
// 実DBで固定する。
//
// モバイル側の `provider-separation.integration.test.ts` と同じ発想だが、Web側は
// next-authのOAuthルートを経由せず内部で `signIn` コールバックを使わずに
// アダプタ側(`linkAccountRestrictedAdapter`)で「既存ログインセッション中の暗黙統合」を
// 拒否する設計(design-review HIGH確定)のため、ここでは adapter を直接叩いて
// next-auth の callback-handler.js が辿る経路(getUserByAccount → 無ければ
// getUserByEmail/createUser → linkAccount)を実DBで再現する。
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";

const PREFIX = "itest-web-apple-sep-";
const SHARED_EMAIL = `${PREFIX}shared@local.test`;

const adapter = authOptions.adapter!;

async function cleanup() {
  await prisma.oAuthAccount.deleteMany({ where: { providerAccountId: { startsWith: PREFIX } } });
  await prisma.principal.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

beforeEach(cleanup);
afterAll(cleanup);

describe("Web(NextAuth) の Google/Apple 分離", () => {
  it("Appleが先に作ったPrincipalはemail:nullで、getUserByEmailで拾われない(同じメールのGoogleが別Principalになる)", async () => {
    const appleUser = await prisma.principal.create({
      data: { email: null, name: `${PREFIX}apple-user` },
    });
    await adapter.linkAccount!({
      provider: "apple",
      type: "oauth",
      providerAccountId: `${PREFIX}apple-sub-1`,
      userId: appleUser.id,
      id_token: jwt.sign({ email: SHARED_EMAIL }, "test-secret"),
    });

    // Google側が新規ログイン時に辿る経路: getUserByEmail() でメール一致Userを探す。
    // Apple の Principal.email は null なのでヒットしない。
    const foundByEmail = await adapter.getUserByEmail!(SHARED_EMAIL);
    expect(foundByEmail).toBeNull();

    // 見つからないので新規Principalが作られ、別ユーザーになる。
    const googleUser = await prisma.principal.create({
      data: { email: SHARED_EMAIL, name: `${PREFIX}google-user` },
    });
    await adapter.linkAccount!({
      provider: "google",
      type: "oauth",
      providerAccountId: `${PREFIX}google-sub-1`,
      userId: googleUser.id,
    });

    expect(googleUser.id).not.toBe(appleUser.id);

    const persistedApple = await prisma.principal.findUnique({ where: { id: appleUser.id } });
    expect(persistedApple?.email).toBeNull();

    // Appleが申告した実メールは表示専用のOAuthAccount.providerEmailに保存されている。
    const appleAccount = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: { provider: "apple", providerAccountId: `${PREFIX}apple-sub-1` },
      },
    });
    expect(appleAccount?.providerEmail).toBe(SHARED_EMAIL);
  });

  it("既存Googleログインセッション中に未連携のAppleアカウントへlinkAccountされそうになっても拒否する", async () => {
    const googleUser = await prisma.principal.create({
      data: { email: `${PREFIX}g2@local.test`, name: `${PREFIX}g2` },
    });
    await adapter.linkAccount!({
      provider: "google",
      type: "oauth",
      providerAccountId: `${PREFIX}g2-sub`,
      userId: googleUser.id,
    });

    // next-authのcallback-handler.jsが「ログイン済みセッションのuserId」で
    // linkAccountを呼ぶのと同じ形。
    await expect(
      adapter.linkAccount!({
        provider: "apple",
        type: "oauth",
        providerAccountId: `${PREFIX}apple-sub-2`,
        userId: googleUser.id,
      }),
    ).rejects.toThrow(/implicit account linking refused/);

    expect(await prisma.oAuthAccount.count({ where: { userId: googleUser.id } })).toBe(1);
    expect(
      await prisma.oAuthAccount.count({ where: { providerAccountId: `${PREFIX}apple-sub-2` } }),
    ).toBe(0);
  });

  it("既存Appleログインセッション中に未連携のGoogleアカウントへlinkAccountされそうになっても拒否する(逆方向)", async () => {
    const appleUser = await prisma.principal.create({
      data: { email: null, name: `${PREFIX}a2` },
    });
    await adapter.linkAccount!({
      provider: "apple",
      type: "oauth",
      providerAccountId: `${PREFIX}a2-sub`,
      userId: appleUser.id,
    });

    await expect(
      adapter.linkAccount!({
        provider: "google",
        type: "oauth",
        providerAccountId: `${PREFIX}google-sub-2`,
        userId: appleUser.id,
      }),
    ).rejects.toThrow(/implicit account linking refused/);

    expect(await prisma.oAuthAccount.count({ where: { userId: appleUser.id } })).toBe(1);
  });

  it("同じApple subで2回目以降ログインしても同一Principalに解決される(getUserByAccount)", async () => {
    const appleUser = await prisma.principal.create({
      data: { email: null, name: `${PREFIX}a3` },
    });
    await adapter.linkAccount!({
      provider: "apple",
      type: "oauth",
      providerAccountId: `${PREFIX}a3-sub`,
      userId: appleUser.id,
    });

    const resolved = await adapter.getUserByAccount!({
      provider: "apple",
      providerAccountId: `${PREFIX}a3-sub`,
    });
    expect(resolved?.id).toBe(appleUser.id);
  });

  it("Account 0件の旧Userへのメール一致リンク(正当経路)は従来どおり通る", async () => {
    const legacy = await prisma.principal.create({
      data: { email: `${PREFIX}legacy@local.test`, name: `${PREFIX}legacy` },
    });

    const found = await adapter.getUserByEmail!(`${PREFIX}legacy@local.test`);
    expect(found?.id).toBe(legacy.id);

    await adapter.linkAccount!({
      provider: "google",
      type: "oauth",
      providerAccountId: `${PREFIX}legacy-sub`,
      userId: legacy.id,
    });
    expect(await prisma.oAuthAccount.count({ where: { userId: legacy.id } })).toBe(1);
  });
});
