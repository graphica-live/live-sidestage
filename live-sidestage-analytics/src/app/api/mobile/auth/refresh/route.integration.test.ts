// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// `POST /api/mobile/auth/refresh` と `POST /api/mobile/auth/logout` の**契約**を固定する。
// 端末(Batch07)はこの形とステータスに依存する:
//   - 成功: 200 `{ token, refreshToken }`
//   - 失敗: 401 `{ error, code }`。`code` を見て強制ログアウトの可否を判断する
//   - ログアウト: 常に 200（ベストエフォート）
// どちらも `Authorization: Bearer` を要求しない（access token が切れた状態で呼ばれる）。
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

process.env.MOBILE_JWT_SECRET ||= "itest-refresh-route-secret";
process.env.REFRESH_TOKEN_REPLAY_ENC_KEY ||= crypto.randomBytes(32).toString("base64");

const { POST: refreshPost } = await import("./route");
const { POST: logoutPost } = await import("../logout/route");
const { issueRefreshToken, verifyMobileToken } = await import("@/lib/mobile-auth");

const PREFIX = "itest-refreshroute-";

function request(path: string, body: unknown, raw?: string) {
  return new NextRequest(`https://example.test/api/mobile/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

async function cleanup() {
  const users = await prisma.principal.findMany({
    where: { email: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.refreshTokenReplay.deleteMany({ where: { principalId: { in: ids } } });
    await prisma.principal.deleteMany({ where: { id: { in: ids } } });
  }
}

async function setup(label: string) {
  const user = await prisma.principal.create({
    data: { email: `${PREFIX}${label}@local.test`, name: `${PREFIX}${label}` },
    select: { id: true },
  });
  const refreshToken = await issueRefreshToken({ principalId: user.id, streamerId: null });
  return { user, refreshToken };
}

beforeEach(cleanup);
afterAll(cleanup);

describe("POST /api/mobile/auth/refresh", () => {
  it("有効な refresh token で新しいペアを返す", async () => {
    const { user, refreshToken } = await setup("ok");

    const response = await refreshPost(request("refresh", { refreshToken }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.refreshToken).not.toBe(refreshToken);
    expect(verifyMobileToken(body.token)).toEqual({ principalId: user.id, streamerId: undefined });
  });

  it("知らない refresh token は 401 / code=INVALID_REFRESH_TOKEN", async () => {
    const response = await refreshPost(request("refresh", { refreshToken: "no-such-token" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("猶予期間を過ぎた再提示は 401 / code=TOKEN_REUSE_DETECTED で family ごと失効する", async () => {
    const { user, refreshToken } = await setup("reuse");
    const first = await refreshPost(request("refresh", { refreshToken }));
    expect(first.status).toBe(200);

    // 30秒の猶予が過ぎた状態を作る。
    await prisma.refreshTokenReplay.updateMany({
      where: { principalId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const second = await refreshPost(request("refresh", { refreshToken }));
    const body = await second.json();

    expect(second.status).toBe(401);
    expect(body.code).toBe("TOKEN_REUSE_DETECTED");
    const rows = await prisma.refreshToken.findMany({ where: { principalId: user.id } });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it("refreshToken が無ければ 400（401 と区別する）", async () => {
    expect((await refreshPost(request("refresh", {}))).status).toBe(400);
    expect((await refreshPost(request("refresh", { refreshToken: "" }))).status).toBe(400);
    expect((await refreshPost(request("refresh", { refreshToken: "x".repeat(600) }))).status).toBe(400);
    expect((await refreshPost(request("refresh", null, "not json"))).status).toBe(400);
  });

  it("レスポンスに生の refresh token 以外の秘密を混ぜない（形が端末の契約）", async () => {
    const { refreshToken } = await setup("shape");
    const body = await (await refreshPost(request("refresh", { refreshToken }))).json();

    expect(Object.keys(body).sort()).toEqual(["refreshToken", "token"]);
  });

  it("同一 refresh token を実DB上で同時提示しても family が壊れない(猶予期間内の並行rotation)", async () => {
    const { user, refreshToken } = await setup("concurrent");

    // メイン/背景Isolate・ネットワーク再試行を模した本物の同時リクエスト。
    // fakePrisma ではなく実PostgreSQLの行ロック下で、原子的updateManyが
    // 意図どおり機能するかを確認する(unit testはin-memoryフェイクのため
    // row-level lockingを再現できない)。
    const results = await Promise.all(
      Array.from({ length: 5 }, () => refreshPost(request("refresh", { refreshToken }))),
    );
    const bodies = await Promise.all(results.map((r) => r.json()));

    // 全リクエストが成功し、同じペアを返す(30秒猶予キャッシュによるidempotent応答)。
    for (const r of results) expect(r.status).toBe(200);
    const firstToken = bodies[0].token;
    const firstRefresh = bodies[0].refreshToken;
    for (const body of bodies) {
      expect(body.token).toBe(firstToken);
      expect(body.refreshToken).toBe(firstRefresh);
    }

    // family が壊れていない(TOKEN_REUSE_DETECTEDによる巻き込み失効が起きていない)。
    const rows = await prisma.refreshToken.findMany({ where: { principalId: user.id } });
    expect(rows.some((r) => r.revokedAt === null)).toBe(true);

    // 新しいペアで通常どおり後続のrotationができる(familyが生きている)。
    const followUp = await refreshPost(request("refresh", { refreshToken: firstRefresh }));
    expect(followUp.status).toBe(200);
  });
});

describe("POST /api/mobile/auth/logout", () => {
  it("family を失効させて 200 を返す", async () => {
    const { user, refreshToken } = await setup("logout");

    const response = await logoutPost(request("logout", { refreshToken }));
    expect(response.status).toBe(200);

    const rows = await prisma.refreshToken.findMany({ where: { principalId: user.id } });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect((await refreshPost(request("refresh", { refreshToken }))).status).toBe(401);
  });

  it("知らないトークン・壊れた本文でも 200（端末を止めない）", async () => {
    expect((await logoutPost(request("logout", { refreshToken: "no-such-token" }))).status).toBe(200);
    expect((await logoutPost(request("logout", {}))).status).toBe(200);
    expect((await logoutPost(request("logout", null, "not json"))).status).toBe(200);
  });
});
