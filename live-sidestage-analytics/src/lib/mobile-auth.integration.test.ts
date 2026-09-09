// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// refresh token rotation の **実DBでしか確かめられない性質**だけをここで固定する:
//   1. 同一トークンでの並行 rotation が、原子的な条件付き updateMany のおかげで
//      片方だけ勝ち、もう片方も replay キャッシュ経由で同じペアを受け取ること
//      （盗難扱いの誤検知が起きないこと）
//   2. `RefreshTokenReplay` に**平文のトークンが保存されていない**こと
//   3. User 削除で RefreshToken が cascade 削除されること
//
// 分岐の網羅（期限切れ・絶対期限超過・reuse 検知）は mobile-auth.test.ts が偽 Prisma で見る。
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-auth-secret";
process.env.REFRESH_TOKEN_REPLAY_ENC_KEY ||= crypto.randomBytes(32).toString("base64");

const { issueRefreshToken, rotateRefreshToken, revokeRefreshTokenFamily, verifyMobileToken } = await import(
  "./mobile-auth"
);

const PREFIX = "itest-refreshtoken-";

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.refreshTokenReplay.deleteMany({ where: { principalId: { in: ids } } });
    // RefreshToken は onDelete: Cascade で消える。
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function createUser(label: string) {
  return prisma.user.create({
    data: { email: `${PREFIX}${label}@local.test`, name: `${PREFIX}${label}` },
    select: { id: true },
  });
}

beforeEach(cleanup);
afterAll(cleanup);

describe("refresh token rotation（実DB）", () => {
  it("rotation の勝者は1つだけで、同時提示した側も同じペアを受け取る", async () => {
    const user = await createUser("concurrent");
    const rawToken = await issueRefreshToken({ principalId: user.id, streamerId: null });

    // 行ロックで待たされた側は、勝者の commit 直後に count=0 で戻ってくる。
    // ここで猶予期間キャッシュを引き直せていないと TOKEN_REUSE_DETECTED になる。
    const results = await Promise.all(
      Array.from({ length: 5 }, () => rotateRefreshToken(rawToken)),
    );

    // 全員が成功し、**同じ**ペアを受け取る（TOKEN_REUSE_DETECTED にならない）。
    expect(results.filter((r) => "error" in r)).toEqual([]);
    const successes = results.filter((r): r is Exclude<typeof r, { error: string }> => !("error" in r));
    expect(new Set(successes.map((r) => r.refreshToken)).size).toBe(1);
    expect(new Set(successes.map((r) => r.accessToken)).size).toBe(1);

    // 新しく発行された行はちょうど1つ（= 二重発行していない）。
    const rows = await prisma.refreshToken.findMany({ where: { principalId: user.id } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);

    expect(verifyMobileToken(successes[0].accessToken)).toEqual({
      principalId: user.id,
      streamerId: undefined,
    });
  });

  it("RefreshTokenReplay に平文のトークンが保存されていない", async () => {
    const user = await createUser("encrypted");
    const rawToken = await issueRefreshToken({ principalId: user.id, streamerId: null });

    const result = await rotateRefreshToken(rawToken);
    if ("error" in result) throw new Error("rotation に失敗した");

    const replay = await prisma.refreshTokenReplay.findFirst({ where: { principalId: user.id } });
    expect(replay).not.toBeNull();
    expect(replay!.refreshTokenEnc).not.toContain(result.refreshToken);
    expect(replay!.accessTokenEnc).not.toContain(result.accessToken);
    // `<iv>:<authTag>:<ciphertext>` の3分割になっている。
    expect(replay!.refreshTokenEnc.split(":")).toHaveLength(3);
  });

  it("生の refresh token は RefreshToken テーブルに残らない（ハッシュのみ）", async () => {
    const user = await createUser("hashonly");
    const rawToken = await issueRefreshToken({ principalId: user.id, streamerId: null });

    const row = await prisma.refreshToken.findFirstOrThrow({ where: { principalId: user.id } });
    expect(row.tokenHash).not.toBe(rawToken);
    expect(row.tokenHash).toBe(crypto.createHash("sha256").update(rawToken).digest("hex"));
  });

  it("ログアウトで family 全体が失効し、以後は rotation できない", async () => {
    const user = await createUser("logout");
    const rawToken = await issueRefreshToken({ principalId: user.id, streamerId: null });

    await revokeRefreshTokenFamily(rawToken);

    expect(await rotateRefreshToken(rawToken)).toEqual({ error: "TOKEN_REUSE_DETECTED" });
    const rows = await prisma.refreshToken.findMany({ where: { principalId: user.id } });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it("User を削除すると RefreshToken も cascade で消える（退会後に再発行できない）", async () => {
    const user = await createUser("cascade");
    const rawToken = await issueRefreshToken({ principalId: user.id, streamerId: null });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.refreshToken.count({ where: { principalId: user.id } })).toBe(0);
    expect(await rotateRefreshToken(rawToken)).toEqual({ error: "INVALID_REFRESH_TOKEN" });
  });
});
