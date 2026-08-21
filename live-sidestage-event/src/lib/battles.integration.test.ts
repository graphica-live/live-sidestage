// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// analytics の view (public.event_gift_v / public.event_battle_v) を読むので、
// live-sidestage-analytics/sql/event-integration.sql を先に適用しておくこと。
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { aggregateEvent } from "./aggregate";
import { createBracket } from "./tournament";

const PREFIX = "itest_battle";
// 検知の判定は現在時刻との前後関係で決まるので、固定日付ではなく now からの相対で組む。
// (開始は過去・終了は未来 = 開催中。締切前なので finalizedAt が立たず、何度でも再集計できる)
const NOW = Date.now();
const START = new Date(NOW - 3 * 86_400_000);
const END = new Date(NOW + 3 * 86_400_000);
const ROUND1_START = new Date(NOW - 2 * 86_400_000);
const BATTLE_START = new Date(ROUND1_START.getTime() + 10 * 60_000);
const BATTLE_END = new Date(ROUND1_START.getTime() + 20 * 60_000);
const GIFT_AT = new Date(ROUND1_START.getTime() + 15 * 60_000);

let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const createdEventIds: string[] = [];
const createdRoomIds: string[] = [];

async function createRoom(tiktokId: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt")
    VALUES (gen_random_uuid()::text, ${tiktokId}, NOW())
    RETURNING id
  `;
  createdRoomIds.push(rows[0].id);
  return rows[0].id;
}

async function insertGift(params: {
  roomId: string;
  uniqueId: string;
  diamonds: number;
  receivedAt: Date;
}) {
  await prisma.$executeRaw`
    INSERT INTO public.gifts
      (id, "roomId", "uniqueId", nickname, "giftId", "giftName", "repeatCount",
       "diamondCount", "totalDiamonds", "receivedAt", "dayKey", "orderId")
    VALUES
      (gen_random_uuid()::text, ${params.roomId}, ${params.uniqueId}, ${params.uniqueId},
       5, 'Rose', 1, ${params.diamonds}, ${params.diamonds}, ${params.receivedAt},
       '2026-09-01', ${`${PREFIX}_${uniqueSuffix()}`})
  `;
}

/** analytics 側の tiktok_battles に観測行を入れる(listener が書くのと同じ形)。 */
async function insertBattle(params: {
  roomId: string;
  battleId: string;
  startedAt: Date;
  endedAt: Date | null;
  startedAtEstimated?: boolean;
  durationSec?: number | null;
  action?: number;
}) {
  await prisma.$executeRaw`
    INSERT INTO public.tiktok_battles
      (id, "roomId", "battleId", action, "startedAt", "startedAtEstimated", "endedAt",
       "durationSec", "hostUserIds", "hostDisplayIds", "hostScores", raw, "updatedAt")
    VALUES
      (gen_random_uuid()::text, ${params.roomId}, ${params.battleId}, ${params.action ?? 5},
       ${params.startedAt}, ${params.startedAtEstimated ?? false}, ${params.endedAt},
       ${params.durationSec ?? null}, ARRAY[]::text[], ARRAY[]::text[], '{}'::jsonb,
       '{}'::jsonb, NOW())
  `;
}

async function newTournament() {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} トーナメント`,
      ownerUserId: `${PREFIX}_owner`,
      format: "TOURNAMENT",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: START,
      endAt: END,
    },
    select: { id: true },
  });
  createdEventIds.push(event.id);
  return event;
}

async function newParticipant(eventId: string, name: string) {
  const tiktokId = `${PREFIX}_${name}_${uniqueSuffix()}`;
  const roomId = await createRoom(tiktokId);
  const p = await prisma.eventParticipant.create({
    data: { eventId, tiktokId, roomId, displayName: name },
    select: { id: true },
  });
  return { id: p.id, roomId };
}

beforeEach(() => {
  seq = 0;
});

