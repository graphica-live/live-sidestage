// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
import { POST } from "./route";

const TIKTOK_ID = "itest_mobile_battle_share";
const OTHER_TIKTOK_ID = "itest_mobile_battle_share_other";

let principalId: string;
let roomId: string;
let noRoomPrincipalId: string;
let token: string;
let noRoomToken: string;
let otherRoomId: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-battle-share-secret";

function makeBattleHistoryData(roomId: string, battleId: string) {
  return {
    roomId,
    battleId,
    windowStart: new Date("2026-08-26T10:00:00Z"),
    windowEnd: new Date("2026-08-26T10:05:00Z"),
    status: "finished",
    sourceUpdatedAt: new Date("2026-08-26T10:05:00Z"),
    finalizedAt: new Date("2026-08-26T10:06:00Z"),
  };
}

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({ data: { tiktokHandle: TIKTOK_ID, hostTiktokUid: makeTiktokUid(TIKTOK_ID) } });
  roomId = room.id;

  const otherRoom = await prisma.tiktokRoom.create({
    data: { tiktokHandle: OTHER_TIKTOK_ID, hostTiktokUid: makeTiktokUid(OTHER_TIKTOK_ID) },
  });
  otherRoomId = otherRoom.id;

  const user = await prisma.user.create({
    data: { email: `itest-mobile-battle-share-${Date.now()}@local.test` },
  });
  principalId = user.id;
  await prisma.streamer.create({
    data: {
      principalId,
      tiktokUid: makeTiktokUid(TIKTOK_ID),
      tiktokHandle: TIKTOK_ID,
      verificationCode: "x",
      verified: true,
      roomId,
    },
  });
  token = signMobileToken({ principalId });

  const noRoom = await prisma.user.create({
    data: { email: `itest-mobile-battle-share-noroom-${Date.now()}@local.test` },
  });
  noRoomPrincipalId = noRoom.id;
  noRoomToken = signMobileToken({ principalId: noRoomPrincipalId });

  await prisma.battleHistory.create({ data: makeBattleHistoryData(roomId, "itest-battle-s1") });
  await prisma.battleHistory.create({ data: makeBattleHistoryData(otherRoomId, "itest-battle-s2") });
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: principalId } }).catch(() => {});
  await prisma.user.delete({ where: { id: noRoomPrincipalId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> BattleHistory
  await prisma.tiktokRoom.delete({ where: { id: otherRoomId } }).catch(() => {});
  await prisma.$disconnect();
});

function request(bearer?: string) {
  return new NextRequest("http://localhost/api/mobile/analytics/battles/x/share", {
    method: "POST",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

describe("POST /api/mobile/analytics/battles/[battleId]/share", () => {
  it("トークンが無ければ401(share tokenを発行しない)", async () => {
    const res = await POST(request(), { params: { battleId: "itest-battle-s1" } });
    expect(res.status).toBe(401);

    const row = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId, battleId: "itest-battle-s1" } },
      select: { shareToken: true },
    });
    expect(row?.shareToken).toBeNull();
  });

  it("room未接続なら404", async () => {
    const res = await POST(request(noRoomToken), { params: { battleId: "itest-battle-s1" } });
    expect(res.status).toBe(404);
  });

  it("別roomにのみ存在するbattleIdは404(所有者境界)", async () => {
    const res = await POST(request(token), { params: { battleId: "itest-battle-s2" } });
    expect(res.status).toBe(404);
  });

  it("存在しないbattleIdは404", async () => {
    const res = await POST(request(token), { params: { battleId: "does-not-exist" } });
    expect(res.status).toBe(404);
  });

  it("正しいroomのbattleIdでは200、URLを返す", async () => {
    const res = await POST(request(token), { params: { battleId: "itest-battle-s1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.url).toBe("string");
    expect(body.url).toMatch(/\/b\/[0-9a-f]{48}$/);
  });

  it("既発行tokenは再利用する(2回目も同じURL)", async () => {
    const res1 = await POST(request(token), { params: { battleId: "itest-battle-s1" } });
    const body1 = await res1.json();
    const res2 = await POST(request(token), { params: { battleId: "itest-battle-s1" } });
    const body2 = await res2.json();
    expect(body2.url).toBe(body1.url);
  });
});
