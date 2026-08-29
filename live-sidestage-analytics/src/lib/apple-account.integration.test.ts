// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// Apple アカウントと内部ユーザーの紐付け。
// **Apple は常に別ユーザーになる**という方針を固定する。ここが緩むと、
// 同じ人が Google と Apple を使い分けたときに片方の配信設定へ吸着する。
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "./prisma";
import { resolveAppleUser, APPLE_PROVIDER, type AppleTokens } from "./apple-account";
import type { AppleIdTokenClaims } from "./apple-auth";

const PREFIX = "itest-apple-";

// revoke用トークンの保存自体は apple-account.test.ts(persistAppleTokens)で個別に検証する。
// ここではGoogle/Apple分離の挙動が主眼なので、固定のダミー値を使う。
const TOKENS: AppleTokens = { refreshToken: null, clientId: "itest-client-id" };

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
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: null, name: null, accounts: { none: {} }, streamer: null } });
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

async function appleAccountOf(sub: string) {
  return prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: APPLE_PROVIDER, providerAccountId: sub } },
  });
}

beforeEach(cleanup);
afterAll(cleanup);

describe("resolveAppleUser", () => {
  it("初回は User と Account(apple) を作る。内部IDは Apple の sub ではない", async () => {
    const user = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-new`, email: email("new"), emailVerified: true }),
      `${PREFIX}太郎 山田`,
      TOKENS,
    );

    expect(user.id).not.toBe(`${PREFIX}sub-new`);
    expect(user.name).toBe(`${PREFIX}太郎 山田`);
    expect(user.streamer).toBeNull();

    const account = await appleAccountOf(`${PREFIX}sub-new`);
    expect(account?.userId).toBe(user.id);
  });

  it("Apple のメールは User ではなく Account.providerEmail に入る", async () => {
    const user = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-store`, email: email("store"), emailVerified: true }),
      null,
      TOKENS,
    );

    // User にメールを持たせると、あとから Google がメール一致で拾って統合してしまう。
    const stored = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
    expect(stored?.email).toBeNull();

    expect((await appleAccountOf(`${PREFIX}sub-store`))?.providerEmail).toBe(email("store"));
  });

  it("初回のレスポンスでもメールを返す（2回目だけ値が入る、をやらない）", async () => {
    const first = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-dto`, email: email("dto"), emailVerified: true }),
      null,
      TOKENS,
    );
    expect(first.email).toBe(email("dto"));

    const second = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-dto`, email: email("dto"), emailVerified: true }),
      null,
      TOKENS,
    );
    expect(second.email).toBe(email("dto"));
  });

  it("2回目以降は同じ User を返す（氏名が来なくても壊れない）", async () => {
    const first = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-repeat`, email: email("repeat"), emailVerified: true }),
      `${PREFIX}太郎`,
      TOKENS,
    );
    // Apple は氏名を初回しか返さない。
    const second = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-repeat`, email: email("repeat"), emailVerified: true }),
      null,
      TOKENS,
    );

    expect(second.id).toBe(first.id);
    expect(second.name).toBe(`${PREFIX}太郎`);
  });

  it("2回目のトークンにメールが無くても、保存済みの providerEmail を返す", async () => {
    const first = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-noemail2`, email: email("noemail2"), emailVerified: true }),
      null,
      TOKENS,
    );

    // Apple は email を毎回返すとは限らない。
    const second = await resolveAppleUser(claims({ sub: `${PREFIX}sub-noemail2` }), null, TOKENS);

    expect(second.id).toBe(first.id);
    expect(second.email).toBe(email("noemail2"));
  });

  it("実メールを共有しても既存の Google ユーザーには繋がない", async () => {
    const google = await createGoogleUser("nolink");

    const user = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-nolink`, email: email("nolink"), emailVerified: true }),
      null,
      TOKENS,
    );

    expect(user.id).not.toBe(google.id);
    // 既存ユーザー側に Apple が足されていないこと。
    expect(await prisma.account.count({ where: { userId: google.id } })).toBe(1);
    expect(
      await prisma.account.count({ where: { userId: google.id, provider: APPLE_PROVIDER } }),
    ).toBe(0);
  });

  it("メールを先取りされた User にも繋がない（作成も失敗しない）", async () => {
    const squatter = await prisma.user.create({
      data: { email: email("squat"), password: "hashed" },
    });

    const user = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-squat`, email: email("squat"), emailVerified: true }),
      null,
      TOKENS,
    );

    expect(user.id).not.toBe(squatter.id);
    // User.email を持たないので unique 衝突も起きない。
    expect(user.email).toBe(email("squat"));
  });

  it("private relay も未確認メールも、リンクには使わないが保存して返す", async () => {
    const relay = await resolveAppleUser(
      claims({
        sub: `${PREFIX}sub-relay`,
        email: email("relay-privaterelay"),
        emailVerified: true,
        isPrivateEmail: true,
      }),
      null,
      TOKENS,
    );
    expect(relay.email).toBe(email("relay-privaterelay"));

    const unverified = await resolveAppleUser(
      claims({ sub: `${PREFIX}sub-unverified`, email: email("unverified"), emailVerified: false }),
      null,
      TOKENS,
    );
    expect(unverified.email).toBe(email("unverified"));
    expect(unverified.id).not.toBe(relay.id);
  });

  it("メールを渡してこない Apple ユーザーでも作れる", async () => {
    const user = await resolveAppleUser(claims({ sub: `${PREFIX}sub-noemail` }), null, TOKENS);
    expect(user.email).toBeNull();

    const again = await resolveAppleUser(claims({ sub: `${PREFIX}sub-noemail` }), null, TOKENS);
    expect(again.id).toBe(user.id);
  });

  it("同時ログインで作成が競合しても、同じ User に収束し孤児 User を残さない", async () => {
    const name = `${PREFIX}race-marker`;
    const payload = claims({ sub: `${PREFIX}sub-race`, email: email("race"), emailVerified: true });

    const results = await Promise.all([
      resolveAppleUser(payload, name, TOKENS),
      resolveAppleUser(payload, name, TOKENS),
      resolveAppleUser(payload, name, TOKENS),
    ]);

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    expect(
      await prisma.account.count({
        where: { provider: APPLE_PROVIDER, providerAccountId: `${PREFIX}sub-race` },
      }),
    ).toBe(1);
    // 負けた側の User が作られっぱなしになっていないこと(nested write ごと巻き戻る)。
    expect(await prisma.user.count({ where: { name } })).toBe(1);
  });

  it("revoke用のrefresh_tokenとclientIdを保存し、2回目以降は最新値で上書きする", async () => {
    const sub = `${PREFIX}sub-tokens`;

    await resolveAppleUser(claims({ sub }), null, {
      refreshToken: "rtok-1",
      clientId: "client-1",
    });
    const afterFirst = await appleAccountOf(sub);
    expect(afterFirst?.refresh_token).toBe("rtok-1");
    expect(afterFirst?.appleClientId).toBe("client-1");

    await resolveAppleUser(claims({ sub }), null, {
      refreshToken: "rtok-2",
      clientId: "client-2",
    });
    const afterSecond = await appleAccountOf(sub);
    expect(afterSecond?.refresh_token).toBe("rtok-2");
    expect(afterSecond?.appleClientId).toBe("client-2");
  });

  it("2回目のログインでrefresh_tokenが取れなくても、保存済みの値を消さない", async () => {
    const sub = `${PREFIX}sub-tokens-keep`;

    await resolveAppleUser(claims({ sub }), null, {
      refreshToken: "rtok-keep",
      clientId: "client-keep",
    });

    await resolveAppleUser(claims({ sub }), null, { refreshToken: null, clientId: "client-keep" });

    const account = await appleAccountOf(sub);
    expect(account?.refresh_token).toBe("rtok-keep");
  });
});
