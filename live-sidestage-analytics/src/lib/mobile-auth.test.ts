// `5a3e97a` 以前に発行された旧トークンを弾くこと（LEGACY_TOKEN_CUTOFF_SEC）を固定する。
//
// 旧 `/api/mobile/auth/register` はメールの所有確認なしに 90 日トークンを発行していた。
// トークンは stateless で失効機構が無いため、下限を外すと 2026-11 月まで有効なまま残る。
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const SECRET = "mobile-auth-unit-secret";
process.env.MOBILE_JWT_SECRET = SECRET;
process.env.REFRESH_TOKEN_REPLAY_ENC_KEY = crypto.randomBytes(32).toString("base64");

// refresh token の rotation は Prisma への書き込みを伴うので、ユニットテストでは
// 必要な4テーブル分だけをインメモリで再現した最小の偽 Prisma を差し込む。
// **ここで検証したいのはアルゴリズムの分岐**（rotation / 猶予期間内の再提示 /
// 猶予期間外の再提示 / 期限切れ / 絶対期限超過）。実DBでの原子性・並行性は
// mobile-auth.integration.test.ts が実 Postgres で見る。
const fake = vi.hoisted(() => {
  interface TokenRow {
    id: string;
    principalId: string;
    streamerId: string | null;
    tokenHash: string;
    familyId: string;
    createdAt: Date;
    expiresAt: Date;
    absoluteExpiresAt: Date;
    revokedAt: Date | null;
    replacedById: string | null;
  }
  interface ReplayRow {
    oldTokenHash: string;
    principalId: string;
    streamerId: string | null;
    accessTokenEnc: string;
    refreshTokenEnc: string;
    createdAt: Date;
    expiresAt: Date;
  }

  const tokens: TokenRow[] = [];
  const replays: ReplayRow[] = [];
  const users = new Map<string, { id: string; streamer: { id: string } | null }>();
  let seq = 0;

  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
        const c = cond as { gt?: Date; lt?: Date };
        if ("gt" in c) return value instanceof Date && value > c.gt!;
        if ("lt" in c) return value instanceof Date && value < c.lt!;
        throw new Error(`偽Prismaが未対応の条件: ${JSON.stringify(cond)}`);
      }
      return value === cond;
    });
  }

  const prisma = {
    refreshToken: {
      async create({ data }: { data: Omit<TokenRow, "id" | "createdAt" | "revokedAt" | "replacedById"> }) {
        const row: TokenRow = {
          id: `rt-${++seq}`,
          createdAt: new Date(),
          revokedAt: null,
          replacedById: null,
          ...data,
        };
        tokens.push(row);
        return { ...row };
      },
      async findUnique({ where }: { where: Record<string, unknown> }) {
        const row = tokens.find((t) => matches(t as never, where));
        return row ? { ...row } : null;
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<TokenRow> }) {
        const hit = tokens.filter((t) => matches(t as never, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
      async update({ where, data }: { where: Record<string, unknown>; data: Partial<TokenRow> }) {
        const row = tokens.find((t) => matches(t as never, where));
        if (!row) throw new Error("偽Prisma: 更新対象が無い");
        Object.assign(row, data);
        return { ...row };
      },
    },
    refreshTokenReplay: {
      async findUnique({ where }: { where: Record<string, unknown> }) {
        const row = replays.find((r) => matches(r as never, where));
        return row ? { ...row } : null;
      },
      async create({ data }: { data: Omit<ReplayRow, "createdAt"> }) {
        if (replays.some((r) => r.oldTokenHash === data.oldTokenHash)) {
          throw new Error("偽Prisma: oldTokenHash が重複");
        }
        const row: ReplayRow = { createdAt: new Date(), ...data };
        replays.push(row);
        return { ...row };
      },
      async deleteMany({ where }: { where: Record<string, unknown> }) {
        let count = 0;
        for (let i = replays.length - 1; i >= 0; i--) {
          if (matches(replays[i] as never, where)) {
            replays.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        const user = users.get(where.id);
        return user ? { ...user } : null;
      },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(prisma);
    },
  };

  return {
    prisma,
    tokens,
    replays,
    users,
    reset() {
      tokens.length = 0;
      replays.length = 0;
      users.clear();
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: fake.prisma }));

const { signMobileToken, verifyMobileToken, issueRefreshToken, rotateRefreshToken, revokeRefreshTokenFamily } =
  await import("./mobile-auth");

const CUTOFF_SEC = Math.floor(Date.parse("2026-08-15T02:00:00Z") / 1000);
const NINETY_DAYS_SEC = 90 * 24 * 60 * 60;

/// 指定時刻に発行された 90 日トークンを作る。
/// `exp` は将来のままにしてあるので、弾かれるとしたら期限切れではなく iat 下限が理由。
function signIssuedAt(iatSec: number, payload: Record<string, unknown> = { principalId: "u1" }): string {
  return jwt.sign({ ...payload, iat: iatSec, exp: iatSec + NINETY_DAYS_SEC }, SECRET);
}

beforeAll(() => {
  // exp が過去だと「期限切れで落ちただけ」になり、テストの意味が無くなる。
  expect(CUTOFF_SEC + NINETY_DAYS_SEC).toBeGreaterThan(Math.floor(Date.now() / 1000));
});

describe("verifyMobileToken の旧トークン締め出し", () => {
  it("カットオフより前に発行されたトークンは、期限内でも拒否する", () => {
    expect(verifyMobileToken(signIssuedAt(CUTOFF_SEC - 1))).toBeNull();
  });

  it("カットオフちょうどは通す（境界を閉区間で扱う）", () => {
    expect(verifyMobileToken(signIssuedAt(CUTOFF_SEC))).toEqual({
      principalId: "u1",
      streamerId: undefined,
    });
  });

  it("カットオフより後に発行されたトークンは通す", () => {
    expect(verifyMobileToken(signIssuedAt(CUTOFF_SEC + 3600, { principalId: "u2", streamerId: "s2" }))).toEqual({
      principalId: "u2",
      streamerId: "s2",
    });
  });

  it("iat を持たないトークンは拒否する（jwt.sign が必ず付ける前提から外れている）", () => {
    const token = jwt.sign(
      { principalId: "u3", exp: Math.floor(Date.now() / 1000) + NINETY_DAYS_SEC },
      SECRET,
      { noTimestamp: true },
    );
    expect(verifyMobileToken(token)).toBeNull();
  });

  it("いま signMobileToken で発行したトークンは通る（現行フローを壊していない）", () => {
    expect(verifyMobileToken(signMobileToken({ principalId: "u4", streamerId: "s4" }))).toEqual({
      principalId: "u4",
      streamerId: "s4",
    });
  });

  it("署名が違うトークンは従来どおり拒否する", () => {
    const forged = jwt.sign({ principalId: "u5", iat: CUTOFF_SEC + 10 }, "wrong-secret");
    expect(verifyMobileToken(forged)).toBeNull();
  });
});

describe("signMobileToken の有効期限", () => {
  it("access token は1時間で切れる（90日の長命トークンへ戻さない）", () => {
    const decoded = jwt.decode(signMobileToken({ principalId: "u1" })) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBe(3600);
  });
});

// --- refresh token の rotation ---------------------------------------------

/// 発行順に並んだ RefreshToken 行。0 が最初に発行した行、1 が最初の rotation で出た行。
function tokenRow(index = 0) {
  return fake.tokens[index];
}

async function setupUser(principalId = "u-refresh", streamerId: string | null = "s-refresh") {
  fake.users.set(principalId, { id: principalId, streamer: streamerId ? { id: streamerId } : null });
  const rawToken = await issueRefreshToken({ principalId, streamerId });
  return { principalId, streamerId, rawToken };
}

beforeEach(() => {
  fake.reset();
});

describe("rotateRefreshToken", () => {
  it("有効な refresh token で新しい access+refresh のペアを返し、古い行を無効化する", async () => {
    const { principalId, streamerId, rawToken } = await setupUser();

    const result = await rotateRefreshToken(rawToken);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.principalId).toBe(principalId);
    expect(result.streamerId).toBe(streamerId);
    expect(result.refreshToken).not.toBe(rawToken);
    expect(verifyMobileToken(result.accessToken)).toEqual({ principalId, streamerId });

    // 古い行は revoke され、新しい行を指している。
    expect(fake.tokens).toHaveLength(2);
    expect(tokenRow(0).revokedAt).toBeInstanceOf(Date);
    expect(tokenRow(0).replacedById).toBe(tokenRow(1).id);
    expect(tokenRow(1).revokedAt).toBeNull();
    // family は rotation チェーン全体で共有する（盗難検知の単位）。
    expect(tokenRow(1).familyId).toBe(tokenRow(0).familyId);
  });

  it("absoluteExpiresAt は rotation で延長しない（無期限セッションの防止）", async () => {
    const { rawToken } = await setupUser();
    const originalAbsolute = tokenRow(0).absoluteExpiresAt.getTime();

    const first = await rotateRefreshToken(rawToken);
    if ("error" in first) throw new Error("rotation に失敗した");
    // sliding な expiresAt は引き継がれず再計算されるが、絶対期限は据え置き。
    expect(tokenRow(1).absoluteExpiresAt.getTime()).toBe(originalAbsolute);

    fake.replays.length = 0; // 猶予期間キャッシュを空にして次の rotation を勝たせる
    const second = await rotateRefreshToken(first.refreshToken);
    if ("error" in second) throw new Error("2回目の rotation に失敗した");
    expect(tokenRow(2).absoluteExpiresAt.getTime()).toBe(originalAbsolute);
  });

  it("streamerId はトークンの記録値ではなく現在のDB値で解決する", async () => {
    const { principalId, rawToken } = await setupUser("u-streamer-moved", null);
    // 発行後に Streamer 登録が完了したケース。
    fake.users.set(principalId, { id: principalId, streamer: { id: "s-later" } });

    const result = await rotateRefreshToken(rawToken);
    if ("error" in result) throw new Error("rotation に失敗した");

    expect(result.streamerId).toBe("s-later");
    expect(verifyMobileToken(result.accessToken)).toEqual({ principalId, streamerId: "s-later" });
  });

  it("猶予期間(30秒)内の同時提示は、書き込みなしで同じペアを返す（盗難扱いにしない）", async () => {
    const { rawToken } = await setupUser();

    const first = await rotateRefreshToken(rawToken);
    const rowsAfterFirst = fake.tokens.length;
    const second = await rotateRefreshToken(rawToken);

    expect(second).toEqual(first);
    // 2回目は新しい行を作らない（= DB を触っていない）。
    expect(fake.tokens).toHaveLength(rowsAfterFirst);
  });

  it("猶予期間を過ぎた再提示は TOKEN_REUSE_DETECTED になり、family 全体を失効させる", async () => {
    const { rawToken } = await setupUser();

    const first = await rotateRefreshToken(rawToken);
    if ("error" in first) throw new Error("rotation に失敗した");
    // 30秒の猶予が過ぎた状態を作る。
    fake.replays[0].expiresAt = new Date(Date.now() - 1);

    const second = await rotateRefreshToken(rawToken);

    expect(second).toEqual({ error: "TOKEN_REUSE_DETECTED" });
    // rotation で発行済みだった新しいトークンも巻き添えで失効している。
    expect(fake.tokens.every((t) => t.revokedAt !== null)).toBe(true);
    // 巻き添えになったトークンはもう使えない。
    expect(await rotateRefreshToken(first.refreshToken)).toEqual({ error: "TOKEN_REUSE_DETECTED" });
  });

  it("存在しない refresh token は INVALID_REFRESH_TOKEN", async () => {
    expect(await rotateRefreshToken("no-such-token")).toEqual({ error: "INVALID_REFRESH_TOKEN" });
  });

  it("sliding な expiresAt を過ぎたトークンは INVALID_REFRESH_TOKEN（reuse 扱いにしない）", async () => {
    const { rawToken } = await setupUser();
    tokenRow(0).expiresAt = new Date(Date.now() - 1);

    expect(await rotateRefreshToken(rawToken)).toEqual({ error: "INVALID_REFRESH_TOKEN" });
  });

  it("absoluteExpiresAt を過ぎたトークンは、expiresAt が未来でも INVALID_REFRESH_TOKEN", async () => {
    const { rawToken } = await setupUser();
    tokenRow(0).absoluteExpiresAt = new Date(Date.now() - 1);
    expect(tokenRow(0).expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(await rotateRefreshToken(rawToken)).toEqual({ error: "INVALID_REFRESH_TOKEN" });
  });

  it("User が消えていれば INVALID_REFRESH_TOKEN（退会済みへ access token を出さない）", async () => {
    const { principalId, rawToken } = await setupUser();
    fake.users.delete(principalId);

    expect(await rotateRefreshToken(rawToken)).toEqual({ error: "INVALID_REFRESH_TOKEN" });
  });

  it("replay キャッシュが復号できなくても安全側に倒れる（鍵ローテーション直後）", async () => {
    const { rawToken } = await setupUser();
    await rotateRefreshToken(rawToken);
    fake.replays[0].accessTokenEnc = "broken-value";

    // 復号できない = 「キャッシュに無かった」扱い。行は revoke 済みなので reuse 検知が働く。
    expect(await rotateRefreshToken(rawToken)).toEqual({ error: "TOKEN_REUSE_DETECTED" });
  });

  it("生の refresh token を DB(ハッシュ列・replay列)へ平文で残さない", async () => {
    const { rawToken } = await setupUser();
    const result = await rotateRefreshToken(rawToken);
    if ("error" in result) throw new Error("rotation に失敗した");

    for (const row of fake.tokens) {
      expect(row.tokenHash).not.toBe(rawToken);
      expect(row.tokenHash).not.toBe(result.refreshToken);
    }
    expect(fake.replays[0].refreshTokenEnc).not.toContain(result.refreshToken);
    expect(fake.replays[0].accessTokenEnc).not.toContain(result.accessToken);
  });

  it("期限切れの replay 行はベストエフォートで掃除される", async () => {
    const { rawToken } = await setupUser();
    await rotateRefreshToken(rawToken);
    fake.replays[0].expiresAt = new Date(Date.now() - 1);

    await rotateRefreshToken(rawToken);
    await new Promise((resolve) => setTimeout(resolve, 0)); // fire-and-forget の掃除を待つ

    expect(fake.replays).toHaveLength(0);
  });
});

describe("revokeRefreshTokenFamily", () => {
  it("ログアウトで family 全体を失効させ、以後の rotation を拒否する", async () => {
    const { rawToken } = await setupUser();
    const rotated = await rotateRefreshToken(rawToken);
    if ("error" in rotated) throw new Error("rotation に失敗した");

    await revokeRefreshTokenFamily(rotated.refreshToken);

    expect(fake.tokens.every((t) => t.revokedAt !== null)).toBe(true);
    expect(await rotateRefreshToken(rotated.refreshToken)).toEqual({ error: "TOKEN_REUSE_DETECTED" });
    // 猶予期間キャッシュも落として、ログアウト後に新しいペアを返さない。
    expect(fake.replays).toHaveLength(0);
  });

  it("知らないトークンでも例外にしない（冪等）", async () => {
    await expect(revokeRefreshTokenFamily("no-such-token")).resolves.toBeUndefined();
  });

  it("他 family のトークンは巻き込まない", async () => {
    const a = await setupUser("u-a", "s-a");
    const b = await setupUser("u-b", "s-b");

    await revokeRefreshTokenFamily(a.rawToken);

    const survived = await rotateRefreshToken(b.rawToken);
    expect("error" in survived).toBe(false);
  });
});
