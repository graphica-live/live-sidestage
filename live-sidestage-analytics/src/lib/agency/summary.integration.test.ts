// ローカルテストDB(.env.local.test / docker-compose.yml)が必要。
// `npm run test:integration` (内部でdotenv -e .env.local.testを付与)経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { queryRoomSummariesRaw } from "./summary";

const TIKTOK_ID_A = "itest_agency_summary_a";
const TIKTOK_ID_B = "itest_agency_summary_b";
const TIKTOK_ID_EMPTY = "itest_agency_summary_empty";

let roomA: string;
let roomB: string;
let roomEmpty: string;
let streamerId: string;
let userId: string;

type GiftOverrides = Partial<{
  roomId: string;
  uniqueId: string;
  repeatCount: number;
  totalDiamonds: number;
  receivedAt: Date;
  dayKey: string;
}>;

async function makeGift(overrides: GiftOverrides) {
  return prisma.gift.create({
    data: {
      roomId: roomA,
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
  const [a, b, e] = await Promise.all([
    prisma.tiktokRoom.create({ data: { tiktokId: TIKTOK_ID_A } }),
    // B / EMPTY は Streamer も AgencyWatch も付けない集計専用の部屋。Streamer 0人でも
    // watchedRoomFilter() の監視対象になったため、monitoringSuspended: true で共有プールから
    // 外す(並行して走る listener 系テストの getMyRooms() に claim させない)。
    prisma.tiktokRoom.create({ data: { tiktokId: TIKTOK_ID_B, monitoringSuspended: true } }),
    prisma.tiktokRoom.create({ data: { tiktokId: TIKTOK_ID_EMPTY, monitoringSuspended: true } }),
  ]);
  roomA = a.id;
  roomB = b.id;
  roomEmpty = e.id;
});

afterAll(async () => {
  await Promise.all(
    [roomA, roomB, roomEmpty].map((id) =>
      prisma.tiktokRoom.delete({ where: { id } }).catch(() => {}) // cascades TiktokRoom -> Gift
    )
  );
  await prisma.$disconnect();
});

describe("queryRoomSummariesRaw", () => {
  it("複数roomを混同せず、部屋ごとに分離して集計する", async () => {
    await makeGift({ roomId: roomA, uniqueId: "user_a", repeatCount: 2, totalDiamonds: 20 });
    await makeGift({ roomId: roomA, uniqueId: "user_b", repeatCount: 3, totalDiamonds: 30 });
    await makeGift({ roomId: roomB, uniqueId: "user_a", repeatCount: 1, totalDiamonds: 7 });

    const result = await queryRoomSummariesRaw([roomA, roomB], {
      from: "2026-08-15",
      to: "2026-08-15",
    });

    expect(result.get(roomA)).toMatchObject({
      giftCount: 5,
      totalDiamonds: 50,
      supporterCount: 2,
    });
    expect(result.get(roomB)).toMatchObject({
      giftCount: 1,
      totalDiamonds: 7,
      supporterCount: 1,
    });
  });

  it("lastGiftAtは期間内で最も新しい受信時刻になる", async () => {
    const latest = new Date("2026-08-16T23:00:00Z");
    await makeGift({ roomId: roomA, dayKey: "2026-08-16", receivedAt: new Date("2026-08-16T01:00:00Z") });
    await makeGift({ roomId: roomA, dayKey: "2026-08-16", receivedAt: latest });

    const result = await queryRoomSummariesRaw([roomA], { from: "2026-08-16", to: "2026-08-16" });
    expect(result.get(roomA)!.lastGiftAt).toBe(latest.toISOString());
  });

  it("期間外のギフトは含めない", async () => {
    await makeGift({ roomId: roomA, dayKey: "2026-07-01", receivedAt: new Date("2026-07-01T00:00:00Z"), totalDiamonds: 999 });

    const result = await queryRoomSummariesRaw([roomA], { from: "2026-08-15", to: "2026-08-15" });
    expect(result.get(roomA)!.totalDiamonds).toBe(50);
  });

  it("ギフト0件のroomも0埋めで返す", async () => {
    const result = await queryRoomSummariesRaw([roomEmpty], { from: "2026-08-15", to: "2026-08-15" });
    expect(result.get(roomEmpty)).toEqual({
      roomId: roomEmpty,
      giftCount: 0,
      totalDiamonds: 0,
      supporterCount: 0,
      lastGiftAt: null,
    });
  });

  it("roomIdsが空なら空Mapを返す", async () => {
    const result = await queryRoomSummariesRaw([], { from: "2026-08-15", to: "2026-08-15" });
    expect(result.size).toBe(0);
  });
});
