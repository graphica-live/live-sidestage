// ローカルテストDB専用のシードスクリプト。`npm run seed:local` で実行する。
// Railwayの共有DBには一切触れない(.env.local.testのDATABASE_URLのみを使う)。
import { prisma } from "../src/lib/prisma";

const DEV_EMAIL = "dev@local.test";

function jstDateKey(date: Date): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

const SAMPLE_GIFTS = [
  { giftName: "Rose", giftId: 5655, diamondCount: 1 },
  { giftName: "TikTok", giftId: 6247, diamondCount: 1 },
  { giftName: "GG", giftId: 6432, diamondCount: 1 },
  { giftName: "Perfume", giftId: 8913, diamondCount: 20 },
  { giftName: "Ice Cream Cone", giftId: 5827, diamondCount: 5 },
  { giftName: "Corgi", giftId: 6247, diamondCount: 199 },
  { giftName: "Lion", giftId: 5837, diamondCount: 500 },
  { giftName: "Universe", giftId: 6478, diamondCount: 34999 },
];

// tiktokUid は TikTok の不変な数値ID。表示名は TikTokUser 側にだけ持たせる。
const SAMPLE_USERS = [
  { tiktokUid: "7000000000000000101", tiktokHandle: "test_user_1", nickname: "テストユーザー1" },
  { tiktokUid: "7000000000000000102", tiktokHandle: "test_user_2", nickname: "テストユーザー2" },
  { tiktokUid: "7000000000000000103", tiktokHandle: "test_user_3", nickname: "テストユーザー3" },
];

const SELF_HOST = {
  tiktokUid: "7000000000000000001",
  tiktokHandle: "local_test_streamer",
  nickname: "ローカル配信者",
};

async function main() {
  const user = await prisma.user.upsert({
    where: { email: DEV_EMAIL },
    update: {},
    create: { email: DEV_EMAIL, name: "Dev Local" },
  });

  // TikTokUser 行が無いと表示名がすべて null になり、ローカルでの目視確認が機能しない。
  for (const u of [SELF_HOST, ...SAMPLE_USERS]) {
    await prisma.tikTokUser.upsert({
      where: { tiktokUid: u.tiktokUid },
      update: { tiktokHandle: u.tiktokHandle, nickname: u.nickname },
      create: u,
    });
  }

  const room = await prisma.tiktokRoom.upsert({
    where: { hostTiktokUid: SELF_HOST.tiktokUid },
    update: {},
    create: { hostTiktokUid: SELF_HOST.tiktokUid, tiktokHandle: SELF_HOST.tiktokHandle },
  });

  const streamer = await prisma.streamer.upsert({
    where: { principalId: user.id },
    update: { verified: true, roomId: room.id },
    create: {
      principalId: user.id,
      tiktokUid: SELF_HOST.tiktokUid,
      tiktokHandle: SELF_HOST.tiktokHandle,
      verificationCode: "seeded",
      verified: true,
      verifiedAt: new Date(),
      roomId: room.id,
    },
  });

  await prisma.gift.deleteMany({ where: { roomId: room.id } });

  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const gift = SAMPLE_GIFTS[i % SAMPLE_GIFTS.length];
    const sender = SAMPLE_USERS[i % SAMPLE_USERS.length];
    const repeatCount = 1 + (i % 5);
    const receivedAt = new Date(now - i * 6 * 60_000); // 6分おきに過去へ
    rows.push({
      roomId: room.id,
      tiktokUid: sender.tiktokUid,
      giftId: gift.giftId,
      giftName: gift.giftName,
      giftPictureUrl: null,
      repeatCount,
      diamondCount: gift.diamondCount,
      totalDiamonds: gift.diamondCount * repeatCount,
      receivedAt,
      dayKey: jstDateKey(receivedAt),
      orderId: `local-seed-${i}`,
    });
  }

  await prisma.gift.createMany({ data: rows });

  console.log(`シード完了: streamerId=${streamer.id} / ${DEV_EMAIL} / gift件数=${rows.length}`);
  console.log(`ログイン方法: /login の「開発用ログイン」に ${DEV_EMAIL} を入力`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
