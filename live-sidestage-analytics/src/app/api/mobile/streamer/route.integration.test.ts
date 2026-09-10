// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// TikTok ID変更の7日ロックがmobile PATCH経路でも機能することを検証する。
// コアのCAS/ロック判定ロジックは verify/generate/route.integration.test.ts で網羅済みのため、
// ここでは経路固有の代表ケース(ロック中409、既存verifiedのリセット)のみを対象にする。
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { ADMIN_EMAIL } from "@/lib/admin";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";

const PREFIX = "itest-mobstreamer-";
const TID_PREFIX = "itestms_";

// tiktokUid を返さないと route が「所有の根拠が取れない」として 503 で止める。
// vi.mock のファクトリは巻き上げられるので、外の import を参照せずリテラルで持つ。
vi.mock("@/lib/tiktok-existence", () => ({
  requireExistingTiktokAccount: async () => ({
    ok: true,
    nickname: null,
    tiktokUid: "7000000000000000901",
    preview: { avatarUrl: null, signature: null, followingCount: null, followerCount: null },
  }),
}));

// 上のモックが返す tiktokUid。ハンドル変更が通るのは「同じ tiktokUid の改名」だけなので、
// 変更を許可させたいケースの Streamer はこの値で作る。
const MOCK_TIKTOK_UID = "7000000000000000901";

vi.mock("@/lib/tiktok-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tiktok-room")>();
  return {
    ...actual,
    resolveRoomForStreamer: async () => "dummy-room-id",
  };
});

const { PATCH: streamerPatch } = await import("./route");

function authedRequest(token: string, tiktokHandle: string) {
  return new NextRequest("https://example.test/api/mobile/streamer", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tiktokHandle }),
  });
}

async function cleanup() {
  await prisma.streamer.deleteMany({ where: { tiktokHandle: { startsWith: TID_PREFIX } } });
  await prisma.principal.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});
afterAll(cleanup);

