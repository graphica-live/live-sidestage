// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_battle_contributors";

let userId: string;
let roomId: string;
let noRoomUserId: string;
let token: string;
let noRoomToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-battle-contributors-secret";

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({ data: { tiktokId: TIKTOK_ID, hostUserId: "itest_host_self" } });
  roomId = room.id;

  const user = await prisma.user.create({
    data: { email: `itest-mobile-battle-contributors-${Date.now()}@local.test` },
  });
  userId = user.id;
  await prisma.streamer.create({
    data: { userId, tiktokId: TIKTOK_ID, verificationCode: "x", verified: true, roomId },
  });
  token = signMobileToken({ userId });

  const noRoom = await prisma.user.create({
    data: { email: `itest-mobile-battle-contributors-noroom-${Date.now()}@local.test` },
  });
  noRoomUserId = noRoom.id;
  noRoomToken = signMobileToken({ userId: noRoomUserId });

  await prisma.tiktokBattle.create({
    data: {
      roomId,
      battleId: "itest-battle-c1",
      action: BATTLE_ACTION.FINISH,
      startedAt: new Date("2026-08-26T10:00:00Z"),
      startedAtEstimated: false,
      endedAt: new Date("2026-08-26T10:05:00Z"),
      durationSec: 300,
      hostUserIds: ["itest_host_self"],
      hostScores: {},
      raw: {},
    },
  });

  await prisma.gift.create({
    data: {
      roomId,
      uniqueId: "user_a",
      nickname: "ユーザーA",
      giftId: 1,
      giftName: "Rose",
      repeatCount: 1,
      diamondCount: 10,
      totalDiamonds: 10,
      dayKey: "2026-08-26",
      receivedAt: new Date("2026-08-26T10:02:00Z"),
    },
  });
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: noRoomUserId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> TiktokBattle, Gift
  await prisma.$disconnect();
});

function request(bearer?: string) {
  return new NextRequest("http://localhost/api/mobile/analytics/battles/x/contributors", {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

describe("GET /api/mobile/analytics/battles/[battleId]/contributors", () => {
  it("トークンが無ければ401", async () => {
    const res = await GET(request(), { params: { battleId: "itest-battle-c1" } });
    expect(res.status).toBe(401);
  });

  it("room未接続なら404", async () => {
    const res = await GET(request(noRoomToken), { params: { battleId: "itest-battle-c1" } });
    expect(res.status).toBe(404);
  });

  it("存在しないbattleIdは404", async () => {
    const res = await GET(request(token), { params: { battleId: "does-not-exist" } });
    expect(res.status).toBe(404);
  });

  it("バトル区間の貢献者一覧を返す", async () => {
    const res = await GET(request(token), { params: { battleId: "itest-battle-c1" } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("finished");
    expect(body.contributors).toHaveLength(1);
    expect(body.contributors[0].uniqueId).toBe("user_a");
    expect(body.contributors[0].totalDiamonds).toBe(10);
  });
});
