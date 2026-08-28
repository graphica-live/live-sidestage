// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// GiftEditのDBスキーマ・オリジナルデータ非破壊・上書き表示の一連の流れを検証する。
// ギフトデータは同じtiktokId(=同じTiktokRoom)を登録した全員で共有されるが、編集/非表示は
// streamerId単位で分離され、編集した本人にしか見えないことも検証する。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

  // 同じtiktokId(=同じroom)を登録した2人目のユーザー。編集/非表示の分離検証に使う。
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
      edits: { where: { streamerId: viewerStreamerId }, select: { giftName: true, totalDiamonds: true, hidden: true } },
    },
  });
  const edit = row.edits[0] ?? null;
  return {
    ...applyGiftEdit({ ...row, edit: edit ? { giftName: edit.giftName, totalDiamonds: edit.totalDiamonds } : null }),
    hidden: edit?.hidden ?? false,
  };
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

  it("非表示(hidden)にしても共有データ自体は消えず、他人の閲覧には影響しない", async () => {
    const gift = await makeGift();
    await prisma.giftEdit.create({
      data: { giftId: gift.id, streamerId, giftName: gift.giftName, totalDiamonds: gift.totalDiamonds, hidden: true },
    });

    const asHider = await readAsViewer(gift.id, streamerId);
    const asOther = await readAsViewer(gift.id, streamerId2);
    const original = await prisma.gift.findUniqueOrThrow({ where: { id: gift.id } });

    expect(asHider.hidden).toBe(true);
    expect(asOther.hidden).toBe(false);
    expect(original).not.toBeNull(); // 実データは削除されていない
  });
});

// 他のdescribeブロックと同じroomIdを共有するため、dayKeyを"2026-08-16"に固定して
// GiftEditテスト側が作る"2026-08-15"のギフトと混ざらないようにする。
describe("queryGiftHistory", () => {
  it("非表示(hidden)行はDBクエリ側で除外され、limitを消費しない", async () => {
    const g1 = await makeGift({ dayKey: "2026-08-16", receivedAt: new Date("2026-08-16T10:00:00Z"), totalDiamonds: 10 });
    const g2 = await makeGift({ dayKey: "2026-08-16", receivedAt: new Date("2026-08-16T10:01:00Z"), totalDiamonds: 20 });
    const g3 = await makeGift({ dayKey: "2026-08-16", receivedAt: new Date("2026-08-16T10:02:00Z"), totalDiamonds: 30 });
    await prisma.giftEdit.create({
      data: { giftId: g2.id, streamerId, giftName: g2.giftName, totalDiamonds: g2.totalDiamonds, hidden: true },
    });

    // limit=2だが非表示なのはg2だけなので、g1とg3の2件がちゃんと返る(g2がlimitを消費してg1しか返らない、では駄目)。
    const result = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: "2026-08-16", lte: "2026-08-16" } }, 2);

    expect(result.events.map((e) => e.id)).toEqual([g3.id, g1.id]); // receivedAt降順
    expect(result.hasMore).toBe(false);
    expect(result.total).toEqual({ count: 2, diamonds: 40 });
  });

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

  it("他のviewerの非表示設定は自分の閲覧結果に影響しない", async () => {
    const dayKey = "2026-08-18";
    const gift = await makeGift({ dayKey, receivedAt: new Date("2026-08-18T10:00:00Z") });
    await prisma.giftEdit.create({
      data: { giftId: gift.id, streamerId: streamerId2, giftName: gift.giftName, totalDiamonds: gift.totalDiamonds, hidden: true },
    });

    const asOwner = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: dayKey, lte: dayKey } }, 10);
    expect(asOwner.events.map((e) => e.id)).toContain(gift.id);
  });

  it("dayKey範囲外のギフトは含まれない", async () => {
    const dayKey = "2026-08-19";
    const inRange = await makeGift({ dayKey, receivedAt: new Date("2026-08-19T10:00:00Z") });
    await makeGift({ dayKey: "2026-08-20", receivedAt: new Date("2026-08-20T10:00:00Z") });

    const result = await queryGiftHistory(roomId, streamerId, { dayKey: { gte: dayKey, lte: dayKey } }, 10);

    expect(result.events.map((e) => e.id)).toEqual([inRange.id]);
  });
});
