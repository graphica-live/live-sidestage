// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// hostTiktokUid を事前にseedしておき、backfillHostTiktokUids()(外部TikTok問い合わせ)を
// 実際には発火させない状態でテストする。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";
import { setSetting } from "@/lib/settings";
import { betaSettingKey } from "@/lib/plan/beta-settings";
import { acquireBetaSettingLock } from "@/lib/__fixtures__/beta-setting-lock";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_battles";

let principalId: string;
let roomId: string;
let noRoomPrincipalId: string;
let freePrincipalId: string;
let token: string;
let noRoomToken: string;
let freeToken: string;

// TiktokRoom.hostTiktokUid は @unique。テストファイルは並列実行されるので値をファイル固有にする。
const HOST_UID = makeTiktokUid("itest_mobile_battles_host");
const LISTENER_UID = makeTiktokUid("itest_mobile_battles_taro");

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-battles-secret";

// analyticsBetaEnabled は AppSetting の単一行でファイル間共有。me/route.integration.test.ts が
// これを一時的に true へ切り替えるテストを持つため、倒すタイミングを工夫するだけでは窓が消えず
// 双方向に落ちる(2026-09-09 実測)。このファイルが走る間はロックを保持して β の書き換えを閉め出す。
// この機能(mobile.history.*)は analytics 領域の β でバイパスされる設計なので、mobile ではなく
// analytics を false にする。
const betaLock = acquireBetaSettingLock();

beforeAll(async () => {
  await betaLock.acquired;
  await setSetting(betaSettingKey("analytics"), "false");

  const room = await prisma.tiktokRoom.create({ data: { tiktokHandle: TIKTOK_ID, hostTiktokUid: HOST_UID } });
  roomId = room.id;

  const user = await prisma.user.create({ data: { email: `itest-mobile-battles-${Date.now()}@local.test` } });
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

  const noRoom = await prisma.user.create({ data: { email: `itest-mobile-battles-noroom-${Date.now()}@local.test` } });
  noRoomPrincipalId = noRoom.id;
  noRoomToken = signMobileToken({ principalId: noRoomPrincipalId });

  // custom range / listenerQuery はPRO限定機能(requireHistoryPlan)なので、
  // FREEのままだと既存のcustom range系テストが403で落ちる。このファイルの主目的は
  // バトル区間の集計ロジックの検証であってプラン判定の検証ではないため、mainのprincipalIdはPRO扱いにする。
  await prisma.subscription.create({
    data: {
      principalId,
      plan: "PRO",
      entitlementActive: true,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.tiktokBattle.create({
    data: {
      roomId,
      battleId: "itest-battle-1",
      action: BATTLE_ACTION.FINISH,
      startedAt: new Date("2026-08-24T10:00:00Z"),
      startedAtEstimated: false,
      endedAt: new Date("2026-08-24T10:05:00Z"),
      durationSec: 300,
      hostTiktokUids: [HOST_UID],
      hostScores: { [HOST_UID]: "100" },
    },
  });

  // requireHistoryPlanのプラン拒否そのものを検証するための、room接続済み・
  // Subscription無し(=FREE)のユーザー。
  const freeUser = await prisma.user.create({ data: { email: `itest-mobile-battles-free-${Date.now()}@local.test` } });
  freePrincipalId = freeUser.id;
  await prisma.streamer.create({
    data: {
      principalId: freePrincipalId,
      tiktokUid: HOST_UID,
      tiktokHandle: TIKTOK_ID,
      verificationCode: "x",
      verified: true,
      roomId,
    },
  });
  freeToken = signMobileToken({ principalId: freePrincipalId });
});

afterAll(async () => {
  await betaLock.release();
  await prisma.subscription.deleteMany({ where: { principalId } }).catch(() => {});
  await prisma.user.delete({ where: { id: principalId } }).catch(() => {});
  await prisma.user.delete({ where: { id: noRoomPrincipalId } }).catch(() => {});
  await prisma.user.delete({ where: { id: freePrincipalId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> TiktokBattle
  await prisma.tikTokUser.deleteMany({ where: { tiktokUid: LISTENER_UID } }).catch(() => {});
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

  describe("プラン制限(requireHistoryPlan)", () => {
    it("FREEユーザーのday/weekは通る(拡張範囲でなければプラン判定を通過する)", async () => {
      const res = await GET(request("?period=day&date=2026-08-24", freeToken));
      expect(res.status).toBe(200);
    });

    it("FREEユーザーがmonthを指定すると403", async () => {
      const res = await GET(request("?period=month&date=2026-08-24", freeToken));
      expect(res.status).toBe(403);
    });

    it("FREEユーザーがカスタム範囲を指定すると403", async () => {
      const res = await GET(
        request("?startDatetime=2026-08-24T00:00:00Z&endDatetime=2026-08-25T00:00:00Z", freeToken)
      );
      expect(res.status).toBe(403);
    });

    it("FREEユーザーがlistenerQueryを指定すると403", async () => {
      const res = await GET(request("?period=day&date=2026-08-24&listenerQuery=taro", freeToken));
      expect(res.status).toBe(403);
    });

    it("PROユーザーのmonth/カスタム範囲/listenerQueryは通る", async () => {
      expect((await GET(request("?period=month&date=2026-08-24", token))).status).toBe(200);
      expect(
        (
          await GET(
            request("?startDatetime=2026-08-24T00:00:00Z&endDatetime=2026-08-25T00:00:00Z", token)
          )
        ).status
      ).toBe(200);
      expect((await GET(request("?period=day&date=2026-08-24&listenerQuery=taro", token))).status).toBe(200);
    });
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
          hostTiktokUids: [HOST_UID],
          hostScores: { [HOST_UID]: "50" },
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
      await prisma.tikTokUser.upsert({
        where: { tiktokUid: LISTENER_UID },
        create: { tiktokUid: LISTENER_UID, tiktokHandle: "Taro_Listener", nickname: "たろう" },
        update: { tiktokHandle: "Taro_Listener", nickname: "たろう" },
      });
      await prisma.gift.create({
        data: {
          roomId,
          tiktokUid: LISTENER_UID,
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
