// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// hidden除外・hasMoreの詳細ロジックは queryGiftHistory 側(src/lib/gift-history.integration.test.ts)
// で検証済みなので、ここではルートハンドラの配線(認可・クエリパース・レスポンス整形)を確認する。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { setSetting } from "@/lib/settings";
import { betaSettingKey } from "@/lib/plan/beta-settings";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_gift_history";

let userId: string;
let roomId: string;
let noRoomUserId: string;
let freeUserId: string;
let token: string;
let noRoomToken: string;
let freeToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-gift-history-secret";

beforeAll(async () => {
  // me/route.integration.test.tsがanalyticsBetaEnabledを一時的にtrueへ切り替えるテストを
  // 持つため、並列実行時にこのファイルのFREE拒否テストがβ経由で通ってしまう
  // 非決定的失敗を避ける(実装後レビュー指摘、LOW)。この機能(mobile.history.*)は
  // analytics領域のβでバイパスされる設計のため、mobileではなくanalyticsを明示的にfalseへ倒す。
  await setSetting(betaSettingKey("analytics"), "false");

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

  // requireHistoryPlanのプラン拒否そのものを検証するための、room接続済み・
  // Subscription無し(=FREE)のユーザー。
  const freeUser = await prisma.user.create({
    data: { email: `itest-mobile-gift-history-free-${Date.now()}@local.test` },
  });
  freeUserId = freeUser.id;
  await prisma.streamer.create({
    data: { userId: freeUserId, tiktokId: TIKTOK_ID, verificationCode: "x", verified: true, roomId },
  });
  freeToken = signMobileToken({ userId: freeUserId });

  // custom range / listenerQuery はPRO限定機能(requireHistoryPlan)なので、
  // FREEのままだと既存のcustom range系テストが403で落ちる。このファイルの主目的は
  // ルートハンドラの配線検証であってプラン判定の検証ではないため、mainのuserIdはPRO扱いにする。
  await prisma.subscription.create({
    data: {
      userId,
      plan: "PRO",
      entitlementActive: true,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
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

  describe("プラン制限(requireHistoryPlan)", () => {
    it("FREEユーザーのday/weekは通る(拡張範囲でなければプラン判定を通過する)", async () => {
      const res = await GET(request("?period=day&date=2026-08-20", freeToken));
      expect(res.status).toBe(200);
    });

    it("FREEユーザーがmonthを指定すると403", async () => {
      const res = await GET(request("?period=month&date=2026-08-20", freeToken));
      expect(res.status).toBe(403);
    });

    it("FREEユーザーがカスタム範囲を指定すると403", async () => {
      const res = await GET(
        request("?startDatetime=2026-08-01T00:00:00Z&endDatetime=2026-08-02T00:00:00Z", freeToken)
      );
      expect(res.status).toBe(403);
    });

    it("FREEユーザーがlistenerQueryを指定すると403", async () => {
      const res = await GET(request("?period=day&date=2026-08-20&listenerQuery=taro", freeToken));
      expect(res.status).toBe(403);
    });

    it("PROユーザーのmonth/カスタム範囲/listenerQueryは通る", async () => {
      expect((await GET(request("?period=month&date=2026-08-20", token))).status).toBe(200);
      expect(
        (
          await GET(
            request("?startDatetime=2026-08-01T00:00:00Z&endDatetime=2026-08-02T00:00:00Z", token)
          )
        ).status
      ).toBe(200);
      expect((await GET(request("?period=day&date=2026-08-20&listenerQuery=taro", token))).status).toBe(200);
    });
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

  describe("listenerQuery", () => {
    it("uniqueId/nicknameの部分一致(大小文字無視)で絞り込む", async () => {
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
          dayKey: "2026-08-27",
          receivedAt: new Date("2026-08-27T10:00:00Z"),
        },
      });
      await prisma.gift.create({
        data: {
          roomId,
          uniqueId: "hanako_listener",
          nickname: "花子",
          giftId: 1,
          giftName: "Rose",
          repeatCount: 1,
          diamondCount: 1,
          totalDiamonds: 1,
          dayKey: "2026-08-27",
          receivedAt: new Date("2026-08-27T10:01:00Z"),
        },
      });

      const res = await GET(request("?period=day&date=2026-08-27&listenerQuery=taro", token));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.events.map((e: { uniqueId: string }) => e.uniqueId)).toEqual(["Taro_Listener"]);
    });

    it("100文字を超えるlistenerQueryは400", async () => {
      const res = await GET(request(`?period=day&date=2026-08-20&listenerQuery=${"a".repeat(101)}`, token));
      expect(res.status).toBe(400);
    });
  });
});
