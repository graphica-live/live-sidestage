// ローカルテストDB(.env.local.test / docker-compose.yml)が必要。
// `npm run test:integration` (内部でdotenv -e .env.local.testを付与)経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { queryGifts } from "./gift-analytics";

const STREAMER_TIKTOK_ID = "itest_gift_analytics_streamer";
let streamerId: string;

type GiftOverrides = Partial<{
  uniqueId: string;
  nickname: string;
  repeatCount: number;
  totalDiamonds: number;
  receivedAt: Date;
  dayKey: string;
}>;

async function makeGift(overrides: GiftOverrides) {
  return prisma.gift.create({
    data: {
      streamerId,
      uniqueId: "user_a",
      nickname: "ユーザーA",
      profileImageUrl: null,
      giftId: 1,
      giftName: "Rose",
      repeatCount: 1,
      diamondCount: 1,
      totalDiamonds: 1,
      receivedAt: new Date("2026-08-15T10:00:00Z"),
      dayKey: "2026-08-15",
      ...overrides,
    },
  });
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `itest-gift-analytics-${Date.now()}@local.test` } });
  const streamer = await prisma.streamer.create({
    data: { userId: user.id, tiktokId: STREAMER_TIKTOK_ID, verificationCode: "x", verified: true },
  });
  streamerId = streamer.id;
});

afterAll(async () => {
  const streamer = await prisma.streamer.findUnique({ where: { tiktokId: STREAMER_TIKTOK_ID } });
  if (streamer) {
    await prisma.user.delete({ where: { id: streamer.userId } }); // cascades streamer -> gifts
  }
  await prisma.$disconnect();
});

describe("queryGifts", () => {
  it("同一ユーザーの複数ギフトをコイン数・件数で集計する", async () => {
    await makeGift({ uniqueId: "user_a", nickname: "ユーザーA", repeatCount: 2, totalDiamonds: 20, receivedAt: new Date("2026-08-15T09:00:00Z") });
    await makeGift({ uniqueId: "user_a", nickname: "ユーザーA", repeatCount: 3, totalDiamonds: 30, receivedAt: new Date("2026-08-15T11:00:00Z") });
    await makeGift({ uniqueId: "user_b", nickname: "ユーザーB", repeatCount: 1, totalDiamonds: 5, receivedAt: new Date("2026-08-15T10:30:00Z") });

    const { users, total } = await queryGifts(streamerId, { dayKey: { gte: "2026-08-15", lte: "2026-08-15" } });

    const userA = users.find((u) => u.uniqueId === "user_a");
    expect(userA).toBeDefined();
    expect(userA!.giftCount).toBe(5); // 2 + 3
    expect(userA!.totalDiamonds).toBe(50); // 20 + 30
    expect(userA!.lastGiftAt).toBe(new Date("2026-08-15T11:00:00Z").toISOString());

    const userB = users.find((u) => u.uniqueId === "user_b");
    expect(userB!.totalDiamonds).toBe(5);

    expect(total.giftCount).toBe(6);
    expect(total.totalDiamonds).toBe(55);
  });

  it("dayKey範囲外のギフトは集計に含めない", async () => {
    await makeGift({ uniqueId: "user_c", dayKey: "2026-08-01", receivedAt: new Date("2026-08-01T00:00:00Z"), totalDiamonds: 999 });

    const { users } = await queryGifts(streamerId, { dayKey: { gte: "2026-08-15", lte: "2026-08-15" } });
    expect(users.find((u) => u.uniqueId === "user_c")).toBeUndefined();
  });

  it("該当ギフトが無ければ空配列とゼロ集計を返す", async () => {
    const result = await queryGifts(streamerId, { dayKey: { gte: "1999-01-01", lte: "1999-01-01" } });
    expect(result).toEqual({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
  });
});
