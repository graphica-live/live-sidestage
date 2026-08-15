// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "./prisma";
import { buildOverlaySnapshot } from "./overlay";

const STREAMER_TIKTOK_ID = "itest_overlay_streamer";
let streamerId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `itest-overlay-${Date.now()}@local.test` } });
  const streamer = await prisma.streamer.create({
    data: {
      userId: user.id,
      tiktokId: STREAMER_TIKTOK_ID,
      verificationCode: "x",
      verified: true,
      overlayThreshold: 100,
      overlayDisplayReference: "fixed",
      overlayDisplayDate: "2026-08-15",
    },
  });
  streamerId = streamer.id;
});

afterAll(async () => {
  const streamer = await prisma.streamer.findUnique({ where: { id: streamerId } });
  if (streamer) {
    await prisma.user.delete({ where: { id: streamer.userId } });
  }
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
        { streamerId, uniqueId: "user_slow", nickname: "遅い人", giftId: 1, giftName: "Rose", repeatCount: 1, diamondCount: 60, totalDiamonds: 60, dayKey: "2026-08-15", receivedAt: new Date("2026-08-15T10:00:00Z") },
        // user_fast: 50 + 60 = 110 が 11:00 に閾値(100)到達
        { streamerId, uniqueId: "user_fast", nickname: "速い人", giftId: 1, giftName: "Rose", repeatCount: 1, diamondCount: 50, totalDiamonds: 50, dayKey: "2026-08-15", receivedAt: new Date("2026-08-15T09:00:00Z") },
        { streamerId, uniqueId: "user_fast", nickname: "速い人", giftId: 1, giftName: "Rose", repeatCount: 1, diamondCount: 60, totalDiamonds: 60, dayKey: "2026-08-15", receivedAt: new Date("2026-08-15T11:00:00Z") },
        // user_slower: 40 + 70 = 110 が 11:30 に閾値到達(user_fastより後)
        { streamerId, uniqueId: "user_slower", nickname: "もっと遅い人", giftId: 1, giftName: "Rose", repeatCount: 1, diamondCount: 40, totalDiamonds: 40, dayKey: "2026-08-15", receivedAt: new Date("2026-08-15T09:30:00Z") },
        { streamerId, uniqueId: "user_slower", nickname: "もっと遅い人", giftId: 1, giftName: "Rose", repeatCount: 1, diamondCount: 70, totalDiamonds: 70, dayKey: "2026-08-15", receivedAt: new Date("2026-08-15T11:30:00Z") },
      ],
    });

    const snapshot = await buildOverlaySnapshot(streamerId);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.qualifiedCount).toBe(2);
    expect(snapshot!.contributors.map((c) => c.uniqueId)).toEqual(["user_fast", "user_slower"]);
    expect(snapshot!.contributors[0].totalDiamonds).toBe(110);
    expect(snapshot!.threshold).toBe(100);
  });

  it("存在しないstreamerIdならnullを返す", async () => {
    const snapshot = await buildOverlaySnapshot("does-not-exist");
    expect(snapshot).toBeNull();
  });
});
