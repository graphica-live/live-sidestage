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
import { makeTiktokUid } from "./__fixtures__/gift";

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
  const suffix = uniqueSuffix();
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO public."TiktokRoom" (id, "tiktokHandle", "hostTiktokUid", "createdAt", "monitoringSuspended")
    VALUES (gen_random_uuid()::text, ${`${PREFIX}${suffix}`.toLowerCase()},
            ${makeTiktokUid(`${PREFIX}_host_${suffix}`)}, NOW(), true)
    RETURNING id
  `;
  roomIds.push(rows[0].id);
  return rows[0].id;
}

// Gift は表示用の列(tiktokHandle / nickname / profileImageUrl)を持たない。集計キーは tiktokUid。
async function insertGift(params: {
  roomId: string;
  tiktokUid: string;
  dayKey: string;
  diamonds: number;
  repeatCount?: number;
}) {
  const receivedAt = new Date(`${params.dayKey}T12:00:00+09:00`);
  await prisma.$executeRaw`
    INSERT INTO public.gifts
      (id, "roomId", "tiktokUid", "giftId", "giftName", "repeatCount",
       "diamondCount", "totalDiamonds", "receivedAt", "dayKey", "orderId")
    VALUES
      (gen_random_uuid()::text, ${params.roomId}, ${params.tiktokUid},
       5, 'Rose', ${params.repeatCount ?? 1},
       ${params.diamonds}, ${params.diamonds}, ${receivedAt}, ${params.dayKey},
       ${`${PREFIX}_${uniqueSuffix()}`})
  `;
}

async function createUnfinalizedEventFor(roomId: string) {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 進行中`,
      ownerPrincipalId: `${PREFIX}_owner`,
      format: "DIAMOND_RACE",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: new Date(NOW.getTime() - 86_400_000),
      endAt: new Date(NOW.getTime() + 86_400_000),
      finalizedAt: null,
      participants: {
        create: {
          tiktokUid: makeTiktokUid(`${PREFIX}_participant_${uniqueSuffix()}`),
          tiktokHandle: `${PREFIX}${uniqueSuffix()}`.toLowerCase(),
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
// ロールアップの GROUP BY / ON CONFLICT が tiktokUid で張られていることの検証点。
// このファイルのプロセス起動ごとに一意な uid を使い、他 integration テストと混ざらないようにする。
const listener = makeTiktokUid(`${PREFIX}_u1_${uniqueSuffix()}`);
const otherListener = makeTiktokUid(`${PREFIX}_u2_${uniqueSuffix()}`);

beforeAll(async () => {
  plainRoomId = await createRoom();
  protectedRoomId = await createRoom();
  await createUnfinalizedEventFor(protectedRoomId);

  // 削除対象の日(120日前)。listener が2行(repeat 2+3、10+20ダイヤ)、otherListener が1行。
  await insertGift({ roomId: plainRoomId, tiktokUid: listener, dayKey: OLD_DAY, diamonds: 10, repeatCount: 2 });
  await insertGift({ roomId: plainRoomId, tiktokUid: listener, dayKey: OLD_DAY, diamonds: 20, repeatCount: 3 });
  await insertGift({ roomId: plainRoomId, tiktokUid: otherListener, dayKey: OLD_DAY, diamonds: 5 });
  // 保持対象の日(30日前)。
  await insertGift({ roomId: plainRoomId, tiktokUid: listener, dayKey: MID_DAY, diamonds: 7, repeatCount: 1 });
  // 未確定イベントの参加room。削除されてはいけない。
  await insertGift({ roomId: protectedRoomId, tiktokUid: listener, dayKey: OLD_DAY, diamonds: 100 });
});

afterAll(async () => {
  if (eventIds.length > 0) await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  if (roomIds.length > 0) {
    await prisma.giftDailyListenerStat.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
  }
  await prisma.giftLifetimeStat.deleteMany({
    where: { tiktokUid: { in: [listener, otherListener] } },
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
      where: { roomId_dayKey_tiktokUid: { roomId: plainRoomId, dayKey: OLD_DAY, tiktokUid: listener } },
    });
    expect(oldStat).not.toBeNull();
    expect(oldStat!.rowCount).toBe(2);
    expect(oldStat!.giftCount).toBe(5); // repeatCount 2 + 3
    expect(oldStat!.totalDiamonds).toBe(30);

    // 全期間累計(room横断)。保護roomの100ダイヤも含む。
    const lifetime = await prisma.giftLifetimeStat.findUnique({ where: { tiktokUid: listener } });
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

    const target = users.find((u) => u.tiktokUid === listener);
    expect(target).toBeDefined();
    // 120日前(ロールアップ) 5回/30ダイヤ + 30日前(生Gift) 1回/7ダイヤ
    expect(target!.giftCount).toBe(6);
    expect(target!.totalDiamonds).toBe(37);

    const other = users.find((u) => u.tiktokUid === otherListener);
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
      where: { roomId_dayKey_tiktokUid: { roomId: plainRoomId, dayKey: OLD_DAY, tiktokUid: listener } },
    });
    expect(oldStat!.rowCount).toBe(2);
    expect(oldStat!.giftCount).toBe(5);
  });

});

