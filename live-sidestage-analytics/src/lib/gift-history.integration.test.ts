// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// GiftEditのDBスキーマ・オリジナルデータ非破壊・上書き表示の一連の流れを検証する。
// ギフトデータは同じtiktokId(=同じTiktokRoom)を登録した全員で共有されるが、編集は
// streamerId単位で分離され、編集した本人にしか見えないことも検証する。
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { applyGiftEdit, queryGiftHistory } from "./gift-history";

const STREAMER_TIKTOK_ID = "itest_gift_history_streamer";
let streamerId: string;
let streamerId2: string;
let roomId: string;

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({ data: { tiktokId: STREAMER_TIKTOK_ID } });
  roomId = room.id;

  const user = await prisma.user.create({ data: { email: `itest-gift-history-${Date.now()}@local.test` } });
  const streamer = await prisma.streamer.create({
    data: { userId: user.id, tiktokId: STREAMER_TIKTOK_ID, verificationCode: "x", verified: true, roomId },
  });
  streamerId = streamer.id;

  // 同じtiktokId(=同じroom)を登録した2人目のユーザー。編集の分離検証に使う。
  const user2 = await prisma.user.create({ data: { email: `itest-gift-history-2-${Date.now()}@local.test` } });
  const streamer2 = await prisma.streamer.create({
    data: { userId: user2.id, tiktokId: STREAMER_TIKTOK_ID, verificationCode: "x", verified: true, roomId },
  });
  streamerId2 = streamer2.id;
});

afterAll(async () => {
  for (const id of [streamerId, streamerId2]) {
    const streamer = await prisma.streamer.findUnique({ where: { id } });
    if (streamer) {
      await prisma.user.delete({ where: { id: streamer.userId } });
    }
  }
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

// history APIルートと同じ「自分のstreamerId分だけeditsを絞り込んでapplyGiftEditへ渡す」パターン。
async function readAsViewer(giftId: string, viewerStreamerId: string) {
  const row = await prisma.gift.findUniqueOrThrow({
    where: { id: giftId },
    select: {
      id: true,
      giftName: true,
      totalDiamonds: true,
      edits: { where: { streamerId: viewerStreamerId }, select: { giftName: true, totalDiamonds: true } },
    },
  });
  const edit = row.edits[0] ?? null;
  return applyGiftEdit({ ...row, edit: edit ? { giftName: edit.giftName, totalDiamonds: edit.totalDiamonds } : null });
}

describe("GiftEdit", () => {
  it("編集を追加してもオリジナルのGiftレコードは変更されない", async () => {
    const gift = await makeGift();

    await prisma.giftEdit.create({
      data: { giftId: gift.id, streamerId, giftName: "手動修正バラ", totalDiamonds: -50 },
    });

    const original = await prisma.gift.findUniqueOrThrow({ where: { id: gift.id } });
    expect(original.giftName).toBe("Rose");
    expect(original.totalDiamonds).toBe(1);
  });

  it("履歴クエリと同じロジック(applyGiftEdit)で取得すると編集後の値に上書きされる", async () => {
    const gift = await makeGift();
    await prisma.giftEdit.create({ data: { giftId: gift.id, streamerId, giftName: "上書き後", totalDiamonds: 42 } });

    const event = await readAsViewer(gift.id, streamerId);

    expect(event.giftName).toBe("上書き後");
    expect(event.totalDiamonds).toBe(42);
    expect(event.edited).toBe(true);
  });

  it("編集の無いギフトはedited=falseでオリジナル値のまま返る", async () => {
    const gift = await makeGift();
    const event = await readAsViewer(gift.id, streamerId);

    expect(event.giftName).toBe("Rose");
    expect(event.edited).toBe(false);
  });

  it("同じ(giftId, streamerId)に対するupsertは行を増やさず上書きする", async () => {
    const gift = await makeGift();
    await prisma.giftEdit.upsert({
      where: { giftId_streamerId: { giftId: gift.id, streamerId } },
      create: { giftId: gift.id, streamerId, giftName: "1回目", totalDiamonds: 1 },
      update: { giftName: "1回目", totalDiamonds: 1 },
    });
    await prisma.giftEdit.upsert({
      where: { giftId_streamerId: { giftId: gift.id, streamerId } },
      create: { giftId: gift.id, streamerId, giftName: "2回目", totalDiamonds: 2 },
      update: { giftName: "2回目", totalDiamonds: 2 },
    });

    const edits = await prisma.giftEdit.findMany({ where: { giftId: gift.id, streamerId } });
    expect(edits).toHaveLength(1);
    expect(edits[0].giftName).toBe("2回目");
  });

  it("Gift削除時にGiftEditもカスケード削除される", async () => {
    const gift = await makeGift();
    await prisma.giftEdit.create({ data: { giftId: gift.id, streamerId, giftName: "X", totalDiamonds: 1 } });

    await prisma.gift.delete({ where: { id: gift.id } });

    const edits = await prisma.giftEdit.findMany({ where: { giftId: gift.id } });
    expect(edits).toHaveLength(0);
  });

  it("同じ共有ギフトでも編集は登録者ごとに分離され、他人には見えない", async () => {
    const gift = await makeGift();
    await prisma.giftEdit.create({
      data: { giftId: gift.id, streamerId, giftName: "Aさんの編集", totalDiamonds: 100 },
    });

    const asEditor = await readAsViewer(gift.id, streamerId);
    const asOther = await readAsViewer(gift.id, streamerId2);

    expect(asEditor.giftName).toBe("Aさんの編集");
    expect(asEditor.edited).toBe(true);
    expect(asOther.giftName).toBe("Rose"); // 編集していない側にはオリジナルのまま見える
    expect(asOther.edited).toBe(false);
  });
});

// 他のdescribeブロックと同じroomIdを共有するため、dayKeyを"2026-08-16"に固定して
// GiftEditテスト側が作る"2026-08-15"のギフトと混ざらないようにする。
describe("queryGiftHistory", () => {
  it("limitちょうどならhasMore=false、超過があればtrueになる", async () => {
    const dayKey = "2026-08-17";
    await makeGift({ dayKey, receivedAt: new Date("2026-08-17T10:00:00Z") });
    await makeGift({ dayKey, receivedAt: new Date("2026-08-17T10:01:00Z") });
    await makeGift({ dayKey, receivedAt: new Date("2026-08-17T10:02:00Z") });

    const exact = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: dayKey, lte: dayKey } }, 3);
    expect(exact.events).toHaveLength(3);
    expect(exact.hasMore).toBe(false);

    const over = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: dayKey, lte: dayKey } }, 2);
    expect(over.events).toHaveLength(2);
    expect(over.hasMore).toBe(true);
  });

  it("dayKey範囲外のギフトは含まれない", async () => {
    const dayKey = "2026-08-19";
    const inRange = await makeGift({ dayKey, receivedAt: new Date("2026-08-19T10:00:00Z") });
    await makeGift({ dayKey: "2026-08-20", receivedAt: new Date("2026-08-20T10:00:00Z") });

    const result = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: dayKey, lte: dayKey } }, 10);

    expect(result.events.map((e) => e.id)).toEqual([inRange.id]);
  });

  it("listenerQueryはuniqueId/nicknameの部分一致(大小文字無視)で絞り込む", async () => {
    const dayKey = "2026-08-21";
    const taro = await makeGift({ dayKey, uniqueId: "Taro_Listener", nickname: "たろう", receivedAt: new Date("2026-08-21T10:00:00Z") });
    await makeGift({ dayKey, uniqueId: "hanako_listener", nickname: "花子", receivedAt: new Date("2026-08-21T10:01:00Z") });

    const byUniqueId = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: dayKey, lte: dayKey } }, 10, "taro");
    expect(byUniqueId.events.map((e) => e.id)).toEqual([taro.id]);
  });

  it("listenerQueryの%/_はSQLワイルドカードとして解釈させず、リテラル一致にする", async () => {
    const dayKey = "2026-08-22";
    const literal = await makeGift({ dayKey, uniqueId: "100%_off", nickname: "割引", receivedAt: new Date("2026-08-22T10:00:00Z") });
    await makeGift({ dayKey, uniqueId: "other_user", nickname: "別ユーザー", receivedAt: new Date("2026-08-22T10:01:00Z") });

    // "%"/"_"をワイルドカード展開すると"other_user"等の無関係な行まで拾ってしまう。
    const result = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: dayKey, lte: dayKey } }, 10, "100%_off");
    expect(result.events.map((e) => e.id)).toEqual([literal.id]);
  });

  it("listenerQueryは日時条件とAND結合される", async () => {
    const dayKey = "2026-08-23";
    const inRange = await makeGift({ dayKey, uniqueId: "and_target", nickname: "AND対象", receivedAt: new Date("2026-08-23T10:00:00Z") });
    await makeGift({ dayKey: "2026-08-24", uniqueId: "and_target", nickname: "AND対象", receivedAt: new Date("2026-08-24T10:00:00Z") });

    const result = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: dayKey, lte: dayKey } }, 10, "and_target");
    expect(result.events.map((e) => e.id)).toEqual([inRange.id]);
  });
});

