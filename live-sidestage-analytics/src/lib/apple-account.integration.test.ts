// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// Apple アカウントと内部ユーザーの紐付け。**ここが緩むと他人のアカウントを
// 乗っ取れる**ので、メール一致でリンクしてよい条件を固定する。
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "./prisma";
import { resolveAppleUser, APPLE_PROVIDER } from "./apple-account";
import type { AppleIdTokenClaims } from "./apple-auth";

const PREFIX = "itest-apple-";

function email(local: string) {
  return `${PREFIX}${local}@local.test`;
}

function claims(overrides: Partial<AppleIdTokenClaims> = {}): AppleIdTokenClaims {
  return {
    sub: `${PREFIX}sub-default`,
    email: null,
    emailVerified: false,
    isPrivateEmail: false,
    nonce: "n",
    ...overrides,
  };
}

async function cleanup() {
  await prisma.account.deleteMany({ where: { providerAccountId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: null, accounts: { none: {} }, streamer: null } });
}

/// Google でログイン済みの既存ユーザー（＝メールの所有が確認できている）。
async function createGoogleUser(local: string) {
  return prisma.user.create({
    data: {
      email: email(local),
      accounts: {
        create: { type: "oauth", provider: "google", providerAccountId: `${PREFIX}google-${local}` },
      },
    },
  });
}

beforeEach(cleanup);
afterAll(cleanup);

describe("resolveAppleUser", () => {
  it("初回は User と Account(apple) を作る。内部IDは Apple の sub ではない", async () => {
    const user = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-new`, email: email("new"), emailVerified: true }),
      "太郎 山田",
    );

    expect(user.id).not.toBe(`${PREFIX}sub-new`);
    expect(user.email).toBe(email("new"));
    expect(user.name).toBe("太郎 山田");
    expect(user.streamer).toBeNull();

    const account = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: APPLE_PROVIDER,
          providerAccountId: `${PREFIX}sub-new`,
        },
      },
    });
    expect(account?.userId).toBe(user.id);
  });

  it("2回目以降は同じ User を返す（氏名が来なくても壊れない）", async () => {
    const first = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-repeat`, email: email("repeat"), emailVerified: true }),
      "太郎",
    );
    // Apple は氏名を初回しか返さない。
    const second = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-repeat`, email: email("repeat"), emailVerified: true }),
      null,
    );

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("太郎");
    expect(await prisma.user.count({ where: { email: email("repeat") } })).toBe(1);
  });

  it("実メールが一致し、その User が Google 連携済みなら既存 User へ繋ぐ", async () => {
    const google = await createGoogleUser("link");

    const user = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-link`, email: email("link"), emailVerified: true }),
      null,
    );

    expect(user.id).toBe(google.id);
    const providers = await prisma.account.findMany({
      where: { userId: google.id },
      select: { provider: true },
    });
    expect(providers.map((p) => p.provider).sort()).toEqual(["apple", "google"]);
  });

  it("メールの大文字小文字が違っても同じ User に繋がる", async () => {
    const google = await createGoogleUser("case");

    const user = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-case`, email: email("case").toUpperCase().toLowerCase(), emailVerified: true }),
      null,
    );
    expect(user.id).toBe(google.id);
  });

  it("メールが一致しても Google 連携が無い User には繋がない", async () => {
    // /api/auth/register はメールの所有確認なしに User を作れる。
    // ここで繋いでしまうと「先に他人のメールで登録 → 後からその人の Apple を乗っ取る」が成立する。
    const squatter = await prisma.user.create({
      data: { email: email("squat"), password: "hashed" },
    });

    const user = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-squat`, email: email("squat"), emailVerified: true }),
      null,
    );

    expect(user.id).not.toBe(squatter.id);
    expect(await prisma.account.count({ where: { userId: squatter.id } })).toBe(0);
  });

  it("繋がなかった相手が同じメールを持っていても作成に失敗しない（メール先取りで妨害されない）", async () => {
    // User.email は unique。ここで落ちると、メールを先に登録するだけで
    // その人の Apple ログインを永久に妨害できてしまう。
    await prisma.user.create({ data: { email: email("taken"), password: "hashed" } });

    const user = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-taken`, email: email("taken"), emailVerified: true }),
      null,
    );

    expect(user.id).toBeTruthy();
    // 内部IDは User.id なのでメールが無くても成立する。
    expect(user.email).toBeNull();
  });

  it("メールが未確認なら繋がない", async () => {
    const google = await createGoogleUser("unverified");

    const user = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-unverified`, email: email("unverified"), emailVerified: false }),
      null,
    );

    expect(user.id).not.toBe(google.id);
  });

  it("private relay のアドレスでは繋がず、新規 User を作る", async () => {
    const google = await createGoogleUser("relay");

    const user = await resolveAppleUser(
      claims({
        sub: `${PREFIX}sub-relay`,
        // relay を選ぶと、Apple が渡してくるのは本人のメールではない別アドレス。
        email: email("relay-privaterelay"),
        emailVerified: true,
        isPrivateEmail: true,
      }),
      null,
    );

    expect(user.id).not.toBe(google.id);
    // relay アドレス自体は Apple が転送してくれる有効な連絡先なので保存する。
    expect(user.email).toBe(email("relay-privaterelay"));
    expect(await prisma.account.count({ where: { userId: google.id, provider: APPLE_PROVIDER } })).toBe(0);
  });

  it("メールを渡してこない Apple ユーザーでも作れる（User.email は null 可）", async () => {
    const user = await resolveAppleUser(claims({ sub: `${PREFIX}sub-noemail` }), null);
    expect(user.email).toBeNull();

    const again = await resolveAppleUser(claims({ sub: `${PREFIX}sub-noemail` }), null);
    expect(again.id).toBe(user.id);
  });

  it("同時ログインで作成が競合しても同じ User に収束する", async () => {
    const payload = claims({ sub: `${PREFIX}sub-race`, email: email("race"), emailVerified: true });

    const results = await Promise.all([
      resolveAppleUser(payload, null),
      resolveAppleUser(payload, null),
      resolveAppleUser(payload, null),
    ]);

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    expect(
      await prisma.account.count({
        where: { provider: APPLE_PROVIDER, providerAccountId: `${PREFIX}sub-race` },
      }),
    ).toBe(1);
  });
});