afterAll(async () => {
  for (const id of createdEventIds) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdRoomIds) {
    await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE id = ${id}`.catch(() => {});
  }
  await prisma.detectedBattle
    .deleteMany({ where: { battleId: { startsWith: PREFIX } } })
    .catch(() => {});
  await prisma.$disconnect();
});

describe("バトルの取り込みと対戦の確定", () => {
  it("両サイドを観測した1vs1は自動で確定し、勝者が次のラウンドへ進む", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");
    const d = await newParticipant(event.id, "d");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id, d.id],
      entryMode: "SOLO",
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
      roundIntervalMin: 120,
    });

    // 第1シード(a)と第4シード(d)が1回戦。実際にバトルが起きたことにする。
    const battleId = `${PREFIX}_b1_${uniqueSuffix()}`;
    const battleStart = BATTLE_START;
    const battleEnd = BATTLE_END;
    await insertBattle({ roomId: a.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });
    await insertBattle({ roomId: d.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });

    // バトル中のギフト。a のほうが多い。
    const at = GIFT_AT;
    await insertGift({ roomId: a.roomId, uniqueId: "listener1", diamonds: 500, receivedAt: at });
    await insertGift({ roomId: d.roomId, uniqueId: "listener2", diamonds: 300, receivedAt: at });

    await aggregateEvent(event.id);

    const first = await prisma.eventMatch.findFirst({
      where: { eventId: event.id, round: 1, bracketPosition: 0 },
      include: { sides: { orderBy: { sideIndex: "asc" } } },
    });
    expect(first?.status).toBe("FINISHED");
    expect(first?.detectedBattleId).toBe(battleId);
    expect(first?.detectionConfidence).toBe("exact");
    expect(first?.detectedEndSource).toBe("observed");
    expect(first?.winnerDecidedBy).toBe("AGGREGATE");
    expect(first?.winnerSideId).toBe(first?.sides[0].id);
    expect(first?.sides[0].diamonds).toBe(500n);
    expect(first?.sides[1].diamonds).toBe(300n);

    // 勝者が決勝の上側へ進んでいる。
    const final = await prisma.eventMatch.findFirst({
      where: { eventId: event.id, round: 2, bracketPosition: 0 },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { sideIndex: true, participants: { select: { participantId: true } } },
        },
      },
    });
    expect(final?.sides[0].participants.map((p) => p.participantId)).toEqual([a.id]);
    expect(final?.sides[1].participants).toEqual([]);
  });

  it("片側しか観測できなかった対戦は要確認になり、承認するまで確定しない", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      entryMode: "SOLO",
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });

    const battleId = `${PREFIX}_p1_${uniqueSuffix()}`;
    await insertBattle({
      roomId: a.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: BATTLE_END,
    });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "listener1",
      diamonds: 100,
      receivedAt: GIFT_AT,
    });

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirst({ where: { eventId: event.id, round: 1 } });
    expect(match?.status).toBe("NEEDS_REVIEW");
    expect(match?.detectionConfidence).toBe("partial");
    expect(match?.winnerSideId).toBeNull();

    // 主催者が承認すると次の集計で確定する。
    await prisma.eventMatch.update({ where: { id: match!.id }, data: { status: "DETECTED" } });
    await aggregateEvent(event.id);

    const approved = await prisma.eventMatch.findUnique({ where: { id: match!.id } });
    expect(approved?.status).toBe("FINISHED");
    expect(approved?.winnerDecidedBy).toBe("AGGREGATE");
    // 承認後に再検知が走っても要確認へ戻さない。
    expect(approved?.detectionConfidence).toBe("partial");
  });

  it("時間枠を過ぎても検知できなければ未実施になる", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      entryMode: "SOLO",
      // すでに過ぎた時間枠
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirst({ where: { eventId: event.id, round: 1 } });
    expect(match?.status).toBe("NO_SHOW");
  });

  it("BATTLE倍率はバトル中の参加者にだけかかる", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    // 対戦に出ていない参加者。同時刻にギフトを受けても等倍のまま。
    const c = await newParticipant(event.id, "c");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      entryMode: "SOLO",
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });
    await prisma.eventMultiplier.create({
      data: { eventId: event.id, kind: "BATTLE", factor: "2.00" },
    });

    const battleId = `${PREFIX}_m1_${uniqueSuffix()}`;
    const battleStart = BATTLE_START;
    const battleEnd = BATTLE_END;
    await insertBattle({ roomId: a.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });
    await insertBattle({ roomId: b.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });

    const at = GIFT_AT;
    await insertGift({ roomId: a.roomId, uniqueId: "listener1", diamonds: 100, receivedAt: at });
    await insertGift({ roomId: c.roomId, uniqueId: "listener1", diamonds: 100, receivedAt: at });

    // 1周目でバトル区間が確定し、2周目でその区間に倍率がかかる。
    await aggregateEvent(event.id);
    await aggregateEvent(event.id);

    const standings = await prisma.eventStanding.findMany({
      where: { eventId: event.id, subjectType: "PARTICIPANT" },
    });
    const forA = standings.find((s) => s.subjectId === a.id);
    const forC = standings.find((s) => s.subjectId === c.id);

    expect(forA?.diamonds).toBe(100n);
    expect(String(forA?.points)).toBe("200");
    // 同時刻でもバトルに出ていない c は等倍のまま。
    expect(forC?.diamonds).toBe(100n);
    expect(String(forC?.points)).toBe("100");
  });

  it("不戦勝は検知を待たずに次のラウンドへ進む", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id],
      entryMode: "SOLO",
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
      roundIntervalMin: 120,
    });

    // 3人 → 4枠。第1シード(a)が不戦勝。
    const bye = await prisma.eventMatch.findFirst({
      where: { eventId: event.id, round: 1, bracketPosition: 0 },
    });
    expect(bye?.status).toBe("FINISHED");
    expect(bye?.winnerDecidedBy).toBe("BYE");

    await aggregateEvent(event.id);

    const final = await prisma.eventMatch.findFirst({
      where: { eventId: event.id, round: 2, bracketPosition: 0 },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { sideIndex: true, participants: { select: { participantId: true } } },
        },
      },
    });
    expect(final?.sides[0].participants.map((p) => p.participantId)).toEqual([a.id]);
  });

  it("同点なら勝者を決めず、主催者の手動確定に回す", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      entryMode: "SOLO",
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });

    const battleId = `${PREFIX}_t1_${uniqueSuffix()}`;
    const battleStart = BATTLE_START;
    const battleEnd = BATTLE_END;
    await insertBattle({ roomId: a.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });
    await insertBattle({ roomId: b.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });

    const at = GIFT_AT;
    await insertGift({ roomId: a.roomId, uniqueId: "l1", diamonds: 100, receivedAt: at });
    await insertGift({ roomId: b.roomId, uniqueId: "l2", diamonds: 100, receivedAt: at });

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirst({ where: { eventId: event.id, round: 1 } });
    expect(match?.status).toBe("DETECTED");
    expect(match?.winnerSideId).toBeNull();
  });

  it("終了を観測できなくても設定時間から終了時刻を割り出す", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      entryMode: "SOLO",
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });

    const battleId = `${PREFIX}_d1_${uniqueSuffix()}`;
    const battleStart = BATTLE_START;
    // FINISH を受け取れなかった(action は OPEN のまま、endedAt が null)
    await insertBattle({
      roomId: a.roomId,
      battleId,
      startedAt: battleStart,
      endedAt: null,
      durationSec: 300,
      action: 4,
    });
    await insertBattle({
      roomId: b.roomId,
      battleId,
      startedAt: battleStart,
      endedAt: null,
      durationSec: 300,
      action: 4,
    });

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirst({ where: { eventId: event.id, round: 1 } });
    expect(match?.detectedEndSource).toBe("duration");
    expect(match?.detectedEndAt?.getTime()).toBe(BATTLE_START.getTime() + 300_000);
  });
});
