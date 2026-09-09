// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
import { setSetting } from "@/lib/settings";
import { betaSettingKey } from "@/lib/plan/beta-settings";
import { acquireBetaSettingLock } from "@/lib/__fixtures__/beta-setting-lock";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_gift_breakdown";

/** このファイルが作る TikTokUser 行の uid。他ファイルと衝突しないよう接頭辞を付ける。 */
const listenerUid = (tiktokHandle: string) => makeTiktokUid(`itest_mobile_gift_breakdown_${tiktokHandle}`);
const FAN_A_UID = listenerUid("fan_a");
const FAN_B_UID = listenerUid("fan_b");

let principalId: string;
let roomId: string;
let noRoomPrincipalId: string;
let freePrincipalId: string;
let token: string;
let noRoomToken: string;
let freeToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-gift-breakdown-secret";

// analyticsBetaEnabled は AppSetting の単一行でファイル間共有。me/route.integration.test.ts が
// これを一時的に true へ切り替えるテストを持つため、倒すタイミングを工夫するだけでは窓が消えず
// 双方向に落ちる(2026-09-09 実測)。このファイルが走る間はロックを保持して β の書き換えを閉め出す。
const betaLock = acquireBetaSettingLock();

beforeAll(async () => {
  await betaLock.acquired;
  await setSetting(betaSettingKey("analytics"), "false");

  const room = await prisma.tiktokRoom.create({
    data: { tiktokHandle: TIKTOK_ID, hostTiktokUid: makeTiktokUid(TIKTOK_ID) },
  });
  roomId = room.id;

  const user = await prisma.principal.create({ data: { email: `itest-mobile-gift-breakdown-${Date.now()}@local.test` } });
  principalId = user.id;
  await prisma.streamer.create({
    data: {
      principalId,
      tiktokUid: makeTiktokUid(TIKTOK_ID),
      tiktokHandle: TIKTOK_ID,
      verificationCode: "x",
      verified: false,
      roomId,
    },
  });
  token = signMobileToken({ principalId });

  const noRoom = await prisma.principal.create({
    data: { email: `itest-mobile-gift-breakdown-noroom-${Date.now()}@local.test` },
  });
  noRoomPrincipalId = noRoom.id;
  noRoomToken = signMobileToken({ principalId: noRoomPrincipalId });

  // month/year/custom range はPRO限定(requireHistoryPlan)。このファイルの主目的は
  // breakdown自体の配線の検証であって、プラン判定の重複検証ではないためPRO扱いにする。
  await prisma.subscription.create({
    data: {
      principalId,
      plan: "PRO",
      entitlementActive: true,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const freeUser = await prisma.principal.create({
    data: { email: `itest-mobile-gift-breakdown-free-${Date.now()}@local.test` },
  });
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
  await betaLock.release();
  await prisma.subscription.deleteMany({ where: { principalId } }).catch(() => {});
  await prisma.principal.delete({ where: { id: principalId } }).catch(() => {});
  await prisma.principal.delete({ where: { id: noRoomPrincipalId } }).catch(() => {});
  await prisma.principal.delete({ where: { id: freePrincipalId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> Gift
  await prisma.tikTokUser.deleteMany({ where: { tiktokUid: { in: [FAN_A_UID, FAN_B_UID] } } }).catch(() => {});
  await prisma.$disconnect();
});

function request(query: string, bearer?: string) {
  return new NextRequest(`http://localhost/api/mobile/analytics/gifts/breakdown${query}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

describe("GET /api/mobile/analytics/gifts/breakdown", () => {
  it("トークンが無ければ401", async () => {
    const res = await GET(request(`?period=day&date=2026-08-20&tiktokUid=${FAN_A_UID}`));
    expect(res.status).toBe(401);
  });

  it("tiktokUidが無ければ400", async () => {
    const res = await GET(request("?period=day&date=2026-08-20", token));
    expect(res.status).toBe(400);
  });

  it("Streamerはあるがroom未接続なら内訳なしで200", async () => {
    const res = await GET(request(`?period=day&date=2026-08-20&tiktokUid=${FAN_A_UID}`, noRoomToken));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.gifts).toEqual([]);
    expect(body.coverage.detailAvailable).toBe(false);
  });

  it("FREEプランはmonth期間の内訳取得を拒否される", async () => {
    const res = await GET(request(`?period=month&date=2026-08-20&tiktokUid=${FAN_A_UID}`, freeToken));
    expect(res.status).toBe(403);
  });

  it("day期間内のギフトをギフト名別に集計して返す(明細が残っている期間)", async () => {
    const dayKey = "2026-08-20";
    const receivedAt = new Date("2026-08-20T10:00:00Z");
    // 表示名(tiktokHandle / nickname)は Gift ではなく TikTokUser が持つ。
    await prisma.tikTokUser.createMany({
      data: [
        { tiktokUid: FAN_A_UID, tiktokHandle: "fan_a", nickname: "ファンA" },
        { tiktokUid: FAN_B_UID, tiktokHandle: "fan_b", nickname: "ファンB" },
      ],
      skipDuplicates: true,
    });
    await prisma.gift.create({
      data: {
        roomId,
        tiktokUid: FAN_A_UID,
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
        tiktokUid: FAN_A_UID,
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
        tiktokUid: FAN_B_UID,
        giftId: 5655,
        giftName: "Rose",
        repeatCount: 10,
        diamondCount: 1,
        totalDiamonds: 10,
        dayKey,
        receivedAt,
      },
    });

    const res = await GET(request(`?period=day&date=${dayKey}&tiktokUid=${FAN_A_UID}`, token));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tiktokUid).toBe(FAN_A_UID);
    expect(body.coverage.detailAvailable).toBe(true);
    expect(body.total).toEqual({ repeatCount: 4, totalDiamonds: 202 });
    // totalDiamonds降順(gift-breakdown.tsのorderBy)。
    expect(body.gifts.map((g: { giftName: string; repeatCount: number; totalDiamonds: number }) => g)).toEqual([
      { giftId: 6805, giftName: "Rosa", giftPictureUrl: null, repeatCount: 1, diamondCount: 199, totalDiamonds: 199, lastReceivedAt: expect.any(String) },
      { giftId: 5655, giftName: "Rose", giftPictureUrl: null, repeatCount: 3, diamondCount: 1, totalDiamonds: 3, lastReceivedAt: expect.any(String) },
    ]);
  });
});
