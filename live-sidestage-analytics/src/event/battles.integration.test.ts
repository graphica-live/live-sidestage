// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// public.gifts / public.tiktok_battles を直接読むので、
// `npm run db:push:local` 済みのDBが要る。
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { aggregateEvent } from "./aggregate";
import { createBracket, destroyBracket } from "./tournament";

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
// 締切(endAt + 猶予1時間)を過ぎたイベント用。最終集計の打ち切りを見るのに使う。
const PAST_START = new Date(NOW - 10 * 86_400_000);
const PAST_END = new Date(NOW - 8 * 86_400_000);
const PAST_ROUND1_START = new Date(PAST_START.getTime() + 60 * 60_000);

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

/** 締切(endAt + 猶予1時間)を過ぎたイベント。最終集計の挙動を見るのに使う。 */
async function newPastTournament() {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 終了済みトーナメント`,
      ownerUserId: `${PREFIX}_owner`,
      format: "TOURNAMENT",
      entryMode: "SOLO",
      status: "FINISHED",
      startAt: PAST_START,
      endAt: PAST_END,
    },
    select: { id: true },
  });
  createdEventIds.push(event.id);
  return event;
}

async function eventTitle(eventId: string): Promise<string> {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { title: true },
  });
  return event.title;
}

/** 1回戦の1件を手動確定して「進行済み」の表を作る。戻り値はそのマッチID。 */
async function finishFirstMatch(eventId: string): Promise<string> {
  const match = await prisma.eventMatch.findFirstOrThrow({
    where: { eventId, round: 1 },
    include: { sides: true },
  });
  await prisma.eventMatch.update({
    where: { id: match.id },
    data: { status: "FINISHED", winnerSideId: match.sides[0].id, winnerDecidedBy: "MANUAL" },
  });
  return match.id;
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

describe("トーナメント表の作り直し", () => {
  it("不戦勝(BYE)だけが確定している状態なら作り直せる", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    // 参加3人 = 2のべき乗でないので1回戦にBYEが入り、その場でFINISHEDへ自動確定する。
    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });

    const byeMatch = await prisma.eventMatch.findFirst({
      where: { eventId: event.id, round: 1, winnerDecidedBy: "BYE" },
    });
    expect(byeMatch?.status).toBe("FINISHED");

    // BYEしか確定していないので、entrantIds を変えて作り直しても拒否されない。
    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id, c.id].reverse(),
        firstRoundStartAt: ROUND1_START,
        matchWindowMin: 60,
      })
    ).resolves.toMatchObject({ matches: expect.any(Number) });
  });

  it("主催者が手動確定した対戦があると作り直しは拒否される", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });

    const match = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
      include: { sides: true },
    });
    await prisma.eventMatch.update({
      where: { id: match.id },
      data: { status: "FINISHED", winnerSideId: match.sides[0].id, winnerDecidedBy: "MANUAL" },
    });

    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
        firstRoundStartAt: ROUND1_START,
        matchWindowMin: 60,
      })
    ).rejects.toMatchObject({ code: "ALREADY_STARTED" });
  });

  it("NO_SHOW だけの表は確認なしで作り直せる", async () => {
    // 1回戦の開始を過去に置くと、集計の周回で NO_SHOW が付く。これを進行済みに
    // 数えていたせいで、その表は二度と作り直せなくなっていた。
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });
    await prisma.eventMatch.updateMany({
      where: { eventId: event.id },
      data: { status: "NO_SHOW" },
    });

    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
        firstRoundStartAt: ROUND1_START,
        matchWindowMin: 60,
      })
    ).resolves.toMatchObject({ matches: 1 });
  });

  it("VOID だけの表は確認なしで作り直せる", async () => {
    // 「作り直すには対戦を無効にすること」と案内しておきながら、無効にすると
    // 永久にブロックされる状態だった。
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });
    await prisma.eventMatch.updateMany({
      where: { eventId: event.id },
      data: { status: "VOID" },
    });

    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
        firstRoundStartAt: ROUND1_START,
        matchWindowMin: 60,
      })
    ).resolves.toMatchObject({ matches: 1 });
  });

  it("イベント名を入力すれば確定済みの対戦があっても作り直せる", async () => {
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });
    const before = await finishFirstMatch(event.id);
    await prisma.event.update({
      where: { id: event.id },
      data: { finalizedAt: new Date() },
    });

    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
        firstRoundStartAt: ROUND1_START,
        matchWindowMin: 60,
        confirm: title,
      })
    ).resolves.toMatchObject({ matches: 1 });

    const after = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      select: { id: true, status: true },
    });
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(before);
    expect(after[0].status).toBe("SCHEDULED");
    // 表を作り直したら結果が変わる。最終集計が済んでいてもやり直させる。
    const reopened = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(reopened.finalizedAt).toBeNull();
  });

  it("イベント名が一致しなければ拒否し、既存の表と結果を残す", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });
    const kept = await finishFirstMatch(event.id);

    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
        firstRoundStartAt: ROUND1_START,
        matchWindowMin: 60,
        confirm: "まったく違うイベント名",
      })
    ).rejects.toMatchObject({ code: "CONFIRM_MISMATCH" });

    const still = await prisma.eventMatch.findUniqueOrThrow({ where: { id: kept } });
    expect(still.status).toBe("FINISHED");
  });

  it("イベント名を変えた後は、古い名前の確認では破棄できない", async () => {
    // 確認の照合は route 層ではなくロックを取った後に行う。外で読むと、
    // 名前の変更と競合したときに古い名前で新しいイベントの表を消せてしまう。
    const event = await newTournament();
    const oldTitle = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });
    await finishFirstMatch(event.id);
    await prisma.event.update({
      where: { id: event.id },
      data: { title: `${oldTitle} 改` },
    });

    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
        firstRoundStartAt: ROUND1_START,
        matchWindowMin: 60,
        confirm: oldTitle,
      })
    ).rejects.toMatchObject({ code: "CONFIRM_MISMATCH" });
  });

  it("表が入れ替わっていたら BRACKET_CHANGED で拒否する", async () => {
    // 別タブが作り直した表を、古い画面のリクエストが消さないようにする。
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });
    const staleIds = (
      await prisma.eventMatch.findMany({ where: { eventId: event.id }, select: { id: true } })
    ).map((m) => m.id);

    // 別タブが作り直す。
    await createBracket({
      eventId: event.id,
      entrantIds: [b.id, a.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });
    const current = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });

    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
        firstRoundStartAt: ROUND1_START,
        matchWindowMin: 60,
        confirm: title,
        expectedMatchIds: staleIds,
      })
    ).rejects.toMatchObject({ code: "BRACKET_CHANGED" });

    const after = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });
    expect(after.map((m) => m.id).sort()).toEqual(current.map((m) => m.id).sort());
  });

  it("作り直しが日程不正で失敗したら、既存の表と結果はそのまま残る", async () => {
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });
    const kept = await finishFirstMatch(event.id);
    await prisma.event.update({
      where: { id: event.id },
      data: { finalizedAt: new Date() },
    });

    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
        // 開催期間の外。planRoundStarts が通らない。
        firstRoundStartAt: new Date(END.getTime() + 86_400_000),
        matchWindowMin: 60,
        confirm: title,
      })
    ).rejects.toMatchObject({ code: "OUT_OF_EVENT_WINDOW" });

    // 破棄と再作成は同じトランザクション。片方だけ通って表を失うことはない。
    const still = await prisma.eventMatch.findUniqueOrThrow({ where: { id: kept } });
    expect(still.status).toBe("FINISHED");
    const untouched = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(untouched.finalizedAt).not.toBeNull();
  });
});

describe("トーナメント表の破棄", () => {
  it("表を全部消し、最終集計をやり直させる", async () => {
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });
    await finishFirstMatch(event.id);
    await prisma.event.update({
      where: { id: event.id },
      data: { finalizedAt: new Date() },
    });

    await expect(destroyBracket(event.id, { confirm: title })).resolves.toMatchObject({
      destroyed: 1,
    });

    expect(await prisma.eventMatch.count({ where: { eventId: event.id } })).toBe(0);
    // サイドはカスケードで消える(手で消していない)。
    expect(
      await prisma.eventMatchSide.count({ where: { match: { eventId: event.id } } })
    ).toBe(0);
    const reopened = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(reopened.finalizedAt).toBeNull();
  });

  it("何も進行していなくてもイベント名の入力が要る", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });

    await expect(destroyBracket(event.id, {})).rejects.toMatchObject({
      code: "CONFIRM_MISMATCH",
    });
    expect(await prisma.eventMatch.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("表が無くても確認は要求し、最終集計は勝手にやり直させない", async () => {
    // 空撃ちで finalizedAt が外れると、確定済みのイベントが再集計へ戻ってしまう。
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const finalizedAt = new Date();
    await prisma.event.update({ where: { id: event.id }, data: { finalizedAt } });

    await expect(destroyBracket(event.id, {})).rejects.toMatchObject({
      code: "CONFIRM_MISMATCH",
    });

    await expect(destroyBracket(event.id, { confirm: title })).resolves.toMatchObject({
      destroyed: 0,
    });
    const still = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(still.finalizedAt).not.toBeNull();
  });

  it("参加者が2組未満に減っていても破棄できる", async () => {
    // createBracket が永久に通らない状態でも古い表を消せること。
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });
    await prisma.eventParticipant.update({
      where: { id: b.id },
      data: { status: "REMOVED" },
    });

    await expect(destroyBracket(event.id, { confirm: title })).resolves.toMatchObject({
      destroyed: 1,
    });
    expect(await prisma.eventMatch.count({ where: { eventId: event.id } })).toBe(0);
  });
});

describe("時間枠を過ぎた表が永久にブロックされない", () => {
  it("出場者が未確定の枠は NO_SHOW にならず、そのまま作り直せる", async () => {
    // 1回戦の開始が過去(= 時間枠切れ)の表を作り、集計を1周させる。
    // 以前はこの周回で2回戦以降まで NO_SHOW になり、以後その表は
    // 「進行済み」と判定されて二度と作り直せなくなっていた。
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id],
      firstRoundStartAt: ROUND1_START,
      matchWindowMin: 60,
    });

    await aggregateEvent(event.id);

    const matches = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      orderBy: [{ round: "asc" }, { bracketPosition: "asc" }],
      select: { round: true, status: true, winnerDecidedBy: true },
    });

    // 1回戦の実試合は時間枠が実際に過ぎているので NO_SHOW でよい(仕様)。
    const realRound1 = matches.filter((m) => m.round === 1 && m.winnerDecidedBy !== "BYE");
    expect(realRound1.every((m) => m.status === "NO_SHOW")).toBe(true);

    // 2回戦は「まだ相手が決まっていない」だけ。検知待ちのまま残ること。
    const round2 = matches.filter((m) => m.round === 2);
    expect(round2.length).toBeGreaterThan(0);
    expect(round2.every((m) => m.status === "SCHEDULED")).toBe(true);

    // そしてこの状態から確認なしで作り直せること(永久ブロックの回帰)。
    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id, c.id],
        firstRoundStartAt: ROUND1_START,
        matchWindowMin: 60,
      })
    ).resolves.toMatchObject({ matches: expect.any(Number) });
  });
});

describe("締切後に表を作り直しても進行が止まらない", () => {
  it("勝者を下流へ送った周回では最終集計にしない", async () => {
    // 検知(detectMatches)は進行(resolveMatchResults)より先に走るので、1周で進むのは
    // 1ラウンドだけ。締切後にそのまま finalizedAt を立てると、2回戦以降が
    // 永久に SCHEDULED のまま取り残される。
    const event = await newPastTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id],
      firstRoundStartAt: PAST_ROUND1_START,
      matchWindowMin: 30,
      roundIntervalMin: 45,
    });

    // 1周目: 不戦勝の勝者が2回戦へ送られる = 進行があったので確定しない。
    await aggregateEvent(event.id);
    const afterFirst = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(afterFirst.finalizedAt).toBeNull();

    // 2周目: 転送は冪等なので進行が起きない = ここで最終集計になる。
    await aggregateEvent(event.id);
    const afterSecond = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(afterSecond.finalizedAt).not.toBeNull();
  });
});