// TiktokGiftCatalogはroomIdを持たないグローバルテーブルなので、他describeと衝突しないgiftIdを使う。
describe("queryGiftHistory - labelJa(日本語表示名)", () => {
  const CATALOG_GIFT_IDS = [900001, 900002, 900003];

  afterEach(async () => {
    await prisma.tiktokGiftCatalog.deleteMany({ where: { giftId: { in: CATALOG_GIFT_IDS } } });
  });

  it("カタログにlabelJaがあれば日本語名で返る", async () => {
    const dayKey = "2026-08-25";
    await prisma.tiktokGiftCatalog.create({
      data: { giftId: 900001, name: "rose", label: "Rose", labelJa: "バラ", diamondCount: 1 },
    });
    const gift = await makeGift({ dayKey, giftId: 900001, receivedAt: new Date("2026-08-25T10:00:00Z") });

    const result = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: dayKey, lte: dayKey } }, 10);

    expect(result.events.find((e) => e.id === gift.id)?.giftName).toBe("バラ");
  });

  it("カタログに無い/labelJaがnullのgiftIdは受信生データ(英語)のまま返る", async () => {
    const dayKey = "2026-08-25";
    const gift = await makeGift({ dayKey, giftId: 900002, receivedAt: new Date("2026-08-25T10:01:00Z") });

    const result = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: dayKey, lte: dayKey } }, 10);

    expect(result.events.find((e) => e.id === gift.id)?.giftName).toBe("Rose");
  });

  it("GiftEditの手動編集はlabelJaより優先される", async () => {
    const dayKey = "2026-08-25";
    await prisma.tiktokGiftCatalog.create({
      data: { giftId: 900003, name: "rose3", label: "Rose3", labelJa: "バラ3", diamondCount: 1 },
    });
    const gift = await makeGift({ dayKey, giftId: 900003, receivedAt: new Date("2026-08-25T10:02:00Z") });
    await prisma.giftEdit.create({
      data: { giftId: gift.id, streamerId, giftName: "手動リネーム", totalDiamonds: gift.totalDiamonds },
    });

    const result = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: dayKey, lte: dayKey } }, 10);

    expect(result.events.find((e) => e.id === gift.id)?.giftName).toBe("手動リネーム");
  });
});
