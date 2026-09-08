// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
import { setSetting } from "@/lib/settings";
import { betaSettingKey } from "@/lib/plan/beta-settings";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_ranking";

let principalId: string;
let streamerId: string;
let roomId: string;
let noRoomPrincipalId: string;
let freePrincipalId: string;
let token: string;
let noRoomToken: string;
let freeToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-ranking-secret";

beforeAll(async () => {
  // me/route.integration.test.tsがanalyticsBetaEnabledを一時的にtrueへ切り替えるテストを
  // 持つため、並列実行時にこのファイルのFREE拒否テストがβ経由で通ってしまう
  // 非決定的失敗を避ける(実装後レビュー指摘、LOW)。この機能(mobile.history.*)は
  // analytics領域のβでバイパスされる設計のため、mobileではなくanalyticsを明示的にfalseへ倒す。
  // 真の並列プロセス間競合までは防げないが、少なくともこのファイル自身が前提を明示する。
  await setSetting(betaSettingKey("analytics"), "false");

  const room = await prisma.tiktokRoom.create({
    data: { tiktokHandle: TIKTOK_ID, hostTiktokUid: makeTiktokUid(TIKTOK_ID) },
  });
  roomId = room.id;

  const user = await prisma.user.create({ data: { email: `itest-mobile-ranking-${Date.now()}@local.test` } });
  principalId = user.id;
  const streamer = await prisma.streamer.create({
    data: {
      principalId,
      tiktokUid: makeTiktokUid(TIKTOK_ID),
      tiktokHandle: TIKTOK_ID,
      verificationCode: "x",
      verified: false,
      roomId,
    },
  });
  streamerId = streamer.id;
  // 偽装されたstreamerId(実在しないID)を持つトークンでも、principalIdから引き直すので
  // 越権(他人の部屋の閲覧)は起きないことを検証するために使う。
  token = signMobileToken({ principalId, streamerId: "forged-streamer-id" });

  const noRoom = await prisma.user.create({ data: { email: `itest-mobile-ranking-noroom-${Date.now()}@local.test` } });
  noRoomPrincipalId = noRoom.id;
  noRoomToken = signMobileToken({ principalId: noRoomPrincipalId });

  // custom range / listenerQuery はPRO限定機能(requireHistoryPlan)なので、
  // FREEのままだと既存のcustom range系テストが403で落ちる。このファイルの主目的は
  // 期間集計ロジックの検証であってプラン判定の検証ではないため、mainのprincipalIdはPRO扱いにする。
  await prisma.subscription.create({
    data: {
      principalId,
      plan: "PRO",
      entitlementActive: true,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // requireHistoryPlanのプラン拒否そのものを検証するための、room接続済み・
  // Subscription無し(=FREE)のユーザー。同一TikTok IDを複数Streamerが共有できる
  // 既存仕様どおり、principalId側と同じroomIdへ別のStreamer行として登録する。
  const freeUser = await prisma.user.create({ data: { email: `itest-mobile-ranking-free-${Date.now()}@local.test` } });
  freePrincipalId = freeUser.id;
  await prisma.streamer.create({
    data: {
      principalId: freePrincipalId,
      tiktokUid: makeTiktokUid(TIKTOK_ID),
      tiktokHandle: TIKTOK_ID,
      verificationCode: "x",
      verified: false,
      roomId,
    },
  });
  freeToken = signMobileToken({ principalId: freePrincipalId });
});

afterAll(async () => {
  await prisma.subscription.deleteMany({ where: { principalId } }).catch(() => {});
  await prisma.user.delete({ where: { id: principalId } }).catch(() => {});
  await prisma.user.delete({ where: { id: noRoomPrincipalId } }).catch(() => {});
  await prisma.user.delete({ where: { id: freePrincipalId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> Gift
  await prisma.tikTokUser.deleteMany({ where: { tiktokUid: { in: [...listenerUids] } } }).catch(() => {});
  await prisma.$disconnect();
});

function request(query: string, bearer?: string) {
  return new NextRequest(`http://localhost/api/mobile/analytics/ranking${query}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

/** このファイルが作る TikTokUser 行の uid。他ファイルと衝突しないよう接頭辞を付ける。 */
const listenerUid = (tiktokHandle: string) => makeTiktokUid(`itest_mobile_ranking_${tiktokHandle}`);
const listenerUids = new Set<string>();

/**
 * ギフト1件。**表示名(tiktokHandle / nickname)は Gift ではなく TikTokUser が持つ**ので、
 * 先に TikTokUser 行を用意してから tiktokUid だけを Gift へ書く。
 * ランキングの集計キーは tiktokUid で、表示と listenerQuery の絞り込みだけが順引き。
 */
async function addGift(tiktokHandle: string, nickname: string, totalDiamonds: number, receivedAt: Date, dayKey: string) {
  const tiktokUid = listenerUid(tiktokHandle);
  listenerUids.add(tiktokUid);
  await prisma.tikTokUser.upsert({
    where: { tiktokUid },
    create: { tiktokUid, tiktokHandle, nickname },
    update: { tiktokHandle, nickname },
  });
  return prisma.gift.create({
    data: {
      roomId,
      tiktokUid,
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
    const res = await GET(request("?period=decade&date=2026-08-20", token));
    expect(res.status).toBe(400);
  });

  it("不正な(存在しない)dateは400", async () => {
    const res = await GET(request("?period=day&date=2026-02-30", token));
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

  it("totalDiamonds降順でソートされ、順位はインデックスで決まる", async () => {
    await addGift("user_low", "Bさん", 10, new Date("2026-08-21T10:00:00Z"), "2026-08-21");
    await addGift("user_high", "Aさん", 100, new Date("2026-08-21T10:01:00Z"), "2026-08-21");

    const res = await GET(request("?period=day&date=2026-08-21", token));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.users.map((u: { tiktokHandle: string }) => u.tiktokHandle)).toEqual(["user_high", "user_low"]);
    expect(body.total).toEqual({ giftCount: 2, totalDiamonds: 110 });
    expect(body.verified).toBe(false);
    expect(body.dateRange).toEqual({ start: "2026-08-21", end: "2026-08-21" });
  });

  it("同点はtiktokHandle昇順で決定的に並ぶ", async () => {
    await addGift("user_z", "Zさん", 50, new Date("2026-08-22T10:00:00Z"), "2026-08-22");
    await addGift("user_a", "Aさん", 50, new Date("2026-08-22T10:01:00Z"), "2026-08-22");

    const res = await GET(request("?period=day&date=2026-08-22", token));
    const body = await res.json();
    expect(body.users.map((u: { tiktokHandle: string }) => u.tiktokHandle)).toEqual(["user_a", "user_z"]);
  });

  it("偽装されたstreamerIdでは他人の部屋を参照できない(principalIdから引き直す)", async () => {
    // tokenのstreamerIdは実在しないIDだが、principalIdは正規のものなのでroomIdは正しく解決される。
    const res = await GET(request("?period=day&date=2026-08-21", token));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.users.length).toBeGreaterThan(0);
  });

  describe("startDatetime/endDatetime(custom range)", () => {
    it("範囲内のギフトだけを集計する", async () => {
      await addGift("user_custom_in", "範囲内さん", 30, new Date("2026-08-25T10:00:00Z"), "2026-08-25");
      await addGift("user_custom_out", "範囲外さん", 999, new Date("2026-08-25T13:00:00Z"), "2026-08-25");

      const res = await GET(
        request(
          "?startDatetime=2026-08-25T09%3A00%3A00Z&endDatetime=2026-08-25T12%3A00%3A00Z",
          token
        )
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.users.map((u: { tiktokHandle: string }) => u.tiktokHandle)).toEqual(["user_custom_in"]);
      expect(body.dateRange).toEqual({
        start: "2026-08-25T09:00:00.000Z",
        end: "2026-08-25T12:00:00.000Z",
      });
    });

    it("receivedAt == endは含まれる(inclusive)", async () => {
      await addGift("user_boundary_end", "境界さん", 7, new Date("2026-08-26T12:00:00.000Z"), "2026-08-26");

      const res = await GET(
        request(
          "?startDatetime=2026-08-26T00%3A00%3A00Z&endDatetime=2026-08-26T12%3A00%3A00Z",
          token
        )
      );
      const body = await res.json();
      expect(body.users.map((u: { tiktokHandle: string }) => u.tiktokHandle)).toContain("user_boundary_end");
    });

    it("片方だけの指定は400", async () => {
      const res = await GET(request("?startDatetime=2026-08-25T00%3A00%3A00Z", token));
      expect(res.status).toBe(400);
    });

    it("start >= endは400", async () => {
      const res = await GET(
        request(
          "?startDatetime=2026-08-25T12%3A00%3A00Z&endDatetime=2026-08-25T09%3A00%3A00Z",
          token
        )
      );
      expect(res.status).toBe(400);
    });

    it("他部屋のギフトは混ざらない", async () => {
      // Streamer を付けない他人の部屋。Streamer 0人でも watchedRoomFilter() の監視対象に
      // なったため、monitoringSuspended: true で共有プールから外す(並行して走る listener 系
      // テストの getMyRooms() に claim させない)。
      const otherRoom = await prisma.tiktokRoom.create({
        data: {
          tiktokHandle: "itest_mobile_ranking_other",
          hostTiktokUid: makeTiktokUid("itest_mobile_ranking_other"),
          monitoringSuspended: true,
        },
      });
      const otherListenerUid = listenerUid("other_room_user");
      listenerUids.add(otherListenerUid);
      await prisma.tikTokUser.upsert({
        where: { tiktokUid: otherListenerUid },
        create: { tiktokUid: otherListenerUid, tiktokHandle: "other_room_user", nickname: "他部屋さん" },
        update: {},
      });
      await prisma.gift.create({
        data: {
          roomId: otherRoom.id,
          tiktokUid: otherListenerUid,
          giftId: 1,
          giftName: "Rose",
          repeatCount: 1,
          diamondCount: 500,
          totalDiamonds: 500,
          dayKey: "2026-08-25",
          receivedAt: new Date("2026-08-25T10:00:00Z"),
        },
      });

      try {
        const res = await GET(
          request(
            "?startDatetime=2026-08-25T09%3A00%3A00Z&endDatetime=2026-08-25T12%3A00%3A00Z",
            token
          )
        );
        const body = await res.json();
        expect(body.users.map((u: { tiktokHandle: string }) => u.tiktokHandle)).not.toContain("other_room_user");
      } finally {
        await prisma.tiktokRoom.delete({ where: { id: otherRoom.id } }).catch(() => {});
      }
    });
  });

  describe("listenerQuery", () => {
    it("tiktokHandle/nicknameの部分一致(大小文字無視)で絞り込み、日付条件とAND結合される", async () => {
      await addGift("Taro_Listener", "たろう", 15, new Date("2026-08-27T10:00:00Z"), "2026-08-27");
      await addGift("hanako_listener", "花子", 25, new Date("2026-08-27T10:01:00Z"), "2026-08-27");
      await addGift("Taro_Listener", "たろう", 999, new Date("2026-08-28T10:00:00Z"), "2026-08-28"); // 別日は対象外

      const res = await GET(request("?period=day&date=2026-08-27&listenerQuery=taro", token));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.users.map((u: { tiktokHandle: string }) => u.tiktokHandle)).toEqual(["Taro_Listener"]);
      expect(body.total).toEqual({ giftCount: 1, totalDiamonds: 15 });
    });

    it("100文字を超えるlistenerQueryは400", async () => {
      const res = await GET(request(`?period=day&date=2026-08-20&listenerQuery=${"a".repeat(101)}`, token));
      expect(res.status).toBe(400);
    });
  });
});
