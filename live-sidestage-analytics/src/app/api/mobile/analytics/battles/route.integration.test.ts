// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// hostUserId を事前にseedしておき、backfillHostUserIds()(外部TikTok問い合わせ)を
// 実際には発火させない状態でテストする。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_battles";

let userId: string;
let roomId: string;
let noRoomUserId: string;
let token: string;
let noRoomToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-battles-secret";

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({ data: { tiktokId: TIKTOK_ID, hostUserId: "itest_host_self" } });
  roomId = room.id;

  const user = await prisma.user.create({ data: { email: `itest-mobile-battles-${Date.now()}@local.test` } });
  userId = user.id;
  await prisma.streamer.create({
    data: { userId, tiktokId: TIKTOK_ID, verificationCode: "x", verified: true, roomId },
  });
  token = signMobileToken({ userId });

  const noRoom = await prisma.user.create({ data: { email: `itest-mobile-battles-noroom-${Date.now()}@local.test` } });
  noRoomUserId = noRoom.id;
  noRoomToken = signMobileToken({ userId: noRoomUserId });

  await prisma.tiktokBattle.create({
    data: {
      roomId,
      battleId: "itest-battle-1",
      action: BATTLE_ACTION.FINISH,
      startedAt: new Date("2026-08-24T10:00:00Z"),
      startedAtEstimated: false,
      endedAt: new Date("2026-08-24T10:05:00Z"),
      durationSec: 300,
      hostUserIds: ["itest_host_self"],
      hostScores: { itest_host_self: "100" },
      raw: {},
    },
  });
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: noRoomUserId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> TiktokBattle
  await prisma.$disconnect();
});

function request(query: string, bearer?: string) {
  return new NextRequest(`http://localhost/api/mobile/analytics/battles${query}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

describe("GET /api/mobile/analytics/battles", () => {
  it("トークンが無ければ401", async () => {
    const res = await GET(request("?period=day&date=2026-08-24"));
    expect(res.status).toBe(401);
  });

  it("room未接続なら空データ+verified:falseで200", async () => {
    const res = await GET(request("?period=day&date=2026-08-24", noRoomToken));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      battles: [],
      dateRange: { start: "", end: "" },
      hasMore: false,
      verified: false,
    });
  });

  it("不正なperiodは400", async () => {
    const res = await GET(request("?period=century&date=2026-08-24", token));
    expect(res.status).toBe(400);
  });

  it("観測済みバトルをJST日付範囲で返す", async () => {
    const res = await GET(request("?period=day&date=2026-08-24", token));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.battles).toHaveLength(1);
    expect(body.battles[0].battleId).toBe("itest-battle-1");
    expect(body.battles[0].selfScore).toBe("100");
    expect(body.dateRange).toEqual({ start: "2026-08-24", end: "2026-08-24" });
    expect(body.hasMore).toBe(false);
  });

  it("該当日にバトルが無ければ空配列", async () => {
    const res = await GET(request("?period=day&date=2026-08-25", token));
    const body = await res.json();
    expect(body.battles).toEqual([]);
  });

  describe("startDatetime/endDatetime(custom range)", () => {
    it("範囲内のバトルだけを返す", async () => {
      const res = await GET(
        request("?startDatetime=2026-08-24T09%3A00%3A00Z&endDatetime=2026-08-24T11%3A00%3A00Z", token)
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.battles.map((b: { battleId: string }) => b.battleId)).toEqual(["itest-battle-1"]);
      expect(body.dateRange).toEqual({
        start: "2026-08-24T09:00:00.000Z",
        end: "2026-08-24T11:00:00.000Z",
      });
    });

    // Gift系(receivedAt<=end、inclusive)とは非対称。queryBattles()は startedAt<end
    // (endは排他)であり、custom rangeでもこの挙動をWeb版と揃えて維持する。
    it("startedAt == endは含まれない(exclusive) — Gift系との非対称性を固定する", async () => {
      await prisma.tiktokBattle.create({
        data: {
          roomId,
          battleId: "itest-battle-boundary",
          action: BATTLE_ACTION.FINISH,
          startedAt: new Date("2026-08-26T12:00:00.000Z"),
          startedAtEstimated: false,
          endedAt: new Date("2026-08-26T12:05:00Z"),
          durationSec: 300,
          hostUserIds: ["itest_host_self"],
          hostScores: { itest_host_self: "50" },
          raw: {},
        },
      });

      const res = await GET(
        request("?startDatetime=2026-08-26T00%3A00%3A00Z&endDatetime=2026-08-26T12%3A00%3A00Z", token)
      );
      const body = await res.json();
      expect(body.battles.map((b: { battleId: string }) => b.battleId)).not.toContain(
        "itest-battle-boundary"
      );
    });

    it("片方だけの指定は400", async () => {
      const res = await GET(request("?startDatetime=2026-08-24T00%3A00%3A00Z", token));
      expect(res.status).toBe(400);
    });

    it("start >= endは400", async () => {
      const res = await GET(
        request("?startDatetime=2026-08-24T11%3A00%3A00Z&endDatetime=2026-08-24T09%3A00%3A00Z", token)
      );
      expect(res.status).toBe(400);
    });
  });

  describe("listenerQuery", () => {
    it("バトル区間中にそのリスナーが貢献したバトルだけに絞り込む", async () => {
      await prisma.gift.create({
        data: {
          roomId,
          uniqueId: "Taro_Listener",
          nickname: "たろう",
          giftId: 1,
          giftName: "Rose",
          repeatCount: 1,
          diamondCount: 1,
          totalDiamonds: 1,
          dayKey: "2026-08-24",
          receivedAt: new Date("2026-08-24T10:02:00Z"), // itest-battle-1の区間内(10:00-10:05)
        },
      });

      const matched = await GET(request("?period=day&date=2026-08-24&listenerQuery=taro", token));
      const matchedBody = await matched.json();
      expect(matched.status).toBe(200);
      expect(matchedBody.battles.map((b: { battleId: string }) => b.battleId)).toEqual(["itest-battle-1"]);

      const unmatched = await GET(request("?period=day&date=2026-08-24&listenerQuery=nonexistent_xyz", token));
      const unmatchedBody = await unmatched.json();
      expect(unmatchedBody.battles).toEqual([]);
    });

    it("100文字を超えるlistenerQueryは400", async () => {
      const res = await GET(request(`?period=day&date=2026-08-24&listenerQuery=${"a".repeat(101)}`, token));
      expect(res.status).toBe(400);
    });
  });
});
