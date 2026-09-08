// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { setSetting } from "@/lib/settings";
import { betaSettingKey } from "@/lib/plan/beta-settings";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_gift_breakdown";

let userId: string;
let roomId: string;
let noRoomUserId: string;
let freeUserId: string;
let token: string;
let noRoomToken: string;
let freeToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-gift-breakdown-secret";

beforeAll(async () => {
  // ranking route.integration.test.tsと同じ理由(me/route.integration.test.tsのβ切替との競合回避)。
  await setSetting(betaSettingKey("analytics"), "false");

  const room = await prisma.tiktokRoom.create({ data: { tiktokId: TIKTOK_ID } });
  roomId = room.id;

  const user = await prisma.user.create({ data: { email: `itest-mobile-gift-breakdown-${Date.now()}@local.test` } });
  userId = user.id;
  await prisma.streamer.create({
    data: { userId, tiktokId: TIKTOK_ID, verificationCode: "x", verified: false, roomId },
  });
  token = signMobileToken({ userId });

  const noRoom = await prisma.user.create({
    data: { email: `itest-mobile-gift-breakdown-noroom-${Date.now()}@local.test` },
  });
  noRoomUserId = noRoom.id;
  noRoomToken = signMobileToken({ userId: noRoomUserId });

  // month/year/custom range はPRO限定(requireHistoryPlan)。このファイルの主目的は
  // breakdown自体の配線の検証であって、プラン判定の重複検証ではないためPRO扱いにする。
  await prisma.subscription.create({
    data: {
      userId,
      plan: "PRO",
      entitlementActive: true,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const freeUser = await prisma.user.create({
    data: { email: `itest-mobile-gift-breakdown-free-${Date.now()}@local.test` },
  });
  freeUserId = freeUser.id;
  await prisma.streamer.create({
    data: { userId: freeUserId, tiktokId: TIKTOK_ID, verificationCode: "x", verified: false, roomId },
  });
  freeToken = signMobileToken({ userId: freeUserId });
});

afterAll(async () => {
  await prisma.subscription.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: noRoomUserId } }).catch(() => {});
  await prisma.user.delete({ where: { id: freeUserId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> Gift
  await prisma.$disconnect();
});

function request(query: string, bearer?: string) {
  return new NextRequest(`http://localhost/api/mobile/analytics/gifts/breakdown${query}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

describe("GET /api/mobile/analytics/gifts/breakdown", () => {
  it("トークンが無ければ401", async () => {
    const res = await GET(request("?period=day&date=2026-08-20&uniqueId=fan_a"));
    expect(res.status).toBe(401);
  });

  it("uniqueIdが無ければ400", async () => {
    const res = await GET(request("?period=day&date=2026-08-20", token));
    expect(res.status).toBe(400);
  });

  it("Streamerはあるがroom未接続なら内訳なしで200", async () => {
    const res = await GET(request("?period=day&date=2026-08-20&uniqueId=fan_a", noRoomToken));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.gifts).toEqual([]);
    expect(body.coverage.detailAvailable).toBe(false);
  });

  it("FREEプランはmonth期間の内訳取得を拒否される", async () => {
    const res = await GET(request("?period=month&date=2026-08-20&uniqueId=fan_a", freeToken));
    expect(res.status).toBe(403);
  });

  it("day期間内のギフトをギフト名別に集計して返す(明細が残っている期間)", async () => {
    const dayKey = "2026-08-20";
    const receivedAt = new Date("2026-08-20T10:00:00Z");
    await prisma.gift.create({
      data: {
        roomId,
        uniqueId: "fan_a",
        nickname: "ファンA",
        giftId: 5655,
        giftName: "Rose",
        repeatCount: 3,
        diamondCount: 1,
        totalDiamonds: 3,
        dayKey,
        receivedAt,
      },
    });
    await prisma.gift.create({
      data: {
        roomId,
        uniqueId: "fan_a",
        nickname: "ファンA",
        giftId: 6805,
        giftName: "Rosa",
        repeatCount: 1,
        diamondCount: 199,
        totalDiamonds: 199,
        dayKey,
        receivedAt: new Date(receivedAt.getTime() + 1000),
      },
    });
    // 別ユーザーの分は混ざらない。
    await prisma.gift.create({
      data: {
        roomId,
        uniqueId: "fan_b",
        nickname: "ファンB",
        giftId: 5655,
        giftName: "Rose",
        repeatCount: 10,
        diamondCount: 1,
        totalDiamonds: 10,
        dayKey,
        receivedAt,
      },
    });

    const res = await GET(request(`?period=day&date=${dayKey}&uniqueId=fan_a`, token));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.uniqueId).toBe("fan_a");
    expect(body.coverage.detailAvailable).toBe(true);
    expect(body.total).toEqual({ repeatCount: 4, totalDiamonds: 202 });
    // totalDiamonds降順(gift-breakdown.tsのorderBy)。
    expect(body.gifts.map((g: { giftName: string; repeatCount: number; totalDiamonds: number }) => g)).toEqual([
      { giftId: 6805, giftName: "Rosa", giftPictureUrl: null, repeatCount: 1, diamondCount: 199, totalDiamonds: 199, lastReceivedAt: expect.any(String) },
      { giftId: 5655, giftName: "Rose", giftPictureUrl: null, repeatCount: 3, diamondCount: 1, totalDiamonds: 3, lastReceivedAt: expect.any(String) },
    ]);
  });
});