// 誰も購読していないroom(Streamer登録・AgencyWatch登録・specialWatch・monitorUntilの
// いずれも無い)の未確定TiktokBattle行が、Gift削除処理を永久停止させないことの検証
// (review-auto Design ModeでCRITICAL判定。gift-retention.tsのfinalizePendingBattles/
// countPendingBattlesのSQL修正の固定)。
describe("runGiftRetentionCycle — 購読なしroomの未確定バトルはGift削除を止めない", () => {
  const battleRoomIds: string[] = [];
  const battleListener = makeTiktokUid(`${PREFIX}_battle_u_${uniqueSuffix()}`);
  let unsubscribedRoomId = "";
  let subscribedRoomId = "";
  const oldBattleStartedAt = new Date(`${OLD_DAY}T00:00:00+09:00`);

  async function createBattle(roomId: string, battleId: string) {
    await prisma.tiktokBattle.create({
      data: { roomId, battleId, action: 5, startedAt: oldBattleStartedAt },
    });
  }

  beforeAll(async () => {
    unsubscribedRoomId = await createRoom(); // specialWatch等いずれも無い(購読なし)
    subscribedRoomId = await createRoom();
    await prisma.tiktokRoom.update({ where: { id: subscribedRoomId }, data: { specialWatch: true } });
    battleRoomIds.push(unsubscribedRoomId, subscribedRoomId);

    await createBattle(unsubscribedRoomId, `${PREFIX}_battle_unsub`);
    await insertGift({ roomId: unsubscribedRoomId, tiktokUid: battleListener, dayKey: OLD_DAY, diamonds: 10 });
  });

  afterAll(async () => {
    await prisma.tiktokBattle.deleteMany({ where: { roomId: { in: battleRoomIds } } });
    await prisma.gift.deleteMany({ where: { roomId: { in: battleRoomIds } } });
    await prisma.giftDailyListenerStat.deleteMany({ where: { roomId: { in: battleRoomIds } } });
    await prisma.tiktokRoom.deleteMany({ where: { id: { in: battleRoomIds } } });
    await prisma.giftLifetimeStat.deleteMany({ where: { tiktokUid: battleListener } });
  });

  it("購読なしroomの未確定バトルが残っていてもGift削除は進む(countPendingBattlesが数えない)", async () => {
    const result = await runGiftRetentionCycle({ dryRun: false, now: NOW });

    expect(result.deletion.skippedReason).toBeNull();
    expect(await prisma.gift.count({ where: { roomId: unsubscribedRoomId, dayKey: OLD_DAY } })).toBe(0);
    // 対象取得SQLからも除外されるので、pending集計にも現れない。
    expect(result.battles.pending).toBe(0);
    // 購読なしroomのTiktokBattle行自体は削除されず残る(既存の取りこぼし扱いと同じ、削除しない)。
    expect(await prisma.tiktokBattle.count({ where: { roomId: unsubscribedRoomId } })).toBe(1);
  });

  it("購読ありroomの未確定バトルは従来どおり削除を止める(既存動作の回帰防止)", async () => {
    await createBattle(subscribedRoomId, `${PREFIX}_battle_sub`);
    await insertGift({ roomId: subscribedRoomId, tiktokUid: battleListener, dayKey: OLD_DAY, diamonds: 10 });

    const result = await runGiftRetentionCycle({ dryRun: false, now: NOW });

    expect(result.battles.pending).toBeGreaterThanOrEqual(1);
    expect(result.deletion.skippedReason).not.toBeNull();
    expect(result.deletion.skippedReason).toMatch(/未確定バトル/);
    // 購読ありroomの対象Giftは削除が見送られたまま残る。
    expect(await prisma.gift.count({ where: { roomId: subscribedRoomId, dayKey: OLD_DAY } })).toBe(1);
  });
});

