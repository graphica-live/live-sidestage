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
});
