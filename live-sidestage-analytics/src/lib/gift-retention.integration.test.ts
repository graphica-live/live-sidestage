// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// **このテストはグローバルに効く処理を実行する。** runGiftRetentionCycle() は
// room を絞らず「dayKey < 90日前」の Gift を全て消し、AppSetting の watermark を書く。
// 他の integration テストのフィクスチャは全て直近90日以内の dayKey を使っている前提で
// 成立している(2026-09時点で確認済み)。90日より古い dayKey のフィクスチャを足すときは、
// このテストと同時に走らせないこと。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { runGiftRetentionCycle } from "./gift-retention";
import {
  RETENTION_DELETED_THROUGH_KEY,
  ROLLUP_WATERMARK_KEY,
  dayKeyOf,
  shiftDayKey,
} from "./gift-retention-window";
import { aggregateGiftUsers } from "./gift-analytics";

const PREFIX = "itest_retention";
let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const NOW = new Date();
const TODAY = dayKeyOf(NOW);
/** 削除対象(90日より前)。 */
const OLD_DAY = shiftDayKey(TODAY, -120);
/** 保持対象かつロールアップ済みになる日。 */
const MID_DAY = shiftDayKey(TODAY, -30);

const roomIds: string[] = [];
const eventIds: string[] = [];

async function createRoom(): Promise<string> {
  // monitoringSuspended: true は監視対象からの隔離(aggregate.integration.test.ts と同じ理由)。
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt", "monitoringSuspended")
    VALUES (gen_random_uuid()::text, ${`${PREFIX}${uniqueSuffix()}`.toLowerCase()}, NOW(), true)
    RETURNING id
  `;
  roomIds.push(rows[0].id);
  return rows[0].id;
}

async function insertGift(params: {
  roomId: string;
  uniqueId: string;
  dayKey: string;
  diamonds: number;
  repeatCount?: number;
  nickname?: string;
}) {
  const receivedAt = new Date(`${params.dayKey}T12:00:00+09:00`);
  await prisma.$executeRaw`
    INSERT INTO public.gifts
      (id, "roomId", "uniqueId", nickname, "giftId", "giftName", "repeatCount",
       "diamondCount", "totalDiamonds", "receivedAt", "dayKey", "orderId")
    VALUES
      (gen_random_uuid()::text, ${params.roomId}, ${params.uniqueId},
       ${params.nickname ?? params.uniqueId}, 5, 'Rose', ${params.repeatCount ?? 1},
       ${params.diamonds}, ${params.diamonds}, ${receivedAt}, ${params.dayKey},
       ${`${PREFIX}_${uniqueSuffix()}`})
  `;
}

async function createUnfinalizedEventFor(roomId: string) {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 進行中`,
      ownerUserId: `${PREFIX}_owner`,
      format: "DIAMOND_RACE",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: new Date(NOW.getTime() - 86_400_000),
      endAt: new Date(NOW.getTime() + 86_400_000),
      finalizedAt: null,
      participants: {
        create: {
          tiktokId: `${PREFIX}${uniqueSuffix()}`.toLowerCase(),
          displayName: "進行中の参加者",
          roomId,
        },
      },
    },
    select: { id: true },
  });
  eventIds.push(event.id);
  return event.id;
}

let plainRoomId = "";
let protectedRoomId = "";
const listener = `${PREFIX}_u1_${uniqueSuffix()}`;
const otherListener = `${PREFIX}_u2_${uniqueSuffix()}`;

beforeAll(async () => {
  plainRoomId = await createRoom();
  protectedRoomId = await createRoom();
  await createUnfinalizedEventFor(protectedRoomId);

  // 削除対象の日(120日前)。listener が2行(repeat 2+3、10+20ダイヤ)、otherListener が1行。
  await insertGift({ roomId: plainRoomId, uniqueId: listener, dayKey: OLD_DAY, diamonds: 10, repeatCount: 2 });
  await insertGift({ roomId: plainRoomId, uniqueId: listener, dayKey: OLD_DAY, diamonds: 20, repeatCount: 3 });
  await insertGift({ roomId: plainRoomId, uniqueId: otherListener, dayKey: OLD_DAY, diamonds: 5 });
  // 保持対象の日(30日前)。
  await insertGift({ roomId: plainRoomId, uniqueId: listener, dayKey: MID_DAY, diamonds: 7, repeatCount: 1 });
  // 未確定イベントの参加room。削除されてはいけない。
  await insertGift({ roomId: protectedRoomId, uniqueId: listener, dayKey: OLD_DAY, diamonds: 100 });
});

