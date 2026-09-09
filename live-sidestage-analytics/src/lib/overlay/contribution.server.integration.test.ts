// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildOverlaySnapshot } from "./contribution.server";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";

const STREAMER_TIKTOK_ID = "itest_overlay_streamer";
const HOST_TIKTOK_UID = makeTiktokUid("itest_overlay_host");

// 貢献タリーの合算キーは tiktokUid。表示名は TikTokUser から順引きするので行を用意する。
const UID_SLOW = makeTiktokUid("itest_overlay_user_slow");
const UID_FAST = makeTiktokUid("itest_overlay_user_fast");
const UID_SLOWER = makeTiktokUid("itest_overlay_user_slower");
const ALL_UIDS = [UID_SLOW, UID_FAST, UID_SLOWER];

let streamerId: string;
let roomId: string;

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({
    data: { tiktokHandle: STREAMER_TIKTOK_ID, hostTiktokUid: HOST_TIKTOK_UID },
  });
  roomId = room.id;

  await prisma.tikTokUser.createMany({
    data: [
      { tiktokUid: UID_SLOW, tiktokHandle: "user_slow", nickname: "遅い人" },
      { tiktokUid: UID_FAST, tiktokHandle: "user_fast", nickname: "速い人" },
      { tiktokUid: UID_SLOWER, tiktokHandle: "user_slower", nickname: "もっと遅い人" },
    ],
    skipDuplicates: true,
  });

  const user = await prisma.principal.create({ data: { email: `itest-overlay-${Date.now()}@local.test` } });
  const streamer = await prisma.streamer.create({
    data: {
      principalId: user.id,
      tiktokUid: HOST_TIKTOK_UID,
      tiktokHandle: STREAMER_TIKTOK_ID,
      verificationCode: "x",
      verified: true,
      roomId,
      overlayContributionSettings: {
        create: {
          threshold: 100,
          displayReference: "fixed",
          displayDate: "2026-08-15",
        },
      },
    },
  });
  streamerId = streamer.id;
});

afterAll(async () => {
  const streamer = await prisma.streamer.findUnique({ where: { id: streamerId } });
  if (streamer) {
    await prisma.principal.delete({ where: { id: streamer.principalId } });
  }
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades TiktokRoom -> Gift
  await prisma.tikTokUser.deleteMany({ where: { tiktokUid: { in: ALL_UIDS } } }).catch(() => {});
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("buildOverlaySnapshot", () => {
  it("閾値到達順に貢献者を並べ、未到達ユーザーは含めない", async () => {
    await prisma.gift.createMany({
      data: [
        // user_slow: 60 -> 未到達
        { roomId, tiktokUid: UID_SLOW, giftId: 1, giftName: "Rose", repeatCount: 1, diamondCount: 60, totalDiamonds: 60, dayKey: "2026-08-15", receivedAt: new Date("2026-08-15T10:00:00Z") },
        // user_fast: 50 + 60 = 110 が 11:00 に閾値(100)到達
        { roomId, tiktokUid: UID_FAST, giftId: 1, giftName: "Rose", repeatCount: 1, diamondCount: 50, totalDiamonds: 50, dayKey: "2026-08-15", receivedAt: new Date("2026-08-15T09:00:00Z") },
        { roomId, tiktokUid: UID_FAST, giftId: 1, giftName: "Rose", repeatCount: 1, diamondCount: 60, totalDiamonds: 60, dayKey: "2026-08-15", receivedAt: new Date("2026-08-15T11:00:00Z") },
        // user_slower: 40 + 70 = 110 が 11:30 に閾値到達(user_fastより後)
        { roomId, tiktokUid: UID_SLOWER, giftId: 1, giftName: "Rose", repeatCount: 1, diamondCount: 40, totalDiamonds: 40, dayKey: "2026-08-15", receivedAt: new Date("2026-08-15T09:30:00Z") },
        { roomId, tiktokUid: UID_SLOWER, giftId: 1, giftName: "Rose", repeatCount: 1, diamondCount: 70, totalDiamonds: 70, dayKey: "2026-08-15", receivedAt: new Date("2026-08-15T11:30:00Z") },
      ],
    });

    const snapshot = await buildOverlaySnapshot(streamerId);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.qualifiedCount).toBe(2);
    expect(snapshot!.contributors.map((c) => c.tiktokUid)).toEqual([UID_FAST, UID_SLOWER]);
    // 表示名は Gift ではなく TikTokUser から順引きした現在値。
    expect(snapshot!.contributors.map((c) => c.tiktokHandle)).toEqual(["user_fast", "user_slower"]);
    expect(snapshot!.contributors[0].totalDiamonds).toBe(110);
    expect(snapshot!.threshold).toBe(100);
  });

  it("存在しないstreamerIdならnullを返す", async () => {
    const snapshot = await buildOverlaySnapshot("does-not-exist");
    expect(snapshot).toBeNull();
  });
});
