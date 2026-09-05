// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// ギフト履歴一覧クエリ(queryGiftHistory)のページング・絞り込み・日本語表示名を検証する。
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { queryGiftHistory } from "./gift-history";

const STREAMER_TIKTOK_ID = "itest_gift_history_streamer";
let roomId: string;

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({ data: { tiktokId: STREAMER_TIKTOK_ID } });
  roomId = room.id;
});

afterAll(async () => {
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades TiktokRoom -> Gift
  await prisma.$disconnect();
});

async function makeGift(overrides: Partial<Prisma.GiftUncheckedCreateInput> = {}) {
  return prisma.gift.create({
    data: {
      roomId,
      uniqueId: "user_a",
      nickname: "ユーザーA",
      giftId: 1,
      giftName: "Rose",
      repeatCount: 1,
      diamondCount: 1,
      totalDiamonds: 1,
      dayKey: "2026-08-15",
      receivedAt: new Date("2026-08-15T10:00:00Z"),
      ...overrides,
    },
  });
}

// describeブロック同士で同じroomIdを共有するため、テストごとにdayKeyを変えて混ざらないようにする。
describe("queryGiftHistory", () => {
  it("limitちょうどならhasMore=false、超過があればtrueになる", async () => {
    const dayKey = "2026-08-17";
    await makeGift({ dayKey, receivedAt: new Date("2026-08-17T10:00:00Z") });
    await makeGift({ dayKey, receivedAt: new Date("2026-08-17T10:01:00Z") });
    await makeGift({ dayKey, receivedAt: new Date("2026-08-17T10:02:00Z") });

    const exact = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 3);
    expect(exact.events).toHaveLength(3);
    expect(exact.hasMore).toBe(false);

    const over = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 2);
    expect(over.events).toHaveLength(2);
    expect(over.hasMore).toBe(true);
  });

  it("dayKey範囲外のギフトは含まれない", async () => {
    const dayKey = "2026-08-19";
    const inRange = await makeGift({ dayKey, receivedAt: new Date("2026-08-19T10:00:00Z") });
    await makeGift({ dayKey: "2026-08-20", receivedAt: new Date("2026-08-20T10:00:00Z") });

    const result = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 10);

    expect(result.events.map((e) => e.id)).toEqual([inRange.id]);
  });

  it("listenerQueryはuniqueId/nicknameの部分一致(大小文字無視)で絞り込む", async () => {
    const dayKey = "2026-08-21";
    const taro = await makeGift({ dayKey, uniqueId: "Taro_Listener", nickname: "たろう", receivedAt: new Date("2026-08-21T10:00:00Z") });
    await makeGift({ dayKey, uniqueId: "hanako_listener", nickname: "花子", receivedAt: new Date("2026-08-21T10:01:00Z") });

    const byUniqueId = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 10, "taro");
    expect(byUniqueId.events.map((e) => e.id)).toEqual([taro.id]);
  });

  it("listenerQueryの%/_はSQLワイルドカードとして解釈させず、リテラル一致にする", async () => {
    const dayKey = "2026-08-22";
    const literal = await makeGift({ dayKey, uniqueId: "100%_off", nickname: "割引", receivedAt: new Date("2026-08-22T10:00:00Z") });
    await makeGift({ dayKey, uniqueId: "other_user", nickname: "別ユーザー", receivedAt: new Date("2026-08-22T10:01:00Z") });

    // "%"/"_"をワイルドカード展開すると"other_user"等の無関係な行まで拾ってしまう。
    const result = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 10, "100%_off");
    expect(result.events.map((e) => e.id)).toEqual([literal.id]);
  });

  it("listenerQueryは日時条件とAND結合される", async () => {
    const dayKey = "2026-08-23";
    const inRange = await makeGift({ dayKey, uniqueId: "and_target", nickname: "AND対象", receivedAt: new Date("2026-08-23T10:00:00Z") });
    await makeGift({ dayKey: "2026-08-24", uniqueId: "and_target", nickname: "AND対象", receivedAt: new Date("2026-08-24T10:00:00Z") });

    const result = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 10, "and_target");
    expect(result.events.map((e) => e.id)).toEqual([inRange.id]);
  });
});

// TiktokGiftCatalogはroomIdを持たないグローバルテーブルなので、他describeと衝突しないgiftIdを使う。
describe("queryGiftHistory - labelJa(日本語表示名)", () => {
  const CATALOG_GIFT_IDS = [900001, 900002];

  afterEach(async () => {
    await prisma.tiktokGiftCatalog.deleteMany({ where: { giftId: { in: CATALOG_GIFT_IDS } } });
  });

  it("カタログにlabelJaがあれば日本語名で返る", async () => {
    const dayKey = "2026-08-25";
    await prisma.tiktokGiftCatalog.create({
      data: { giftId: 900001, name: "rose", label: "Rose", labelJa: "バラ", diamondCount: 1 },
    });
    const gift = await makeGift({ dayKey, giftId: 900001, receivedAt: new Date("2026-08-25T10:00:00Z") });

    const result = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 10);

    expect(result.events.find((e) => e.id === gift.id)?.giftName).toBe("バラ");
  });

  it("カタログに無い/labelJaがnullのgiftIdは受信生データ(英語)のまま返る", async () => {
    const dayKey = "2026-08-25";
    const gift = await makeGift({ dayKey, giftId: 900002, receivedAt: new Date("2026-08-25T10:01:00Z") });

    const result = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 10);

    expect(result.events.find((e) => e.id === gift.id)?.giftName).toBe("Rose");
  });
});
