// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// TikTok ID変更の7日ロックがmobile PATCH経路でも機能することを検証する。
// コアのCAS/ロック判定ロジックは verify/generate/route.integration.test.ts で網羅済みのため、
// ここでは経路固有の代表ケース(ロック中409、既存verifiedのリセット)のみを対象にする。
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";

const PREFIX = "itest-mobstreamer-";
const TID_PREFIX = "itestms_";

vi.mock("@/lib/tiktok-existence", () => ({
  requireExistingTiktokAccount: async () => ({ ok: true, userId: null }),
}));

vi.mock("@/lib/tiktok-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tiktok-room")>();
  return {
    ...actual,
    resolveRoomForStreamer: async () => "dummy-room-id",
  };
});

vi.mock("@/lib/tiktok-id-migration", () => ({
  upsertTiktokIdMergeJob: async () => {},
  fillHostUserIdAtEntryIfEligible: async () => {},
}));

const { PATCH: streamerPatch } = await import("./route");

function authedRequest(token: string, tiktokId: string) {
  return new NextRequest("https://example.test/api/mobile/streamer", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tiktokId }),
  });
}

async function cleanup() {
  await prisma.streamer.deleteMany({ where: { tiktokId: { startsWith: TID_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});
afterAll(cleanup);

describe("PATCH /api/mobile/streamer — TikTok ID変更7日ロック", () => {
  it("ロック中は409 TIKTOK_ID_CHANGE_LOCKEDを返し、tiktokIdは変わらない", async () => {
    const user = await prisma.user.create({
      data: { email: `${PREFIX}${Date.now()}@local.test`, name: `${PREFIX}user` },
    });
    const changedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const streamer = await prisma.streamer.create({
      data: {
        userId: user.id,
        tiktokId: `${TID_PREFIX}old`,
        verificationCode: "x",
        apiKey: `${PREFIX}${Date.now()}`,
        tiktokIdChangedAt: changedAt,
        verified: true,
      },
    });
    const token = signMobileToken({ userId: user.id, streamerId: streamer.id });

    const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new`));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("TIKTOK_ID_CHANGE_LOCKED");

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokId).toBe(`${TID_PREFIX}old`);
    expect(reloaded.verified).toBe(true);
  });

  it("7日経過後の変更は許可され、古いverifiedはリセットされる", async () => {
    const user = await prisma.user.create({
      data: { email: `${PREFIX}${Date.now()}@local.test`, name: `${PREFIX}user2` },
    });
    const changedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const streamer = await prisma.streamer.create({
      data: {
        userId: user.id,
        tiktokId: `${TID_PREFIX}old2`,
        verificationCode: "x",
        apiKey: `${PREFIX}${Date.now()}2`,
        tiktokIdChangedAt: changedAt,
        verified: true,
      },
    });
    const token = signMobileToken({ userId: user.id, streamerId: streamer.id });

    const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new2`));
    expect(res.status).toBe(200);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokId).toBe(`${TID_PREFIX}new2`);
    expect(reloaded.verified).toBe(false);
    expect(reloaded.tiktokIdChangedAt!.getTime()).toBeGreaterThan(changedAt.getTime());
  });
});
