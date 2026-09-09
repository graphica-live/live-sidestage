// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_battle_contributors";
const HOST_UID = makeTiktokUid("itest_mobile_battle_contributors_host");
const LISTENER_UID = makeTiktokUid("itest_mobile_battle_contributors_user_a");

let principalId: string;
let roomId: string;
let noRoomPrincipalId: string;
let token: string;
let noRoomToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-battle-contributors-secret";

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({ data: { tiktokHandle: TIKTOK_ID, hostTiktokUid: HOST_UID } });
  roomId = room.id;

  const user = await prisma.principal.create({
    data: { email: `itest-mobile-battle-contributors-${Date.now()}@local.test` },
  });
  principalId = user.id;
  await prisma.streamer.create({
    data: {
      principalId,
      tiktokUid: HOST_UID,
      tiktokHandle: TIKTOK_ID,
      verificationCode: "x",
      verified: true,
      roomId,
    },
  });
  token = signMobileToken({ principalId });

  const noRoom = await prisma.principal.create({
    data: { email: `itest-mobile-battle-contributors-noroom-${Date.now()}@local.test` },
  });
  noRoomPrincipalId = noRoom.id;
  noRoomToken = signMobileToken({ principalId: noRoomPrincipalId });

  await prisma.tiktokBattle.create({
    data: {
      roomId,
      battleId: "itest-battle-c1",
      action: BATTLE_ACTION.FINISH,
      startedAt: new Date("2026-08-26T10:00:00Z"),
      startedAtEstimated: false,
      endedAt: new Date("2026-08-26T10:05:00Z"),
      durationSec: 300,
      hostTiktokUids: [HOST_UID],
      hostScores: {},
    },
  });

  // 表示名の供給元は `Gift` の列ではなく `TikTokUser`(uid からの順引き)。
  // `TikTokUser` は room スコープを持たず cascade で消えないので afterAll で明示的に消す。
  await prisma.tikTokUser.upsert({
    where: { tiktokUid: LISTENER_UID },
    create: { tiktokUid: LISTENER_UID, tiktokHandle: "user_a", nickname: null },
    update: { tiktokHandle: "user_a" },
  });

  await prisma.gift.create({
    data: {
      roomId,
      tiktokUid: LISTENER_UID,
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
  await prisma.principal.delete({ where: { id: principalId } }).catch(() => {});
  await prisma.principal.delete({ where: { id: noRoomPrincipalId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> TiktokBattle, Gift
  // TikTokUser は room スコープを持たないので cascade されない。
  await prisma.tikTokUser.deleteMany({ where: { tiktokUid: { in: [HOST_UID, LISTENER_UID] } } }).catch(() => {});
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

  it("バトル区間の貢献者一覧を返す(未確定バトルはteams:null)", async () => {
    const res = await GET(request(token), { params: { battleId: "itest-battle-c1" } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("finished");
    expect(body.contributors).toHaveLength(1);
    expect(body.contributors[0].tiktokHandle).toBe("user_a");
    expect(body.contributors[0].totalDiamonds).toBe(10);
    expect(body.teams).toBeNull();
  });

  it("確定済みバトルはteams(陣営別)を返す", async () => {
    const battleHistory = await prisma.battleHistory.create({
      data: {
        roomId,
        battleId: "itest-battle-c2",
        windowStart: new Date("2026-08-27T10:00:00Z"),
        windowEnd: new Date("2026-08-27T10:05:00Z"),
        status: "finished",
        sourceUpdatedAt: new Date("2026-08-27T10:05:00Z"),
        finalizedAt: new Date("2026-08-27T10:06:00Z"),
      },
    });
    await prisma.battleHistoryParticipant.createMany({
      data: [
        { battleHistoryId: battleHistory.id, side: "self", teamIndex: 0, position: 0, tiktokUid: "anchor_self" },
        {
          battleHistoryId: battleHistory.id,
          side: "opponent",
          teamIndex: 1,
          position: 0,
          tiktokUid: "anchor_opp",
          // バトル時点で凍結する表示名スナップショット(nickName から改名)。
          nicknameSnapshot: "相手",
        },
      ],
    });

    const res = await GET(request(token), { params: { battleId: "itest-battle-c2" } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.teams).not.toBeNull();
    expect(body.teams).toHaveLength(2);
    expect(body.teams[0].isSelf).toBe(true);
    expect(body.teams[1].isSelf).toBe(false);
    expect(body.teams[1].selectorMode).toBe("aggregate");

    await prisma.battleHistory.delete({ where: { id: battleHistory.id } }).catch(() => {}); // cascades -> participants
  });
});
