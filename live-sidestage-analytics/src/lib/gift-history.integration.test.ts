// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// GiftEditのDBスキーマ・オリジナルデータ非破壊・上書き表示の一連の流れを検証する。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { applyGiftEdit } from "./gift-history";

const STREAMER_TIKTOK_ID = "itest_gift_history_streamer";
let streamerId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `itest-gift-history-${Date.now()}@local.test` } });
  const streamer = await prisma.streamer.create({
    data: { userId: user.id, tiktokId: STREAMER_TIKTOK_ID, verificationCode: "x", verified: true },
  });
  streamerId = streamer.id;
});

afterAll(async () => {
  const streamer = await prisma.streamer.findUnique({ where: { tiktokId: STREAMER_TIKTOK_ID } });
  if (streamer) {
    await prisma.user.delete({ where: { id: streamer.userId } });
  }
  await prisma.$disconnect();
});

async function makeGift() {
  return prisma.gift.create({
    data: {
      streamerId,
      uniqueId: "user_a",
      nickname: "ユーザーA",
      giftId: 1,
      giftName: "Rose",
      repeatCount: 1,
      diamondCount: 1,
      totalDiamonds: 1,
      dayKey: "2026-08-15",
      receivedAt: new Date("2026-08-15T10:00:00Z"),
    },
  });
}

describe("GiftEdit", () => {
  it("編集を追加してもオリジナルのGiftレコードは変更されない", async () => {
    const gift = await makeGift();

    await prisma.giftEdit.create({
      data: { giftId: gift.id, giftName: "手動修正バラ", totalDiamonds: -50 },
    });

    const original = await prisma.gift.findUniqueOrThrow({ where: { id: gift.id } });
    expect(original.giftName).toBe("Rose");
    expect(original.totalDiamonds).toBe(1);
  });

  it("履歴クエリと同じロジック(applyGiftEdit)で取得すると編集後の値に上書きされる", async () => {
    const gift = await makeGift();
    await prisma.giftEdit.create({ data: { giftId: gift.id, giftName: "上書き後", totalDiamonds: 42 } });

    const row = await prisma.gift.findUniqueOrThrow({
      where: { id: gift.id },
      select: { id: true, giftName: true, totalDiamonds: true, edit: { select: { giftName: true, totalDiamonds: true } } },
    });
    const event = applyGiftEdit(row);

    expect(event.giftName).toBe("上書き後");
    expect(event.totalDiamonds).toBe(42);
    expect(event.edited).toBe(true);
  });

  it("編集の無いギフトはedited=falseでオリジナル値のまま返る", async () => {
    const gift = await makeGift();
    const row = await prisma.gift.findUniqueOrThrow({
      where: { id: gift.id },
      select: { id: true, giftName: true, totalDiamonds: true, edit: { select: { giftName: true, totalDiamonds: true } } },
    });
    const event = applyGiftEdit(row);

    expect(event.giftName).toBe("Rose");
    expect(event.edited).toBe(false);
  });

  it("同じgiftIdに対するupsertは行を増やさず上書きする", async () => {
    const gift = await makeGift();
    await prisma.giftEdit.upsert({
      where: { giftId: gift.id },
      create: { giftId: gift.id, giftName: "1回目", totalDiamonds: 1 },
      update: { giftName: "1回目", totalDiamonds: 1 },
    });
    await prisma.giftEdit.upsert({
      where: { giftId: gift.id },
      create: { giftId: gift.id, giftName: "2回目", totalDiamonds: 2 },
      update: { giftName: "2回目", totalDiamonds: 2 },
    });

    const edits = await prisma.giftEdit.findMany({ where: { giftId: gift.id } });
    expect(edits).toHaveLength(1);
    expect(edits[0].giftName).toBe("2回目");
  });

  it("Gift削除時にGiftEditもカスケード削除される", async () => {
    const gift = await makeGift();
    await prisma.giftEdit.create({ data: { giftId: gift.id, giftName: "X", totalDiamonds: 1 } });

    await prisma.gift.delete({ where: { id: gift.id } });

    const edit = await prisma.giftEdit.findUnique({ where: { giftId: gift.id } });
    expect(edit).toBeNull();
  });
});
