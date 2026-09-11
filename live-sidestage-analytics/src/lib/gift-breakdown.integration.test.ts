// ローカルテストDB(.env.local.test / docker-compose.yml)が必要。
// `npm run test:integration` (内部でdotenv -e .env.local.testを付与)経由で実行すること。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "./prisma";
import { queryGiftBreakdown } from "./gift-breakdown";
import { makeTiktokUid } from "./__fixtures__/gift";

const STREAMER_TIKTOK_ID = "itest_gift_breakdown_streamer";
const HOST_TIKTOK_UID = makeTiktokUid("itest_gift_breakdown_host");
const CATALOG_GIFT_ID = 900_001;
// 絞り込みは tiktokUid で行う(Gift にハンドル列は無い)。
const LISTENER_A = makeTiktokUid("itest_breakdown_listener_a");
const LISTENER_B = makeTiktokUid("itest_breakdown_listener_b");
const LISTENER_C = makeTiktokUid("itest_breakdown_listener_c");
const LISTENER_D = makeTiktokUid("itest_breakdown_listener_d");
let roomId: string;

type GiftOverrides = Partial<{
  tiktokUid: string;
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  repeatCount: number;
  diamondCount: number;
  totalDiamonds: number;
  receivedAt: Date;
  dayKey: string;
}>;

async function makeGift(overrides: GiftOverrides) {
  return prisma.gift.create({
    data: {
      roomId,
      tiktokUid: LISTENER_A,
      giftId: 1,
      giftName: "Rose",
      giftPictureUrl: null,
      repeatCount: 1,
      diamondCount: 1,
      totalDiamonds: 1,
      receivedAt: new Date("2026-09-05T10:00:00Z"),
      dayKey: "2026-09-05",
      ...overrides,
    },
  });
}

// 保持ウィンドウ(80日)の内側を常に指すようにする。実時刻に依存させるとテストが将来落ちる。
const NOW = new Date("2026-09-07T00:00:00Z");
const DAY = { gte: "2026-09-05", lte: "2026-09-05" };

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({
    data: { tiktokHandle: STREAMER_TIKTOK_ID, hostTiktokUid: HOST_TIKTOK_UID },
  });
  roomId = room.id;
});

// テスト間でギフトを持ち越さない(実行順や後から足したケースに結果を依存させない)。
// このテスト専用 room の行だけを消すので、他ファイルのテストとは干渉しない。
beforeEach(async () => {
  await prisma.gift.deleteMany({ where: { roomId } });
});

afterAll(async () => {
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> Gift
  await prisma.tiktokGiftCatalog.deleteMany({ where: { giftId: CATALOG_GIFT_ID } }).catch(() => {});
  await prisma.$disconnect();
});

