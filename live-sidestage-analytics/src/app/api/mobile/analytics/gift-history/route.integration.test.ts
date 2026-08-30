// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// hidden除外・hasMoreの詳細ロジックは queryGiftHistory 側(src/lib/gift-history.integration.test.ts)
// で検証済みなので、ここではルートハンドラの配線(認可・クエリパース・レスポンス整形)を確認する。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_gift_history";

let userId: string;
let roomId: string;
let noRoomUserId: string;
let token: string;
let noRoomToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-gift-history-secret";

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({ data: { tiktokId: TIKTOK_ID } });
  roomId = room.id;

  const user = await prisma.user.create({ data: { email: `itest-mobile-gift-history-${Date.now()}@local.test` } });
  userId = user.id;
  await prisma.streamer.create({
    data: { userId, tiktokId: TIKTOK_ID, verificationCode: "x", verified: true, roomId },
  });
  token = signMobileToken({ userId });

  const noRoom = await prisma.user.create({
    data: { email: `itest-mobile-gift-history-noroom-${Date.now()}@local.test` },
  });
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
  return new NextRequest(`http://localhost/api/mobile/analytics/gift-history${query}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

describe("GET /api/mobile/analytics/gift-history", () => {
  it("トークンが無ければ401", async () => {
    const res = await GET(request("?period=day&date=2026-08-20"));
    expect(res.status).toBe(401);
  });

  it("room未接続なら空データ+verified:falseで200", async () => {
    const res = await GET(request("?period=day&date=2026-08-20", noRoomToken));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      events: [],
      dateRange: { start: "", end: "" },
      total: { count: 0, diamonds: 0 },
      hasMore: false,
      verified: false,
    });
  });

  it("不正なlimitは400", async () => {
    const res = await GET(request("?period=day&date=2026-08-20&limit=0", token));
    expect(res.status).toBe(400);
  });

  it("limit上限(200)を超えると400", async () => {
    const res = await GET(request("?period=day&date=2026-08-20&limit=201", token));
    expect(res.status).toBe(400);
  });

  it("受信履歴を新しい順に返し、危険な画像URLはnullに落とす", async () => {
    await prisma.gift.create({
      data: {
        roomId,
        uniqueId: "user_a",
        nickname: "ユーザーA",
        giftId: 1,
        giftName: "Rose",
        giftPictureUrl: "javascript:alert(1)",
        repeatCount: 1,
        diamondCount: 1,
        totalDiamonds: 1,
        dayKey: "2026-08-23",
        receivedAt: new Date("2026-08-23T10:00:00Z"),
      },
    });

    const res = await GET(request("?period=day&date=2026-08-23", token));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].giftPictureUrl).toBeNull();
    expect(body.dateRange).toEqual({ start: "2026-08-23", end: "2026-08-23" });
  });

  describe("startDatetime/endDatetime(custom range)", () => {
    it("範囲内のイベントだけを返す", async () => {
      await prisma.gift.create({
        data: {
          roomId,
          uniqueId: "user_custom_in",
          nickname: "範囲内さん",
          giftId: 1,
          giftName: "Rose",
          repeatCount: 1,
          diamondCount: 5,
          totalDiamonds: 5,
          dayKey: "2026-08-25",
          receivedAt: new Date("2026-08-25T10:00:00Z"),
        },
      });
      await prisma.gift.create({
        data: {
          roomId,
          uniqueId: "user_custom_out",
          nickname: "範囲外さん",
          giftId: 1,
          giftName: "Rose",
          repeatCount: 1,
          diamondCount: 5,
          totalDiamonds: 5,
          dayKey: "2026-08-25",
          receivedAt: new Date("2026-08-25T13:00:00Z"),
        },
      });

      const res = await GET(
        request("?startDatetime=2026-08-25T09%3A00%3A00Z&endDatetime=2026-08-25T12%3A00%3A00Z", token)
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.events.map((e: { uniqueId: string }) => e.uniqueId)).toEqual(["user_custom_in"]);
      expect(body.dateRange).toEqual({
        start: "2026-08-25T09:00:00.000Z",
        end: "2026-08-25T12:00:00.000Z",
      });
    });

    it("receivedAt == endは含まれる(inclusive)", async () => {
      await prisma.gift.create({
        data: {
          roomId,
          uniqueId: "user_boundary_end",
          nickname: "境界さん",
          giftId: 1,
          giftName: "Rose",
          repeatCount: 1,
          diamondCount: 1,
          totalDiamonds: 1,
          dayKey: "2026-08-26",
          receivedAt: new Date("2026-08-26T12:00:00.000Z"),
        },
      });

      const res = await GET(
        request("?startDatetime=2026-08-26T00%3A00%3A00Z&endDatetime=2026-08-26T12%3A00%3A00Z", token)
      );
      const body = await res.json();
      expect(body.events.map((e: { uniqueId: string }) => e.uniqueId)).toContain("user_boundary_end");
    });

    it("片方だけの指定は400", async () => {
      const res = await GET(request("?startDatetime=2026-08-25T00%3A00%3A00Z", token));
      expect(res.status).toBe(400);
    });

    it("start >= endは400", async () => {
      const res = await GET(
        request("?startDatetime=2026-08-25T12%3A00%3A00Z&endDatetime=2026-08-25T09%3A00%3A00Z", token)
      );
      expect(res.status).toBe(400);
    });
  });
});
