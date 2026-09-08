// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// ギフト履歴一覧クエリ(queryGiftHistory)のページング・絞り込み・日本語表示名を検証する。
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { queryGiftHistory } from "./gift-history";
import { makeTiktokUid } from "./__fixtures__/gift";

const STREAMER_TIKTOK_ID = "itest_gift_history_streamer";
const HOST_TIKTOK_UID = makeTiktokUid("itest_gift_history_host");

// Gift は表示名の列を持たない。listenerQuery(ハンドル/ニックネームの部分一致)は
// TikTokUser 側を引いて tiktokUid の集合へ落とすので、表示名を見るテストは
// tiktok_users 行を先に用意する必要がある。
const UID_DEFAULT = makeTiktokUid("itest_gift_history_user_a");
const UID_TARO = makeTiktokUid("itest_gift_history_taro");
const UID_HANAKO = makeTiktokUid("itest_gift_history_hanako");
const UID_LITERAL = makeTiktokUid("itest_gift_history_literal");
const UID_OTHER = makeTiktokUid("itest_gift_history_other");
const UID_AND = makeTiktokUid("itest_gift_history_and");
const ALL_UIDS = [UID_DEFAULT, UID_TARO, UID_HANAKO, UID_LITERAL, UID_OTHER, UID_AND];

let roomId: string;

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({
    data: { tiktokHandle: STREAMER_TIKTOK_ID, hostTiktokUid: HOST_TIKTOK_UID },
  });
  roomId = room.id;

  // tiktok_users は room を持たないグローバルテーブルなので、このファイル専用の uid だけを作る。
  await prisma.tikTokUser.createMany({
    data: [
      { tiktokUid: UID_DEFAULT, tiktokHandle: "user_a", nickname: "ユーザーA" },
      { tiktokUid: UID_TARO, tiktokHandle: "Taro_Listener", nickname: "たろう" },
      { tiktokUid: UID_HANAKO, tiktokHandle: "hanako_listener", nickname: "花子" },
      { tiktokUid: UID_LITERAL, tiktokHandle: "100%_off", nickname: "割引" },
      { tiktokUid: UID_OTHER, tiktokHandle: "other_user", nickname: "別ユーザー" },
      { tiktokUid: UID_AND, tiktokHandle: "and_target", nickname: "AND対象" },
    ],
    skipDuplicates: true,
  });
});

afterAll(async () => {
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades TiktokRoom -> Gift
  await prisma.tikTokUser.deleteMany({ where: { tiktokUid: { in: ALL_UIDS } } }).catch(() => {});
  await prisma.$disconnect();
});

async function makeGift(overrides: Partial<Prisma.GiftUncheckedCreateInput> = {}) {
  return prisma.gift.create({
    data: {
      roomId,
      tiktokUid: UID_DEFAULT,
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

  it("listenerQueryはTikTokUserのtiktokHandle/nicknameの部分一致(大小文字無視)で絞り込む", async () => {
    const dayKey = "2026-08-21";
    const taro = await makeGift({ dayKey, tiktokUid: UID_TARO, receivedAt: new Date("2026-08-21T10:00:00Z") });
    await makeGift({ dayKey, tiktokUid: UID_HANAKO, receivedAt: new Date("2026-08-21T10:01:00Z") });

    const byTiktokHandle = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 10, "taro");
    expect(byTiktokHandle.events.map((e) => e.id)).toEqual([taro.id]);
    // 表示名は Gift ではなく TikTokUser から順引きした現在値。
    expect(byTiktokHandle.events[0].tiktokHandle).toBe("Taro_Listener");
    expect(byTiktokHandle.events[0].nickname).toBe("たろう");

    const byNickname = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 10, "花子");
    expect(byNickname.events.map((e) => e.tiktokUid)).toEqual([UID_HANAKO]);
  });

  it("TikTokUser行が無いtiktokUidは表示名がnullで返る(絞り込みにも掛からない)", async () => {
    const dayKey = "2026-08-26";
    const unknownUid = makeTiktokUid("itest_gift_history_unknown");
    const gift = await makeGift({ dayKey, tiktokUid: unknownUid, receivedAt: new Date("2026-08-26T10:00:00Z") });

    const result = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 10);
    const found = result.events.find((e) => e.id === gift.id)!;
    expect(found.tiktokHandle).toBeNull();
    expect(found.nickname).toBeNull();

    const filtered = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 10, "unknown");
    expect(filtered.events).toEqual([]);
  });

  it("listenerQueryの%/_はSQLワイルドカードとして解釈させず、リテラル一致にする", async () => {
    const dayKey = "2026-08-22";
    const literal = await makeGift({ dayKey, tiktokUid: UID_LITERAL, receivedAt: new Date("2026-08-22T10:00:00Z") });
    await makeGift({ dayKey, tiktokUid: UID_OTHER, receivedAt: new Date("2026-08-22T10:01:00Z") });

    // "%"/"_"をワイルドカード展開すると"other_user"等の無関係な行まで拾ってしまう。
    const result = await queryGiftHistory(roomId, { dayKey: { gte: dayKey, lte: dayKey } }, 10, "100%_off");
    expect(result.events.map((e) => e.id)).toEqual([literal.id]);
  });

  it("listenerQueryは日時条件とAND結合される", async () => {
    const dayKey = "2026-08-23";
    const inRange = await makeGift({ dayKey, tiktokUid: UID_AND, receivedAt: new Date("2026-08-23T10:00:00Z") });
    await makeGift({ dayKey: "2026-08-24", tiktokUid: UID_AND, receivedAt: new Date("2026-08-24T10:00:00Z") });

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