// Codex-terra TestCase Modeレビュー指摘(HIGH): 上のdescribeブロックはspecialWatchケースしか
// 検証していない。finalizePendingBattles/countPendingBattlesのraw SQL購読条件は
// Streamer存在・AgencyWatch存在・monitorUntil未来の3条件をOR結合で別実装しており、
// これらが漏れると未確定バトルの元Giftが削除され復元不能な履歴欠損になる(CRITICAL相当)。
// monitorUntil===nowの境界(SQLは`> now`なので含まれない)も固定する。
describe("runGiftRetentionCycle — 購読条件の網羅(Streamer/AgencyWatch/monitorUntil境界)", () => {
  const roomIdsHere: string[] = [];
  const battleListener = makeTiktokUid(`${PREFIX}_battle_cov_${uniqueSuffix()}`);
  const oldBattleStartedAt = new Date(`${OLD_DAY}T00:00:00+09:00`);
  let streamerSubjectRoomId = "";
  let agencyWatchRoomId = "";
  let monitorFutureRoomId = "";
  let monitorNowRoomId = "";
  let principalId = "";
  let agencyId = "";

  async function createBattle(roomId: string, battleId: string) {
    await prisma.tiktokBattle.create({
      data: { roomId, battleId, action: 5, startedAt: oldBattleStartedAt },
    });
  }

  beforeAll(async () => {
    streamerSubjectRoomId = await createRoom();
    agencyWatchRoomId = await createRoom();
    monitorFutureRoomId = await createRoom();
    monitorNowRoomId = await createRoom();
    roomIdsHere.push(streamerSubjectRoomId, agencyWatchRoomId, monitorFutureRoomId, monitorNowRoomId);

    const user = await prisma.user.create({
      data: { email: `${PREFIX}-streamer-${uniqueSuffix()}@local.test`, name: "itest" },
      select: { id: true },
    });
    principalId = user.id;
    await prisma.streamer.create({
      data: {
        principalId,
        roomId: streamerSubjectRoomId,
        tiktokUid: makeTiktokUid(`${PREFIX}_streamer_${uniqueSuffix()}`),
        tiktokHandle: `${PREFIX}streamer${uniqueSuffix()}`.toLowerCase(),
        verificationCode: `${PREFIX}-vc-${uniqueSuffix()}`,
        apiKey: `${PREFIX}-key-${uniqueSuffix()}`,
        overlayToken: `${PREFIX}-ov-${uniqueSuffix()}`,
      },
    });

    const agency = await prisma.agency.create({
      data: { email: `${PREFIX}-agency-${uniqueSuffix()}@local.test`, name: "itest事務所" },
      select: { id: true },
    });
    agencyId = agency.id;
    await prisma.agencyWatch.create({
      data: {
        agencyId,
        roomId: agencyWatchRoomId,
        tiktokUid: makeTiktokUid(`${PREFIX}_watch_${uniqueSuffix()}`),
        tiktokHandle: `${PREFIX}watch${uniqueSuffix()}`.toLowerCase(),
      },
    });

    await prisma.tiktokRoom.update({
      where: { id: monitorFutureRoomId },
      data: { monitorUntil: new Date(NOW.getTime() + 60 * 60 * 1000) },
    });
    // 境界: monitorUntil === now は "> now" を満たさないため購読なし扱いになるはず。
    await prisma.tiktokRoom.update({
      where: { id: monitorNowRoomId },
      data: { monitorUntil: NOW },
    });

    for (const [roomId, tag] of [
      [streamerSubjectRoomId, "streamer"],
      [agencyWatchRoomId, "agencywatch"],
      [monitorFutureRoomId, "future"],
      [monitorNowRoomId, "now"],
    ] as const) {
      await createBattle(roomId, `${PREFIX}_battle_cov_${tag}_${uniqueSuffix()}`);
      await insertGift({ roomId, tiktokUid: battleListener, dayKey: OLD_DAY, diamonds: 10 });
    }
  });

  afterAll(async () => {
    await prisma.tiktokBattle.deleteMany({ where: { roomId: { in: roomIdsHere } } });
    await prisma.gift.deleteMany({ where: { roomId: { in: roomIdsHere } } });
    await prisma.giftDailyListenerStat.deleteMany({ where: { roomId: { in: roomIdsHere } } });
    await prisma.agencyWatch.deleteMany({ where: { roomId: agencyWatchRoomId } });
    if (agencyId) await prisma.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await prisma.streamer.deleteMany({ where: { roomId: streamerSubjectRoomId } });
    await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIdsHere } } });
    if (principalId) await prisma.user.delete({ where: { id: principalId } }).catch(() => {});
    await prisma.giftLifetimeStat.deleteMany({ where: { tiktokUid: battleListener } });
  });

  it("Streamer/AgencyWatch/monitorUntil未来のroomは購読ありとしてGift削除を止める", async () => {
    const result = await runGiftRetentionCycle({ dryRun: false, now: NOW });

    expect(result.battles.pending).toBeGreaterThanOrEqual(3);
    expect(result.deletion.skippedReason).not.toBeNull();
    for (const roomId of [streamerSubjectRoomId, agencyWatchRoomId, monitorFutureRoomId]) {
      expect(await prisma.gift.count({ where: { roomId, dayKey: OLD_DAY } })).toBe(1);
    }
  });

  it("monitorUntil===nowの境界roomは購読なし扱いでGiftが削除される", async () => {
    // 上のitで全体が止まっているため、monitorNowRoomIdだけを対象に別途battleを片付けて
    // 単独で検証する(SQLの`> now`境界そのものを、他室の未確定バトルに引きずられず確認する)。
    await prisma.tiktokBattle.deleteMany({
      where: { roomId: { in: [streamerSubjectRoomId, agencyWatchRoomId, monitorFutureRoomId] } },
    });

    const result = await runGiftRetentionCycle({ dryRun: false, now: NOW });

    expect(result.deletion.skippedReason).toBeNull();
    expect(await prisma.gift.count({ where: { roomId: monitorNowRoomId, dayKey: OLD_DAY } })).toBe(0);
  });
});
