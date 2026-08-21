// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// モバイルの「ギフトを選ぶ」ピッカーへ返す候補一覧を検証する。
//
// 一致キーの正規化(trim + 小文字化)が socket.io の chat:gift と揃っていないと、
// ピッカーで選んだギフト名が実際のイベントと永久に一致しなくなる。ここが要点。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_gifts";

let userId: string;
let streamerId: string;
let roomId: string;
let otherUserId: string;
let token: string;
let otherToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-gifts-secret";

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({ data: { tiktokId: TIKTOK_ID } });
  roomId = room.id;

  const user = await prisma.user.create({ data: { email: `itest-mobile-gifts-${Date.now()}@local.test` } });
  userId = user.id;
  const streamer = await prisma.streamer.create({
    data: { userId, tiktokId: TIKTOK_ID, verificationCode: "x", verified: true, roomId },
  });
  streamerId = streamer.id;
  token = signMobileToken({ userId, streamerId });

  // Streamerを持たないユーザー。404になることの確認用。
  const other = await prisma.user.create({
    data: { email: `itest-mobile-gifts-other-${Date.now()}@local.test` },
  });
  otherUserId = other.id;
  otherToken = signMobileToken({ userId: otherUserId });
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: otherUserId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> Gift
  await prisma.$disconnect();
});

let orderSeq = 0;

async function addGift(giftName: string, diamondCount: number, receivedAt: Date) {
  orderSeq++;
  return prisma.gift.create({
    data: {
      roomId,
      uniqueId: "user_a",
      nickname: "ユーザーA",
      giftId: 1,
      giftName,
      repeatCount: 1,
      diamondCount,
      totalDiamonds: diamondCount,
      dayKey: "2026-08-20",
      orderId: `itest-mobile-gifts-${orderSeq}`,
      receivedAt,
    },
  });
}

function request(bearer?: string) {
  return new NextRequest("http://localhost/api/mobile/gifts", {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

async function fetchGifts(bearer?: string) {
  const res = await GET(request(bearer));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/mobile/gifts", () => {
  it("トークンが無ければ401", async () => {
    const { status } = await fetchGifts();
    expect(status).toBe(401);
  });

  it("Streamer未登録なら404", async () => {
    const { status } = await fetchGifts(otherToken);
    expect(status).toBe(404);
  });

  it("ギフト履歴が無ければ空配列", async () => {
    const { status, body } = await fetchGifts(token);
    expect(status).toBe(200);
    expect(body.gifts).toEqual([]);
  });

  it("大文字小文字・前後空白の違いを1件に畳む", async () => {
    await addGift("Rose", 1, new Date("2026-08-20T10:00:00Z"));
    await addGift("rose", 1, new Date("2026-08-20T10:01:00Z"));
    await addGift("  Rose  ", 1, new Date("2026-08-20T10:02:00Z"));

    const { body } = await fetchGifts(token);
    expect(body.gifts).toHaveLength(1);
    expect(body.gifts[0].name).toBe("rose");
  });

  it("表示用ラベルは最新行の元表記を使う", async () => {
    // 直前のテストで最新は "  Rose  "(2026-08-20T10:02:00Z)。trimだけして返す。
    const { body } = await fetchGifts(token);
    expect(body.gifts[0].label).toBe("Rose");
  });

  it("複数種類を新しい順に返す", async () => {
    await addGift("Galaxy", 1000, new Date("2026-08-20T11:00:00Z"));

    const { body } = await fetchGifts(token);
    expect(body.gifts.map((g: { name: string }) => g.name)).toEqual(["galaxy", "rose"]);
    expect(body.gifts[0].diamondCount).toBe(1000);
  });

  it("空のギフト名は候補に出さない", async () => {
    await addGift("   ", 1, new Date("2026-08-20T12:00:00Z"));

    const { body } = await fetchGifts(token);
    expect(body.gifts.map((g: { name: string }) => g.name)).toEqual(["galaxy", "rose"]);
  });

  it("GiftEditによるリネームは反映しない(TikTokが送る名前ではないため)", async () => {
    const gift = await addGift("TikTokName", 5, new Date("2026-08-20T13:00:00Z"));
    await prisma.giftEdit.create({
      data: { giftId: gift.id, streamerId, giftName: "手動でつけた名前", totalDiamonds: 5 },
    });

    const { body } = await fetchGifts(token);
    const names = body.gifts.map((g: { name: string }) => g.name);
    expect(names).toContain("tiktokname");
    expect(names).not.toContain("手動でつけた名前");
  });
});
