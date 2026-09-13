// App Store 審査用のメール認証アカウントと、貢献/ギフト/バトル履歴の見本データ。
// 審査完了後は `--purge --apply` でこのスクリプトが作った行だけを消す。
//
// ローカル:
//   npm run seed:ios-review:local            # dry-run
//   npm run seed:ios-review:local -- --apply
//   npm run seed:ios-review:local -- --purge --apply
//
// 本番: DATABASE_URL を本番に向けて(または `railway run`) npx tsx で実行する。
// TikTok 上に実在しないハンドルなので、Worker が接続しないよう handleStaleAt を立てる。
// 審査官ログインで monitoringSuspended が戻っても、handleStaleAt 中は getMyRooms() から外れる。
import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";
import { jstDateKey } from "../src/lib/overlay/day-key";
import { BATTLE_ACTION, type HostProfiles } from "../src/lib/tiktok-battle";

export const IOS_REVIEW_EMAIL = "appletest@livesidestage.com";
/** App Review notes に書くパスワード。公開登録APIの下限(8文字)より短いが、ログイン側はハッシュ照合のみ。 */
export const IOS_REVIEW_PASSWORD = "test";
export const IOS_REVIEW_HANDLE = "apple_review_sidestage";
export const IOS_REVIEW_HOST_UID = "8800000000000000001";
export const IOS_REVIEW_RIVAL_HANDLE = "apple_review_rival";
export const IOS_REVIEW_RIVAL_UID = "8800000000000000002";
export const IOS_REVIEW_BATTLE_ID = "ios-review-1v1";
export const IOS_REVIEW_GIFT_ORDER_PREFIX = "ios-review-";

const FANS = [
  { tiktokUid: "8800000000000000101", tiktokHandle: "apple_review_fan_1", nickname: "さくら" },
  { tiktokUid: "8800000000000000102", tiktokHandle: "apple_review_fan_2", nickname: "けん" },
  { tiktokUid: "8800000000000000103", tiktokHandle: "apple_review_fan_3", nickname: "みかん" },
] as const;

const SAMPLE_GIFTS = [
  { giftName: "Rose", giftId: 5655, diamondCount: 1 },
  { giftName: "TikTok", giftId: 6247, diamondCount: 1 },
  { giftName: "Perfume", giftId: 8913, diamondCount: 20 },
  { giftName: "Ice Cream Cone", giftId: 5827, diamondCount: 5 },
  { giftName: "Lion", giftId: 5837, diamondCount: 299 },
] as const;

export type IosReviewSeedResult = {
  principalId: string;
  streamerId: string;
  roomId: string;
  rivalRoomId: string;
  giftCount: number;
};

async function upsertTikTokUser(row: { tiktokUid: string; tiktokHandle: string; nickname: string }) {
  await prisma.tikTokUser.upsert({
    where: { tiktokUid: row.tiktokUid },
    update: { tiktokHandle: row.tiktokHandle, nickname: row.nickname },
    create: row,
  });
}

async function upsertIsolatedRoom(hostTiktokUid: string, tiktokHandle: string) {
  return prisma.tiktokRoom.upsert({
    where: { hostTiktokUid },
    update: {
      tiktokHandle,
      monitoringSuspended: true,
      handleStaleAt: new Date(),
      specialWatch: false,
    },
    create: {
      hostTiktokUid,
      tiktokHandle,
      monitoringSuspended: true,
      handleStaleAt: new Date(),
    },
  });
}

async function clearSeededObservation(roomIds: string[]) {
  await prisma.tiktokBattleArmiesSnapshot.deleteMany({
    where: { roomId: { in: roomIds }, battleId: { startsWith: "ios-review-" } },
  });
  await prisma.tiktokBattleItemUse.deleteMany({
    where: { roomId: { in: roomIds }, battleId: { startsWith: "ios-review-" } },
  });
  await prisma.tiktokBattleBonusMission.deleteMany({
    where: { roomId: { in: roomIds }, battleId: { startsWith: "ios-review-" } },
  });
  await prisma.tiktokBattleTapPoint.deleteMany({
    where: { roomId: { in: roomIds }, battleId: { startsWith: "ios-review-" } },
  });
  await prisma.battleHistory.deleteMany({
    where: { roomId: { in: roomIds }, battleId: { startsWith: "ios-review-" } },
  });
  await prisma.tiktokBattle.deleteMany({
    where: { roomId: { in: roomIds }, battleId: { startsWith: "ios-review-" } },
  });
  await prisma.gift.deleteMany({
    where: { roomId: { in: roomIds }, orderId: { startsWith: IOS_REVIEW_GIFT_ORDER_PREFIX } },
  });
}