describe("queryGiftBreakdown", () => {
  it("ギフト名別に合計し、コイン数の降順で返す", async () => {
    await makeGift({ giftId: 11, giftName: "Rose", repeatCount: 10, diamondCount: 1, totalDiamonds: 10 });
    await makeGift({ giftId: 11, giftName: "Rose", repeatCount: 5, diamondCount: 1, totalDiamonds: 5 });
    await makeGift({
      giftId: 12,
      giftName: "Galaxy",
      giftPictureUrl: "https://example.test/galaxy.png",
      repeatCount: 2,
      diamondCount: 1000,
      totalDiamonds: 2000,
      receivedAt: new Date("2026-09-05T12:00:00Z"),
    });

    const result = await queryGiftBreakdown(roomId, LISTENER_A, { dayKey: DAY }, NOW);

    expect(result.gifts.map((g) => g.giftId)).toEqual([12, 11]); // totalDiamonds 降順
    const rose = result.gifts.find((g) => g.giftId === 11)!;
    expect(rose.repeatCount).toBe(15); // 10 + 5
    expect(rose.diamondCount).toBe(2); // 1 + 1 (行ごとの単価の合計)
    expect(rose.totalDiamonds).toBe(15);

    const galaxy = result.gifts.find((g) => g.giftId === 12)!;
    expect(galaxy.giftPictureUrl).toBe("https://example.test/galaxy.png");
    expect(galaxy.lastReceivedAt).toBe(new Date("2026-09-05T12:00:00Z").toISOString());

    expect(result.total).toEqual({ repeatCount: 17, totalDiamonds: 2015 });
    expect(result.coverage).toEqual({ detailAvailable: true, rawFrom: null, partial: false });
  });

  it("他ユーザーのギフトは混ざらない", async () => {
    await makeGift({ tiktokUid: LISTENER_B, giftId: 21, giftName: "Lion", totalDiamonds: 999 });

    const result = await queryGiftBreakdown(roomId, LISTENER_A, { dayKey: DAY }, NOW);
    expect(result.gifts.find((g) => g.giftId === 21)).toBeUndefined();

    const other = await queryGiftBreakdown(roomId, LISTENER_B, { dayKey: DAY }, NOW);
    expect(other.gifts.map((g) => g.giftId)).toEqual([21]);
  });

  it("期間外のギフトは含めない", async () => {
    await makeGift({
      tiktokUid: LISTENER_C,
      giftId: 31,
      dayKey: "2026-09-01",
      receivedAt: new Date("2026-09-01T10:00:00Z"),
      totalDiamonds: 777,
    });

    const result = await queryGiftBreakdown(roomId, LISTENER_C, { dayKey: DAY }, NOW);
    expect(result.gifts).toEqual([]);
    expect(result.total).toEqual({ repeatCount: 0, totalDiamonds: 0 });
    // 明細は読めた(単に0件)。「内訳が残っていない」とは区別する。
    expect(result.coverage.detailAvailable).toBe(true);
  });

  it("TiktokGiftCatalog に labelJa があれば日本語名で返す", async () => {
    await prisma.tiktokGiftCatalog.create({
      data: {
        giftId: CATALOG_GIFT_ID,
        name: "doughnut",
        label: "Doughnut",
        labelJa: "ドーナツ",
        diamondCount: 30,
      },
    });
    await makeGift({
      tiktokUid: LISTENER_D,
      giftId: CATALOG_GIFT_ID,
      giftName: "Doughnut",
      totalDiamonds: 30,
    });

    const result = await queryGiftBreakdown(roomId, LISTENER_D, { dayKey: DAY }, NOW);
    expect(result.gifts[0].giftName).toBe("ドーナツ");
  });

  it("ギフト種類数が上限(100)を超えたら上位100件のみ返し、合計は全件ベースのまま", async () => {
    const LISTENER_E = makeTiktokUid("itest_breakdown_listener_e");
    for (let i = 0; i < 101; i++) {
      await makeGift({
        tiktokUid: LISTENER_E,
        giftId: 20_000 + i,
        giftName: `Gift${i}`,
        repeatCount: 1,
        diamondCount: 1,
        totalDiamonds: i + 1, // 全件ユニークな値にして、上位100件の判定を検証しやすくする
      });
    }

    const result = await queryGiftBreakdown(roomId, LISTENER_E, { dayKey: DAY }, NOW);

    expect(result.truncated).toBe(true);
    expect(result.gifts).toHaveLength(100);
    // 降順ソートなので、切り捨てられるのは最小値(totalDiamonds=1)の1件だけ。
    expect(result.gifts.some((g) => g.totalDiamonds === 1)).toBe(false);
    // 合計は絞り込み前の全101件ベース(1..101の和)のまま。
    expect(result.total).toEqual({ repeatCount: 101, totalDiamonds: 5151 });
  });

  it("上限以下のときは truncated が false", async () => {
    await makeGift({ giftId: 41, giftName: "Rose", totalDiamonds: 10 });

    const result = await queryGiftBreakdown(roomId, LISTENER_A, { dayKey: DAY }, NOW);
    expect(result.truncated).toBe(false);
  });
});
