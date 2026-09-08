// ローカルテストDB(.env.local.test / docker-compose.yml)が必要。
// `npm run test:integration` (内部でdotenv -e .env.local.testを付与)経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { queryGifts } from "./gift-analytics";
import { makeTiktokUid } from "./__fixtures__/gift";

const STREAMER_TIKTOK_ID = "itest_gift_analytics_streamer";
const HOST_TIKTOK_UID = makeTiktokUid("itest_gift_analytics_host");

// Gift は表示名の列を持たない。listenerQuery は TikTokUser を JOIN して引くので、
// 表示名で絞り込むテストは tiktok_users 行が要る。
const UID_A = makeTiktokUid("itest_gift_analytics_user_a");
const UID_B = makeTiktokUid("itest_gift_analytics_user_b");
const UID_C = makeTiktokUid("itest_gift_analytics_user_c");
const UID_TARO = makeTiktokUid("itest_gift_analytics_taro");
const UID_HANAKO = makeTiktokUid("itest_gift_analytics_hanako");
const UID_RENAMED = makeTiktokUid("itest_gift_analytics_renamed");
const ALL_UIDS = [UID_A, UID_B, UID_C, UID_TARO, UID_HANAKO, UID_RENAMED];

let streamerId: string;
let roomId: string;

type GiftOverrides = Partial<{
  tiktokUid: string;
  repeatCount: number;
  totalDiamonds: number;
  receivedAt: Date;
  dayKey: string;
}>;

