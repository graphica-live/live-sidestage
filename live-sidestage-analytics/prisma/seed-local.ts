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

const SAMPLE_USERS = [
  { uniqueId: "test_user_1", nickname: "テストユーザー1" },
  { uniqueId: "test_user_2", nickname: "テストユーザー2" },
  { uniqueId: "test_user_3", nickname: "テストユーザー3" },
];

async function main() {
  const user = await prisma.user.upsert({
    where: { email: DEV_EMAIL },
    update: {},
    create: { email: DEV_EMAIL, name: "Dev Local" },
  });

  const streamer = await prisma.streamer.upsert({
    where: { userId: user.id },
    update: { verified: true },
    create: {
      userId: user.id,
      tiktokId: "local_test_streamer",
      verificationCode: "seeded",
      verified: true,
      verifiedAt: new Date(),
    },
  });

  await prisma.gift.deleteMany({ where: { streamerId: streamer.id } });

  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const gift = SAMPLE_GIFTS[i % SAMPLE_GIFTS.length];
    const sender = SAMPLE_USERS[i % SAMPLE_USERS.length];
    const repeatCount = 1 + (i % 5);
    const receivedAt = new Date(now - i * 6 * 60_000); // 6分おきに過去へ
    rows.push({
      streamerId: streamer.id,
      uniqueId: sender.uniqueId,
      nickname: sender.nickname,
      profileImageUrl: null,
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