describe("PATCH /api/mobile/streamer — TikTok ID変更7日ロック", () => {
  it("ロック中は409 TIKTOK_ID_CHANGE_LOCKEDを返し、tiktokHandleは変わらない", async () => {
    const user = await prisma.principal.create({
      data: { email: `${PREFIX}${Date.now()}@local.test`, name: `${PREFIX}user` },
    });
    const changedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const streamer = await prisma.streamer.create({
      data: {
        principalId: user.id,
        tiktokUid: makeTiktokUid(`${TID_PREFIX}old`),
        tiktokHandle: `${TID_PREFIX}old`,
        verificationCode: "x",
        tiktokHandleChangedAt: changedAt,
        verified: true,
      },
    });
    const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

    const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new`));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("TIKTOK_ID_CHANGE_LOCKED");

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}old`);
    expect(reloaded.verified).toBe(true);
  });

  it("7日経過後の変更は許可され、古いverifiedはリセットされる", async () => {
    const user = await prisma.principal.create({
      data: { email: `${PREFIX}${Date.now()}@local.test`, name: `${PREFIX}user2` },
    });
    const changedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const streamer = await prisma.streamer.create({
      data: {
        principalId: user.id,
        tiktokUid: MOCK_TIKTOK_UID,
        tiktokHandle: `${TID_PREFIX}old2`,
        verificationCode: "x",
        tiktokHandleChangedAt: changedAt,
        verified: true,
      },
    });
    const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

    const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new2`));
    expect(res.status).toBe(200);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new2`);
    expect(reloaded.verified).toBe(false);
    expect(reloaded.tiktokHandleChangedAt!.getTime()).toBeGreaterThan(changedAt.getTime());
  });

  describe("UID mismatchチェック(TIKTOK_UID_MISMATCH_CHECK_DISABLED)", () => {
    const ENV_KEY = "TIKTOK_UID_MISMATCH_CHECK_DISABLED";
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env[ENV_KEY];
    });
    afterEach(() => {
      if (originalEnv === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = originalEnv;
    });

    it("チェック有効時(\"0\")は、実在確認で得たtiktokUidが登録済みと異なれば409 TIKTOK_UID_MISMATCHで拒否する", async () => {
      process.env[ENV_KEY] = "0";
      const user = await prisma.principal.create({
        data: { email: `${PREFIX}${Date.now()}mm@local.test`, name: `${PREFIX}user3` },
      });
      const streamer = await prisma.streamer.create({
        data: {
          principalId: user.id,
          // モックが返す uid とは別人。ハンドルを空けた第三者への付け替えに相当する。
          tiktokUid: makeTiktokUid(`${TID_PREFIX}other`),
          tiktokHandle: `${TID_PREFIX}old3`,
          verificationCode: "x",
          tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          verified: true,
        },
      });
      const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

      const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new3`));
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe("TIKTOK_UID_MISMATCH");

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}old3`);
      expect(reloaded.verified).toBe(true);
    });

    it("既定(未設定=無効化)状態では、tiktokUidが登録済みと異なっても200で許可される", async () => {
      delete process.env[ENV_KEY];
      const user = await prisma.principal.create({
        data: { email: `${PREFIX}${Date.now()}mm2@local.test`, name: `${PREFIX}user4` },
      });
      const streamer = await prisma.streamer.create({
        data: {
          principalId: user.id,
          tiktokUid: makeTiktokUid(`${TID_PREFIX}other2`),
          tiktokHandle: `${TID_PREFIX}old4`,
          verificationCode: "x",
          tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          verified: true,
        },
      });
      const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

      const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new4`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.streamer.tiktokHandle).toBe(`${TID_PREFIX}new4`);

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new4`);
      expect(reloaded.tiktokUid).toBe(makeTiktokUid(`${TID_PREFIX}other2`));
    });

    it("チェック有効時(\"0\")でも、ADMIN_EMAILのユーザーはtiktokUid不一致でも200で許可される", async () => {
      process.env[ENV_KEY] = "0";
      const user = await prisma.principal.create({
        data: { email: ADMIN_EMAIL, name: `${PREFIX}admin2` },
      });
      try {
        const streamer = await prisma.streamer.create({
          data: {
            principalId: user.id,
            tiktokUid: makeTiktokUid(`${TID_PREFIX}other3`),
            tiktokHandle: `${TID_PREFIX}adminold2`,
            verificationCode: "x",
            tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
            verified: true,
          },
        });
        const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

        const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}adminnew2`));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.streamer.tiktokHandle).toBe(`${TID_PREFIX}adminnew2`);
      } finally {
        await prisma.streamer.deleteMany({ where: { principalId: user.id } });
        await prisma.principal.delete({ where: { id: user.id } });
      }
    });

    it("チェック有効時(\"0\")でも、tiktokUidが一致していれば200で許可される", async () => {
      process.env[ENV_KEY] = "0";
      const user = await prisma.principal.create({
        data: { email: `${PREFIX}${Date.now()}mm3@local.test`, name: `${PREFIX}user5` },
      });
      const streamer = await prisma.streamer.create({
        data: {
          principalId: user.id,
          // tiktokUid省略なし = 実在確認モックと同一uid(同一アカウントの改名)。
          tiktokUid: MOCK_TIKTOK_UID,
          tiktokHandle: `${TID_PREFIX}old5`,
          verificationCode: "x",
          tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          verified: true,
        },
      });
      const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

      const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new5`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.streamer.tiktokHandle).toBe(`${TID_PREFIX}new5`);

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new5`);
      expect(reloaded.tiktokUid).toBe(MOCK_TIKTOK_UID);
    });
  });

  it("ADMIN_EMAILのユーザーは7日ロック中でも変更を許可し、tiktokHandleChangedAt更新・verifiedリセットは維持される", async () => {
    const changedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1日前(通常ならロック中)
    const user = await prisma.principal.create({
      data: { email: ADMIN_EMAIL, name: `${PREFIX}admin` },
    });
    try {
      const streamer = await prisma.streamer.create({
        data: {
          principalId: user.id,
          tiktokUid: MOCK_TIKTOK_UID,
          tiktokHandle: `${TID_PREFIX}adminold`,
          verificationCode: "x",
          tiktokHandleChangedAt: changedAt,
          verified: true,
        },
      });
      const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

      const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}adminnew`));
      expect(res.status).toBe(200);

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}adminnew`);
      // ロック免除であっても他の副作用(tiktokHandleChangedAt更新・verifiedリセット)は通常経路と同じ。
      expect(reloaded.tiktokHandleChangedAt!.getTime()).toBeGreaterThan(changedAt.getTime());
      expect(reloaded.verified).toBe(false);
    } finally {
      await prisma.streamer.deleteMany({ where: { principalId: user.id } });
      await prisma.principal.delete({ where: { id: user.id } });
    }
  });
});
// ADMIN_EMAIL経路のCAS(楽観的排他)自体は通常経路と同一コードパスを通る。
// 実際の同時リクエストによる競合再現はTC-LOCK-301と同様にテストでは行わず、
// コードレビュー(review-auto Code Mode、Codex)でこのコードパスの同一性を確認済み。