function jstDateKeyFrom(date: Date): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export async function seedIosReviewAccount(): Promise<IosReviewSeedResult> {
  await upsertTikTokUser({
    tiktokUid: IOS_REVIEW_HOST_UID,
    tiktokHandle: IOS_REVIEW_HANDLE,
    nickname: "審査用配信者",
  });
  await upsertTikTokUser({
    tiktokUid: IOS_REVIEW_RIVAL_UID,
    tiktokHandle: IOS_REVIEW_RIVAL_HANDLE,
    nickname: "審査用対戦相手",
  });
  for (const fan of FANS) await upsertTikTokUser(fan);

  const room = await upsertIsolatedRoom(IOS_REVIEW_HOST_UID, IOS_REVIEW_HANDLE);
  const rivalRoom = await upsertIsolatedRoom(IOS_REVIEW_RIVAL_UID, IOS_REVIEW_RIVAL_HANDLE);

  const passwordHash = await bcrypt.hash(IOS_REVIEW_PASSWORD, 12);
  const existing = await prisma.principal.findUnique({
    where: { email: IOS_REVIEW_EMAIL },
    select: { id: true },
  });

  const user = existing
    ? await prisma.principal.update({
        where: { id: existing.id },
        data: { password: passwordHash, name: "App Store Review" },
        select: { id: true },
      })
    : await prisma.principal.create({
        data: {
          email: IOS_REVIEW_EMAIL,
          name: "App Store Review",
          password: passwordHash,
          accounts: {
            create: { type: "credentials", provider: "email", providerAccountId: IOS_REVIEW_EMAIL },
          },
        },
        select: { id: true },
      });

  await prisma.oAuthAccount.upsert({
    where: { provider_providerAccountId: { provider: "email", providerAccountId: IOS_REVIEW_EMAIL } },
    create: {
      type: "credentials",
      provider: "email",
      providerAccountId: IOS_REVIEW_EMAIL,
      userId: user.id,
    },
    update: {},
  });

  const streamer = await prisma.streamer.upsert({
    where: { principalId: user.id },
    update: {
      tiktokUid: IOS_REVIEW_HOST_UID,
      tiktokHandle: IOS_REVIEW_HANDLE,
      verified: true,
      verifiedAt: new Date(),
      roomId: room.id,
    },
    create: {
      principalId: user.id,
      tiktokUid: IOS_REVIEW_HOST_UID,
      tiktokHandle: IOS_REVIEW_HANDLE,
      verificationCode: "ios-review-seed",
      verified: true,
      verifiedAt: new Date(),
      roomId: room.id,
    },
  });

  const hasPro = await prisma.subscription.findFirst({
    where: { principalId: user.id, entitlementActive: true },
    select: { id: true },
  });
  if (!hasPro) {
    await prisma.subscription.create({
      data: {
        principalId: user.id,
        plan: "PRO",
        entitlementActive: true,
        currentPeriodEnd: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
  }

  await clearSeededObservation([room.id, rivalRoom.id]);

  const now = Date.now();
  const giftRows = [];
  for (let i = 0; i < 24; i++) {
    const gift = SAMPLE_GIFTS[i % SAMPLE_GIFTS.length];
    const sender = FANS[i % FANS.length];
    const repeatCount = 1 + (i % 4);
    const receivedAt = new Date(now - i * 4 * 60_000);
    giftRows.push({
      roomId: room.id,
      tiktokUid: sender.tiktokUid,
      giftId: gift.giftId,
      giftName: gift.giftName,
      giftPictureUrl: null,
      repeatCount,
      diamondCount: gift.diamondCount,
      totalDiamonds: gift.diamondCount * repeatCount,
      receivedAt,
      dayKey: jstDateKeyFrom(receivedAt),
      orderId: `${IOS_REVIEW_GIFT_ORDER_PREFIX}${i}`,
    });
  }
  await prisma.gift.createMany({ data: giftRows });

  const startedAt = new Date(now - 40 * 60_000);
  const endedAt = new Date(now - 30 * 60_000);
  const hostProfiles: HostProfiles = {
    [IOS_REVIEW_HOST_UID]: {
      displayId: IOS_REVIEW_HANDLE,
      nickName: "審査用配信者",
      avatarUrl: null,
    },
    [IOS_REVIEW_RIVAL_UID]: {
      displayId: IOS_REVIEW_RIVAL_HANDLE,
      nickName: "審査用対戦相手",
      avatarUrl: null,
    },
  };
  const hostScores = { [IOS_REVIEW_HOST_UID]: "1800", [IOS_REVIEW_RIVAL_UID]: "1200" };
  const battleData = {
    battleId: IOS_REVIEW_BATTLE_ID,
    action: BATTLE_ACTION.FINISH,
    startedAt,
    startedAtEstimated: false,
    endedAt,
    durationSec: 600,
    hostTiktokUids: [IOS_REVIEW_HOST_UID, IOS_REVIEW_RIVAL_UID],
    hostScores,
    hostProfiles,
  };
  await prisma.tiktokBattle.create({ data: { roomId: room.id, ...battleData } });
  await prisma.tiktokBattle.create({ data: { roomId: rivalRoom.id, ...battleData } });

  return {
    principalId: user.id,
    streamerId: streamer.id,
    roomId: room.id,
    rivalRoomId: rivalRoom.id,
    giftCount: giftRows.length,
  };
}

export async function purgeIosReviewAccount(): Promise<{
  principalDeleted: boolean;
  roomsDeleted: number;
}> {
  const user = await prisma.principal.findUnique({
    where: { email: IOS_REVIEW_EMAIL },
    select: { id: true, streamer: { select: { roomId: true } } },
  });

  const roomIds = new Set<string>();
  if (user?.streamer?.roomId) roomIds.add(user.streamer.roomId);
  const knownRooms = await prisma.tiktokRoom.findMany({
    where: { hostTiktokUid: { in: [IOS_REVIEW_HOST_UID, IOS_REVIEW_RIVAL_UID] } },
    select: { id: true },
  });
  for (const row of knownRooms) roomIds.add(row.id);

  if (user) {
    await prisma.principal.delete({ where: { id: user.id } });
  }

  let roomsDeleted = 0;
  for (const roomId of roomIds) {
    await prisma.giftDailyListenerStat.deleteMany({ where: { roomId } });
    await prisma.tiktokRoom.delete({ where: { id: roomId } });
    roomsDeleted += 1;
  }

  await prisma.tikTokUser.deleteMany({
    where: {
      tiktokUid: {
        in: [IOS_REVIEW_HOST_UID, IOS_REVIEW_RIVAL_UID, ...FANS.map((f) => f.tiktokUid)],
      },
    },
  });

  return { principalDeleted: Boolean(user), roomsDeleted };
}

async function existingSummary() {
  const user = await prisma.principal.findUnique({
    where: { email: IOS_REVIEW_EMAIL },
    select: {
      id: true,
      streamer: { select: { id: true, roomId: true, tiktokHandle: true } },
    },
  });
  const rooms = await prisma.tiktokRoom.findMany({
    where: { hostTiktokUid: { in: [IOS_REVIEW_HOST_UID, IOS_REVIEW_RIVAL_UID] } },
    select: {
      id: true,
      tiktokHandle: true,
      hostTiktokUid: true,
      handleStaleAt: true,
      monitoringSuspended: true,
    },
  });
  return { user, rooms };
}

async function cli() {
  const apply = process.argv.includes("--apply");
  const purge = process.argv.includes("--purge");
  const summary = await existingSummary();
  console.log(
    JSON.stringify(
      {
        email: IOS_REVIEW_EMAIL,
        password: IOS_REVIEW_PASSWORD,
        handle: IOS_REVIEW_HANDLE,
        apply,
        purge,
        existing: summary,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log("dry-run。書き込む場合は --apply、削除は --purge --apply");
    return;
  }

  if (purge) {
    const result = await purgeIosReviewAccount();
    console.log("purge完了", result);
    return;
  }

  const result = await seedIosReviewAccount();
  console.log("seed完了", result);
  console.log(`JST今日=${jstDateKey()} にギフトと終了済みバトルを投入済み`);
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").includes("seed-ios-review-account");
if (invokedDirectly) {
  cli()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
