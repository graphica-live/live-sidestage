// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_ranking";

let userId: string;
let streamerId: string;
let roomId: string;
let noRoomUserId: string;
let token: string;
let noRoomToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-ranking-secret";

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({ data: { tiktokId: TIKTOK_ID } });
  roomId = room.id;

  const user = await prisma.user.create({ data: { email: `itest-mobile-ranking-${Date.now()}@local.test` } });
  userId = user.id;
  const streamer = await prisma.streamer.create({
    data: { userId, tiktokId: TIKTOK_ID, verificationCode: "x", verified: false, roomId },
  });
  streamerId = streamer.id;
  // 偽装されたstreamerId(実在しないID)を持つトークンでも、userIdから引き直すので
  // 越権(他人の部屋の閲覧)は起きないことを検証するために使う。
  token = signMobileToken({ userId, streamerId: "forged-streamer-id" });

  const noRoom = await prisma.user.create({ data: { email: `itest-mobile-ranking-noroom-${Date.now()}@local.test` } });
  noRoomUserId = noRoom.id;
  noRoomToken = signMobileToken({ userId: noRoomUserId });
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: noRoomUserId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> Gift
  await prisma.$disconnect();
});

function request(query: string, bearer?: string) {
  return new NextRequest(`http://localhost/api/mobile/analytics/ranking${query}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

async function addGift(uniqueId: string, nickname: string, totalDiamonds: number, receivedAt: Date, dayKey: string) {
  return prisma.gift.create({
    data: {
      roomId,
      uniqueId,
      nickname,
      giftId: 1,
      giftName: "Rose",
      repeatCount: 1,
      diamondCount: totalDiamonds,
      totalDiamonds,
      dayKey,
      receivedAt,
    },
  });
}

describe("GET /api/mobile/analytics/ranking", () => {
  it("トークンが無ければ401", async () => {
    const res = await GET(request("?period=day&date=2026-08-20"));
    expect(res.status).toBe(401);
  });

  it("Streamerはあるがroom未接続なら空データ+verified:falseで200", async () => {
    const res = await GET(request("?period=day&date=2026-08-20", noRoomToken));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      users: [],
      dateRange: { start: "", end: "" },
      total: { giftCount: 0, totalDiamonds: 0 },
      verified: false,
    });
  });

  it("不正なperiodは400", async () => {
    const res = await GET(request("?period=year&date=2026-08-20", token));
    expect(res.status).toBe(400);
  });

  it("不正な(存在しない)dateは400", async () => {
    const res = await GET(request("?period=day&date=2026-02-30", token));
    expect(res.status).toBe(400);
  });

  it("totalDiamonds降順でソートされ、順位はインデックスで決まる", async () => {
    await addGift("user_low", "Bさん", 10, new Date("2026-08-21T10:00:00Z"), "2026-08-21");
    await addGift("user_high", "Aさん", 100, new Date("2026-08-21T10:01:00Z"), "2026-08-21");

    const res = await GET(request("?period=day&date=2026-08-21", token));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.users.map((u: { uniqueId: string }) => u.uniqueId)).toEqual(["user_high", "user_low"]);
    expect(body.total).toEqual({ giftCount: 2, totalDiamonds: 110 });
    expect(body.verified).toBe(false);
    expect(body.dateRange).toEqual({ start: "2026-08-21", end: "2026-08-21" });
  });

  it("同点はuniqueId昇順で決定的に並ぶ", async () => {
    await addGift("user_z", "Zさん", 50, new Date("2026-08-22T10:00:00Z"), "2026-08-22");
    await addGift("user_a", "Aさん", 50, new Date("2026-08-22T10:01:00Z"), "2026-08-22");

    const res = await GET(request("?period=day&date=2026-08-22", token));
    const body = await res.json();
    expect(body.users.map((u: { uniqueId: string }) => u.uniqueId)).toEqual(["user_a", "user_z"]);
  });

  it("偽装されたstreamerIdでは他人の部屋を参照できない(userIdから引き直す)", async () => {
    // tokenのstreamerIdは実在しないIDだが、userIdは正規のものなのでroomIdは正しく解決される。
    const res = await GET(request("?period=day&date=2026-08-21", token));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.users.length).toBeGreaterThan(0);
  });
});