afterAll(async () => {
  if (eventIds.length > 0) await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  if (roomIds.length > 0) {
    await prisma.giftDailyListenerStat.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
  }
  await prisma.giftLifetimeStat.deleteMany({
    where: { uniqueId: { in: [listener, otherListener] } },
  });
  await prisma.appSetting.deleteMany({
    where: { key: { in: [ROLLUP_WATERMARK_KEY, RETENTION_DELETED_THROUGH_KEY] } },
  });
});

describe("runGiftRetentionCycle", () => {
  it("dry-runはロールアップと累計を作るが、Giftは1件も消さない", async () => {
    const result = await runGiftRetentionCycle({ dryRun: true, now: NOW });

    expect(result.dryRun).toBe(true);
    expect(result.rollup.watermarkAfter).toBe(shiftDayKey(TODAY, -1));
    expect(result.deletion.skippedReason).toBeNull();
    // 保護対象1件は削除候補に数えない。
    expect(result.deletion.deletedRows).toBeGreaterThanOrEqual(3);
    expect(result.deletion.protectedRows).toBeGreaterThanOrEqual(1);

    // 日次ロールアップの値が削除前の Gift 集計と一致する。
    const oldStat = await prisma.giftDailyListenerStat.findUnique({
      where: { roomId_dayKey_uniqueId: { roomId: plainRoomId, dayKey: OLD_DAY, uniqueId: listener } },
    });
    expect(oldStat).not.toBeNull();
    expect(oldStat!.rowCount).toBe(2);
    expect(oldStat!.giftCount).toBe(5); // repeatCount 2 + 3
    expect(oldStat!.totalDiamonds).toBe(30);

    // 全期間累計(room横断)。保護roomの100ダイヤも含む。
    const lifetime = await prisma.giftLifetimeStat.findUnique({ where: { uniqueId: listener } });
    expect(lifetime).not.toBeNull();
    expect(lifetime!.rowCount).toBe(4); // OLD_DAY 2件 + MID_DAY 1件 + 保護room 1件
    expect(Number(lifetime!.totalDiamonds)).toBe(137);

    const remaining = await prisma.gift.count({ where: { roomId: plainRoomId } });
    expect(remaining).toBe(4);
  });

  it("本実行は90日より古いGiftだけを消し、未確定イベントの参加roomは保護する", async () => {
    const result = await runGiftRetentionCycle({ dryRun: false, now: NOW });

    expect(result.deletion.skippedReason).toBeNull();
    expect(result.deletion.deletedThroughAfter).toBe(shiftDayKey(TODAY, -91));

    expect(await prisma.gift.count({ where: { roomId: plainRoomId, dayKey: OLD_DAY } })).toBe(0);
    expect(await prisma.gift.count({ where: { roomId: plainRoomId, dayKey: MID_DAY } })).toBe(1);
    // 未確定イベントの参加roomは消えない。
    expect(await prisma.gift.count({ where: { roomId: protectedRoomId } })).toBe(1);

    // ロールアップは残る(長期保持)。
    const stats = await prisma.giftDailyListenerStat.count({ where: { roomId: plainRoomId } });
    expect(stats).toBe(3); // OLD_DAY×2人 + MID_DAY×1人
  });

  it("削除後も aggregateGiftUsers は削除前と同じ合計を返す(ロールアップとGiftのマージ)", async () => {
    const { users } = await aggregateGiftUsers(
      { roomId: plainRoomId, dayKey: { gte: OLD_DAY, lte: TODAY } },
      { resolveAvatars: false, now: NOW }
    );

    const target = users.find((u) => u.uniqueId === listener);
    expect(target).toBeDefined();
    // 120日前(ロールアップ) 5回/30ダイヤ + 30日前(生Gift) 1回/7ダイヤ
    expect(target!.giftCount).toBe(6);
    expect(target!.totalDiamonds).toBe(37);

    const other = users.find((u) => u.uniqueId === otherListener);
    expect(other?.giftCount).toBe(1);
    expect(other?.totalDiamonds).toBe(5);
  });

  it("2回目の削除は冪等(消すものが無く、watermarkは進んだまま)", async () => {
    const result = await runGiftRetentionCycle({ dryRun: false, now: NOW });
    expect(result.deletion.deletedRows).toBe(0);
    expect(result.rollup.watermarkAfter).toBe(shiftDayKey(TODAY, -1));
  });

  it("削除済みの日はロールアップの再計算対象に入らない(過少値で上書きしない)", async () => {
    // 削除済みの日(OLD_DAY)を再upsertすると Gift が0件なので rowCount が消える。
    // upsert 下限が deletedThrough+1 に切り上がっているので、値は保持されたまま。
    const oldStat = await prisma.giftDailyListenerStat.findUnique({
      where: { roomId_dayKey_uniqueId: { roomId: plainRoomId, dayKey: OLD_DAY, uniqueId: listener } },
    });
    expect(oldStat!.rowCount).toBe(2);
    expect(oldStat!.giftCount).toBe(5);
  });

});