async function makeGift(overrides: GiftOverrides) {
  return prisma.gift.create({
    data: {
      roomId,
      tiktokUid: UID_A,
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
  const room = await prisma.tiktokRoom.create({
    data: { tiktokHandle: STREAMER_TIKTOK_ID, hostTiktokUid: HOST_TIKTOK_UID },
  });
  roomId = room.id;
  const user = await prisma.user.create({ data: { email: `itest-gift-analytics-${Date.now()}@local.test` } });
  const streamer = await prisma.streamer.create({
    data: {
      principalId: user.id,
      tiktokUid: HOST_TIKTOK_UID,
      tiktokHandle: STREAMER_TIKTOK_ID,
      verificationCode: "x",
      verified: true,
      roomId,
    },
  });
  streamerId = streamer.id;

  await prisma.tikTokUser.createMany({
    data: [
      { tiktokUid: UID_A, tiktokHandle: "user_a", nickname: "ユーザーA" },
      { tiktokUid: UID_B, tiktokHandle: "user_b", nickname: "ユーザーB" },
      { tiktokUid: UID_C, tiktokHandle: "user_c", nickname: "ユーザーC" },
      { tiktokUid: UID_TARO, tiktokHandle: "Taro_Listener", nickname: "たろう" },
      { tiktokUid: UID_HANAKO, tiktokHandle: "hanako_listener", nickname: "花子" },
      // 改名後の現在値だけを持つ(TikTokUser は履歴を持たない)。
      { tiktokUid: UID_RENAMED, tiktokHandle: "rename_user", nickname: "新名前" },
    ],
    skipDuplicates: true,
  });
});

afterAll(async () => {
  const streamer = await prisma.streamer.findUnique({ where: { id: streamerId } });
  if (streamer) {
    await prisma.user.delete({ where: { id: streamer.principalId } }); // cascades User -> Streamer
  }
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades TiktokRoom -> Gift
  await prisma.tikTokUser.deleteMany({ where: { tiktokUid: { in: ALL_UIDS } } }).catch(() => {});
  await prisma.$disconnect();
});

describe("queryGifts", () => {
  it("同一ユーザーの複数ギフトをコイン数・件数で集計する", async () => {
    await makeGift({ tiktokUid: UID_A, repeatCount: 2, totalDiamonds: 20, receivedAt: new Date("2026-08-15T09:00:00Z") });
    await makeGift({ tiktokUid: UID_A, repeatCount: 3, totalDiamonds: 30, receivedAt: new Date("2026-08-15T11:00:00Z") });
    await makeGift({ tiktokUid: UID_B, repeatCount: 1, totalDiamonds: 5, receivedAt: new Date("2026-08-15T10:30:00Z") });

    const { users, total } = await queryGifts(roomId, streamerId, { dayKey: { gte: "2026-08-15", lte: "2026-08-15" } });

    const userA = users.find((u) => u.tiktokUid === UID_A);
    expect(userA).toBeDefined();
    expect(userA!.giftCount).toBe(5); // 2 + 3
    expect(userA!.totalDiamonds).toBe(50); // 20 + 30
    expect(userA!.lastGiftAt).toBe(new Date("2026-08-15T11:00:00Z").toISOString());
    // 表示名は Gift ではなく TikTokUser から順引きした現在値。
    expect(userA!.tiktokHandle).toBe("user_a");
    expect(userA!.nickname).toBe("ユーザーA");

    const userB = users.find((u) => u.tiktokUid === UID_B);
    expect(userB!.totalDiamonds).toBe(5);

    expect(total.giftCount).toBe(6);
    expect(total.totalDiamonds).toBe(55);
  });

  it("dayKey範囲外のギフトは集計に含めない", async () => {
    await makeGift({ tiktokUid: UID_C, dayKey: "2026-08-01", receivedAt: new Date("2026-08-01T00:00:00Z"), totalDiamonds: 999 });

    const { users } = await queryGifts(roomId, streamerId, { dayKey: { gte: "2026-08-15", lte: "2026-08-15" } });
    expect(users.find((u) => u.tiktokUid === UID_C)).toBeUndefined();
  });

  it("該当ギフトが無ければ空配列とゼロ集計を返す", async () => {
    const result = await queryGifts(roomId, streamerId, { dayKey: { gte: "1999-01-01", lte: "1999-01-01" } });
    expect(result).toEqual({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
  });


  it("listenerQueryはTikTokUserのtiktokHandle/nicknameの部分一致(大小文字無視)で絞り込む", async () => {
    await makeGift({ tiktokUid: UID_TARO, totalDiamonds: 10, receivedAt: new Date("2026-08-15T09:20:00Z") });
    await makeGift({ tiktokUid: UID_HANAKO, totalDiamonds: 20, receivedAt: new Date("2026-08-15T09:21:00Z") });

    const byTiktokHandle = await queryGifts(
      roomId,
      streamerId,
      { dayKey: { gte: "2026-08-15", lte: "2026-08-15" } },
      "taro"
    );
    expect(byTiktokHandle.users.map((u) => u.tiktokUid)).toEqual([UID_TARO]);
    expect(byTiktokHandle.users.map((u) => u.tiktokHandle)).toEqual(["Taro_Listener"]);

    const byNickname = await queryGifts(
      roomId,
      streamerId,
      { dayKey: { gte: "2026-08-15", lte: "2026-08-15" } },
      "花子"
    );
    expect(byNickname.users.map((u) => u.tiktokUid)).toEqual([UID_HANAKO]);
  });

  it("listenerQuery指定時、期間中に表示名が変わっていても過少集計にならない(tiktokUid一致で全期間ぶんを集計する)", async () => {
    // 「旧名前」で受けたギフトと「新名前」で受けたギフト。Gift は表示名を持たないので
    // どちらも同じ tiktokUid の行にしかならず、TikTokUser は現在値(新名前)だけを持つ。
    await makeGift({
      tiktokUid: UID_RENAMED,
      totalDiamonds: 100,
      receivedAt: new Date("2026-08-15T09:30:00Z"),
    });
    await makeGift({
      tiktokUid: UID_RENAMED,
      totalDiamonds: 200,
      receivedAt: new Date("2026-08-15T09:31:00Z"),
    });

    const result = await queryGifts(
      roomId,
      streamerId,
      { dayKey: { gte: "2026-08-15", lte: "2026-08-15" } },
      "新名前"
    );

    const user = result.users.find((u) => u.tiktokUid === UID_RENAMED);
    expect(user).toBeDefined();
    expect(user!.totalDiamonds).toBe(300); // 旧名前ぶんの100を取りこぼさない
  });

  it("listenerQueryに一致するユーザーが居なければ空配列を返す", async () => {
    const result = await queryGifts(
      roomId,
      streamerId,
      { dayKey: { gte: "2026-08-15", lte: "2026-08-15" } },
      "nonexistent_listener_xyz"
    );
    expect(result).toEqual({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
  });
});
