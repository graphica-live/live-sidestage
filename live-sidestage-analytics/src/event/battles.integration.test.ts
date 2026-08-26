// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// public.gifts / public.tiktok_battles を直接読むので、
// `npm run db:push:local` 済みのDBが要る。
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";
import { aggregateEvent } from "./aggregate";
import { loadBattleRangesByRoom } from "./battles";
import { BracketError, createBracket, destroyBracket } from "./tournament";

// **このファイルに `vi.mock()` を足さないこと。** route handler を直接叩くために
// `vi.mock("next-auth")` を置いたところ、**同じ vitest ワーカープロセスに相乗りした
// 別のテストファイルまでモックが漏れて**、`src/app/api/mobile/listener-status` と
// `src/lib/tiktok-room-cleanup` の integration テストが数回に1回落ちるようになった
// (モックを外すと安定して通る)。
//
// 進行(`advanceBracket`)そのものの検証は DB を使わない `advance-bracket.test.ts` にある。

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

/**
 * 観測済みのバトル行を後から書き換える。**(roomId, battleId) は一意**なので
 * insertBattle を重ねられない。「進行中に見えていたバトルが、あとで途中終了だと分かる」
 * という実際の発生順を再現するのに使う。
 */
async function updateBattle(params: {
  roomId: string;
  battleId: string;
  action: number;
  /** 終了時刻。省略しない — 途中終了は「終了を観測した」状態なので必ず入る */
  endedAt: Date | null;
}) {
  await prisma.$executeRaw`
    UPDATE public.tiktok_battles
    SET action = ${params.action}, "endedAt" = ${params.endedAt}, "updatedAt" = NOW()
    WHERE "roomId" = ${params.roomId} AND "battleId" = ${params.battleId}
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
      // 対戦は開催日程へ割り当てる。外枠と同じ区間を1件だけ持たせる。
      sessions: { create: [{ startAt: START, endAt: END }] },
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
      sessions: { create: [{ startAt: PAST_START, endAt: PAST_END }] },
    },
    select: { id: true },
  });
  createdEventIds.push(event.id);
  return event;
}

/**
 * イベントの日程を過去の1時間へ縮める。**NO_SHOW は日程が終わって初めて付く**ので、
 * 「検知できないまま終わった」状態を作るのに要る。外枠(startAt/endAt)は動かさない
 * (集計対象・締切の判定は外枠で決まるため、締切前のまま何度でも再集計させたい)。
 */
async function endSessionInThePast(eventId: string) {
  const past = new Date(NOW - 2 * 86_400_000);
  await prisma.eventSession.updateMany({
    where: { eventId },
    data: { startAt: past, endAt: new Date(past.getTime() + 3_600_000) },
  });
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

  it("日程が終わっても検知できなければ未実施になる", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
    });
    // 割り当て先の日程を過去にする(= 検知できないまま終わった)。
    await endSessionInThePast(event.id);

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirst({ where: { eventId: event.id, round: 1 } });
    expect(match?.status).toBe("NO_SHOW");
  });

  it("日程の外で終わったバトルはどのカードにも付かない", async () => {
    // 日程の終わりをまたいで終わったバトルは対戦として扱わない(主催者への案内どおり)。
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const sessionEnd = new Date(NOW - 86_400_000);
    await prisma.eventSession.updateMany({
      where: { eventId: event.id },
      data: { startAt: new Date(sessionEnd.getTime() - 3_600_000), endAt: sessionEnd },
    });

    // 日程の終わり5分前に始まり、終わった時にはもう日程の外。
    const battleId = `${PREFIX}_out_${uniqueSuffix()}`;
    const battleStart = new Date(sessionEnd.getTime() - 5 * 60_000);
    const battleEnd = new Date(sessionEnd.getTime() + 5 * 60_000);
    await insertBattle({ roomId: a.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });
    await insertBattle({ roomId: b.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirst({ where: { eventId: event.id, round: 1 } });
    expect(match?.detectedBattleId).toBeNull();
    // 日程は終わっているので未実施として残る(主催者が手で確定する)。
    expect(match?.status).toBe("NO_SHOW");
  });

  it("終了を観測できていないバトルは暫定関連(LIVE)にとどめ、勝敗を出さない", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const battleId = `${PREFIX}_open_${uniqueSuffix()}`;
    await insertBattle({ roomId: a.roomId, battleId, startedAt: BATTLE_START, endedAt: null });
    await insertBattle({ roomId: b.roomId, battleId, startedAt: BATTLE_START, endedAt: null });
    await insertGift({ roomId: a.roomId, uniqueId: "l1", diamonds: 500, receivedAt: GIFT_AT });

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirst({ where: { eventId: event.id, round: 1 } });
    expect(match?.status).toBe("LIVE");
    expect(match?.detectedBattleId).toBe(battleId);
    // **終了時刻を捏造しない。** 決着していないので勝者もライフ用の時刻も出さない。
    expect(match?.detectedEndAt).toBeNull();
    expect(match?.detectedEndSource).toBeNull();
    expect(match?.decidedAt).toBeNull();
    expect(match?.winnerSideId).toBeNull();
  });

  it("終了未確定のまま日程が終わったら要確認へ落とす", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const sessionEnd = new Date(NOW - 86_400_000);
    await prisma.eventSession.updateMany({
      where: { eventId: event.id },
      data: { startAt: new Date(sessionEnd.getTime() - 3_600_000), endAt: sessionEnd },
    });

    const battleId = `${PREFIX}_openend_${uniqueSuffix()}`;
    const battleStart = new Date(sessionEnd.getTime() - 30 * 60_000);
    await insertBattle({ roomId: a.roomId, battleId, startedAt: battleStart, endedAt: null });
    await insertBattle({ roomId: b.roomId, battleId, startedAt: battleStart, endedAt: null });

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirst({ where: { eventId: event.id, round: 1 } });
    expect(match?.status).toBe("NEEDS_REVIEW");
    expect((match?.rules as { reviewReason?: string })?.reviewReason).toBe("END_UNKNOWN");
    expect(match?.detectedEndAt).toBeNull();
  });

  it("同じ組み合わせのバトルが日程内に複数あれば自動確定しない", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    for (const offset of [0, 60 * 60_000]) {
      const battleId = `${PREFIX}_dup_${uniqueSuffix()}`;
      const start = new Date(BATTLE_START.getTime() + offset);
      const end = new Date(BATTLE_END.getTime() + offset);
      await insertBattle({ roomId: a.roomId, battleId, startedAt: start, endedAt: end });
      await insertBattle({ roomId: b.roomId, battleId, startedAt: start, endedAt: end });
    }
    await insertGift({ roomId: a.roomId, uniqueId: "l1", diamonds: 500, receivedAt: GIFT_AT });

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirst({ where: { eventId: event.id, round: 1 } });
    expect(match?.status).toBe("NEEDS_REVIEW");
    expect((match?.rules as { reviewReason?: string })?.reviewReason).toBe("AMBIGUOUS");
    expect(match?.winnerSideId).toBeNull();
  });

  it("暫定関連は候補から外れたら解除される", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const battleId = `${PREFIX}_retract_${uniqueSuffix()}`;
    await insertBattle({ roomId: a.roomId, battleId, startedAt: BATTLE_START, endedAt: null });
    await insertBattle({ roomId: b.roomId, battleId, startedAt: BATTLE_START, endedAt: null });
    await aggregateEvent(event.id);
    expect(
      (await prisma.eventMatch.findFirst({ where: { eventId: event.id, round: 1 } }))?.status
    ).toBe("LIVE");

    // 実際の終了が判明し、それが日程の外だった。
    const outside = new Date(END.getTime() + 3_600_000);
    await prisma.detectedBattle.updateMany({ where: { battleId }, data: { endedAt: outside } });
    await prisma.$executeRaw`
      UPDATE public.tiktok_battles SET "endedAt" = ${outside} WHERE "battleId" = ${battleId}
    `;

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirst({ where: { eventId: event.id, round: 1 } });
    expect(match?.detectedBattleId).toBeNull();
    expect(match?.status).toBe("SCHEDULED");
  });

  it("トーナメントはバトル中のギフトだけを集計し、BATTLE倍率がかかる", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    // 対戦に出ていない参加者。同時刻にギフトを受けても1ダイヤも計上されない。
    const c = await newParticipant(event.id, "c");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
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
    // 同時刻でもバトルに出ていない c は集計対象外。**行は残る**(順位表から消さない)。
    expect(forC).toBeDefined();
    expect(forC?.diamonds).toBe(0n);
    expect(String(forC?.points)).toBe("0");
  });

  it("バトル区間の外のギフトは順位にもリスナー貢献にも入らない", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const battleId = `${PREFIX}_m1_${uniqueSuffix()}`;
    await insertBattle({
      roomId: a.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: BATTLE_END,
    });
    await insertBattle({
      roomId: b.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: BATTLE_END,
    });

    // 同じリスナーが、バトル中(100)とバトル外(900)に投げる。
    await insertGift({ roomId: a.roomId, uniqueId: "listener1", diamonds: 100, receivedAt: GIFT_AT });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "listener1",
      diamonds: 900,
      receivedAt: new Date(BATTLE_END.getTime() + 30 * 60_000),
    });
    // 境界のギフト: 開始ちょうどは含み、終了ちょうどは含まない(半開区間)。
    await insertGift({ roomId: a.roomId, uniqueId: "edge", diamonds: 7, receivedAt: BATTLE_START });
    await insertGift({ roomId: a.roomId, uniqueId: "edge", diamonds: 500, receivedAt: BATTLE_END });

    await aggregateEvent(event.id);
    await aggregateEvent(event.id);

    const standing = await prisma.eventStanding.findFirstOrThrow({
      where: { eventId: event.id, subjectType: "PARTICIPANT", subjectId: a.id },
    });
    expect(standing.diamonds).toBe(107n);

    const listener = await prisma.eventContribution.findFirstOrThrow({
      where: { eventId: event.id, scope: "EVENT", listenerUniqueId: "listener1" },
    });
    expect(listener.diamonds).toBe(100n);

    const edge = await prisma.eventContribution.findFirstOrThrow({
      where: { eventId: event.id, scope: "EVENT", listenerUniqueId: "edge" },
    });
    expect(edge.diamonds).toBe(7n);
  });

  it("トーナメントではSOLO_STREAM(枠投げ)倍率が一切効かない", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });
    await prisma.eventMultiplier.create({
      data: { eventId: event.id, kind: "SOLO_STREAM", factor: "3.00" },
    });

    const battleId = `${PREFIX}_m1_${uniqueSuffix()}`;
    await insertBattle({
      roomId: a.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: BATTLE_END,
    });
    await insertBattle({
      roomId: b.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: BATTLE_END,
    });
    await insertGift({ roomId: a.roomId, uniqueId: "listener1", diamonds: 100, receivedAt: GIFT_AT });

    await aggregateEvent(event.id);
    await aggregateEvent(event.id);

    const standing = await prisma.eventStanding.findFirstOrThrow({
      where: { eventId: event.id, subjectType: "PARTICIPANT", subjectId: a.id },
    });
    // 枠投げ倍率は BATTLE 区間には効かないので等倍のまま。
    expect(standing.diamonds).toBe(100n);
    expect(String(standing.points)).toBe("100");
  });

  it("集計方式(aggregationPolicy)を記録する", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    await aggregateEvent(event.id);

    const row = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { aggregationPolicy: true },
    });
    expect(row.aggregationPolicy).toBe("BATTLE_ONLY");
  });

  it("VOIDにした対戦の区間は集計されない", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const battleId = `${PREFIX}_m1_${uniqueSuffix()}`;
    await insertBattle({
      roomId: a.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: BATTLE_END,
    });
    await insertBattle({
      roomId: b.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: BATTLE_END,
    });
    await insertGift({ roomId: a.roomId, uniqueId: "listener1", diamonds: 100, receivedAt: GIFT_AT });

    await aggregateEvent(event.id);
    await aggregateEvent(event.id);
    const before = await prisma.eventStanding.findFirstOrThrow({
      where: { eventId: event.id, subjectType: "PARTICIPANT", subjectId: a.id },
    });
    expect(before.diamonds).toBe(100n);

    // 主催者が対戦を無効にすると、その区間は BATTLE 区間ではなくなる。
    await prisma.eventMatch.updateMany({
      where: { eventId: event.id, round: 1 },
      data: { status: "VOID", winnerSideId: null, winnerDecidedBy: null, decidedAt: null },
    });
    await aggregateEvent(event.id);

    const after = await prisma.eventStanding.findFirstOrThrow({
      where: { eventId: event.id, subjectType: "PARTICIPANT", subjectId: a.id },
    });
    expect(after.diamonds).toBe(0n);
  });

  it("終了が未観測のうちは0点、終了が判明したら遡って加算される", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const battleId = `${PREFIX}_m1_${uniqueSuffix()}`;
    // 開始だけ観測。durationSec も無いので detectedEndAt は null のまま(LIVE)。
    await insertBattle({
      roomId: a.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: null,
      action: BATTLE_ACTION.OPEN,
    });
    await insertBattle({
      roomId: b.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: null,
      action: BATTLE_ACTION.OPEN,
    });
    await insertGift({ roomId: a.roomId, uniqueId: "listener1", diamonds: 100, receivedAt: GIFT_AT });

    await aggregateEvent(event.id);
    await aggregateEvent(event.id);
    const during = await prisma.eventStanding.findFirstOrThrow({
      where: { eventId: event.id, subjectType: "PARTICIPANT", subjectId: a.id },
    });
    // 区間が確定していないので、バトル中に飛んだギフトもまだ入らない。
    expect(during.diamonds).toBe(0n);

    // 終了イベントが届く。
    await updateBattle({
      roomId: a.roomId,
      battleId,
      action: BATTLE_ACTION.FINISH,
      endedAt: BATTLE_END,
    });
    await updateBattle({
      roomId: b.roomId,
      battleId,
      action: BATTLE_ACTION.FINISH,
      endedAt: BATTLE_END,
    });
    await aggregateEvent(event.id);

    const after = await prisma.eventStanding.findFirstOrThrow({
      where: { eventId: event.id, subjectType: "PARTICIPANT", subjectId: a.id },
    });
    expect(after.diamonds).toBe(100n);
  });

  it("不戦勝は検知を待たずに次のラウンドへ進む", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id],
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

  it("途中終了(CUT_SHORT)したバトルは関連づけず、日程が終われば NO_SHOW になる", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });
    await endSessionInThePast(event.id);

    const battleId = `${PREFIX}_cs1_${uniqueSuffix()}`;
    for (const roomId of [a.roomId, b.roomId]) {
      await insertBattle({
        roomId,
        battleId,
        startedAt: BATTLE_START,
        endedAt: BATTLE_END,
        action: BATTLE_ACTION.CUT_SHORT,
      });
    }

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
    });
    expect(match.status).toBe("NO_SHOW");
    expect(match.detectedBattleId).toBeNull();
  });

  it("durationから終了時刻を持つLIVEも、途中終了と判明したら解除する", async () => {
    // OPEN で duration が取れると、終了を観測する前でも「将来の detectedEndAt を持つ
    // LIVE」になる。解除条件を detectedEndAt === null に限ると、この形が LIVE のまま
    // BATTLE 倍率区間と公開スコアに残り続ける。
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const battleId = `${PREFIX}_cs2_${uniqueSuffix()}`;
    const startedAt = new Date(NOW - 60_000);
    for (const roomId of [a.roomId, b.roomId]) {
      await insertBattle({
        roomId,
        battleId,
        startedAt,
        endedAt: null,
        durationSec: 300,
        action: BATTLE_ACTION.OPEN,
      });
    }

    await aggregateEvent(event.id);
    const live = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
    });
    expect(live.status).toBe("LIVE");
    expect(live.detectedEndAt).not.toBeNull();

    for (const roomId of [a.roomId, b.roomId]) {
      await updateBattle({
        roomId,
        battleId,
        action: BATTLE_ACTION.CUT_SHORT,
        endedAt: new Date(NOW - 30_000),
      });
    }
    await aggregateEvent(event.id);

    const after = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
    });
    expect(after.status).toBe("SCHEDULED");
    expect(after.detectedBattleId).toBeNull();
    expect(after.detectedEndAt).toBeNull();
  });

  it("途中終了と判明したバトルに紐づく DETECTED の対戦を解除する", async () => {
    // DETECTED は「集計で勝者を決める段階」であって確定ではない。
    // LOCKED_DETECTION_STATUSES に入っていることを確定済みの根拠にしないこと。
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    // ギフトを入れない = 0対0なので勝者は決まらず DETECTED に留まる。
    const battleId = `${PREFIX}_cs3_${uniqueSuffix()}`;
    for (const roomId of [a.roomId, b.roomId]) {
      await insertBattle({ roomId, battleId, startedAt: BATTLE_START, endedAt: BATTLE_END });
    }
    await aggregateEvent(event.id);
    expect(
      (await prisma.eventMatch.findFirstOrThrow({ where: { eventId: event.id, round: 1 } })).status
    ).toBe("DETECTED");

    for (const roomId of [a.roomId, b.roomId]) {
      await updateBattle({
        roomId,
        battleId,
        action: BATTLE_ACTION.CUT_SHORT,
        endedAt: BATTLE_END,
      });
    }
    await aggregateEvent(event.id);

    const after = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
    });
    expect(after.status).toBe("SCHEDULED");
    expect(after.detectedBattleId).toBeNull();
  });

  it("途中終了と判明したバトルに紐づく NEEDS_REVIEW を解除し、他のrulesは残す", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    // 片側の room しか観測できていない = partial。承認待ちで止まる。
    const battleId = `${PREFIX}_cs4_${uniqueSuffix()}`;
    await insertBattle({
      roomId: a.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: BATTLE_END,
    });
    await aggregateEvent(event.id);
    const review = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
    });
    expect(review.status).toBe("NEEDS_REVIEW");
    expect((review.rules as { reviewReason?: string }).reviewReason).toBe("PARTIAL");

    await updateBattle({
      roomId: a.roomId,
      battleId,
      action: BATTLE_ACTION.CUT_SHORT,
      endedAt: BATTLE_END,
    });
    await aggregateEvent(event.id);

    const after = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
    });
    expect(after.status).toBe("SCHEDULED");
    const rules = after.rules as { reviewReason?: string; roundLabel?: string };
    expect(rules.reviewReason).toBeUndefined();
    // reviewReason だけを消す。ラウンド名まで潰さない。
    expect(rules.roundLabel).toBeTruthy();
  });

  it("途中終了と判明したLIVEは、同じ日程の正常終了バトルへ同じ周回で付け替わる", async () => {
    // LIVE は LOCKED_DETECTION_STATUSES に入らないので、母集団から外した周回でそのまま
    // 別のバトルへ付け替わる。解除条件に !assigned を効かせないと、この付け替えを
    // 直後に巻き戻してしまう。
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const cutShortId = `${PREFIX}_cs5a_${uniqueSuffix()}`;
    for (const roomId of [a.roomId, b.roomId]) {
      await insertBattle({
        roomId,
        battleId: cutShortId,
        startedAt: new Date(NOW - 60_000),
        endedAt: null,
        durationSec: 300,
        action: BATTLE_ACTION.OPEN,
      });
    }
    await aggregateEvent(event.id);
    expect(
      (await prisma.eventMatch.findFirstOrThrow({ where: { eventId: event.id, round: 1 } })).status
    ).toBe("LIVE");

    // 切り上げられたあと、同じ日程で本番のバトルをやり直した。
    for (const roomId of [a.roomId, b.roomId]) {
      await updateBattle({
        roomId,
        battleId: cutShortId,
        action: BATTLE_ACTION.CUT_SHORT,
        endedAt: new Date(NOW - 30_000),
      });
    }
    const realId = `${PREFIX}_cs5b_${uniqueSuffix()}`;
    for (const roomId of [a.roomId, b.roomId]) {
      await insertBattle({ roomId, battleId: realId, startedAt: BATTLE_START, endedAt: BATTLE_END });
    }
    await aggregateEvent(event.id);

    const after = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
    });
    expect(after.detectedBattleId).toBe(realId);
    expect(after.status).toBe("DETECTED");
  });

  it("AGGREGATEで確定済みの対戦は、途中終了と判明しても維持する", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const battleId = `${PREFIX}_cs6_${uniqueSuffix()}`;
    for (const roomId of [a.roomId, b.roomId]) {
      await insertBattle({ roomId, battleId, startedAt: BATTLE_START, endedAt: BATTLE_END });
    }
    await insertGift({
      roomId: a.roomId,
      uniqueId: "listener1",
      diamonds: 500,
      receivedAt: GIFT_AT,
    });
    await aggregateEvent(event.id);
    const finished = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
    });
    expect(finished.status).toBe("FINISHED");

    for (const roomId of [a.roomId, b.roomId]) {
      await updateBattle({
        roomId,
        battleId,
        action: BATTLE_ACTION.CUT_SHORT,
        endedAt: BATTLE_END,
      });
    }
    await aggregateEvent(event.id);

    const after = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
    });
    expect(after.status).toBe("FINISHED");
    expect(after.winnerSideId).toBe(finished.winnerSideId);
    expect(after.detectedBattleId).toBe(battleId);
  });

  it("主催者が手動確定した対戦は、途中終了と判明しても維持する", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const battleId = `${PREFIX}_cs7_${uniqueSuffix()}`;
    for (const roomId of [a.roomId, b.roomId]) {
      await insertBattle({
        roomId,
        battleId,
        startedAt: BATTLE_START,
        endedAt: BATTLE_END,
        action: BATTLE_ACTION.CUT_SHORT,
      });
    }
    const matchId = await finishFirstMatch(event.id);

    await aggregateEvent(event.id);

    const after = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(after.status).toBe("FINISHED");
    expect(after.winnerDecidedBy).toBe("MANUAL");
  });

  it("解除した対戦は検知フィールド・サイドのスコア・BATTLE倍率区間から消える", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const battleId = `${PREFIX}_cs9_${uniqueSuffix()}`;
    for (const roomId of [a.roomId, b.roomId]) {
      await insertBattle({ roomId, battleId, startedAt: BATTLE_START, endedAt: BATTLE_END });
    }
    // 同額 = 同点なので勝者は決まらず DETECTED のまま。サイドのダイヤだけ入る。
    await insertGift({ roomId: a.roomId, uniqueId: "l1", diamonds: 500, receivedAt: GIFT_AT });
    await insertGift({ roomId: b.roomId, uniqueId: "l2", diamonds: 500, receivedAt: GIFT_AT });
    await aggregateEvent(event.id);

    const before = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
      include: { sides: true },
    });
    expect(before.status).toBe("DETECTED");
    expect(before.sides.some((s) => s.diamonds > 0n)).toBe(true);
    expect((await loadBattleRangesByRoom(prisma, event.id)).size).toBeGreaterThan(0);

    for (const roomId of [a.roomId, b.roomId]) {
      await updateBattle({
        roomId,
        battleId,
        action: BATTLE_ACTION.CUT_SHORT,
        endedAt: BATTLE_END,
      });
    }
    await aggregateEvent(event.id);

    const after = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
      include: { sides: true },
    });
    expect(after.detectedStartAt).toBeNull();
    expect(after.decidedAt).toBeNull();
    expect(after.sides.every((s) => s.diamonds === 0n)).toBe(true);
    expect((await loadBattleRangesByRoom(prisma, event.id)).size).toBe(0);
  });

  it("一部のroomだけが途中終了を観測していても除外する", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });
    await endSessionInThePast(event.id);

    const battleId = `${PREFIX}_cs10_${uniqueSuffix()}`;
    await insertBattle({
      roomId: a.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: BATTLE_END,
    });
    await insertBattle({
      roomId: b.roomId,
      battleId,
      startedAt: BATTLE_START,
      endedAt: BATTLE_END,
      action: BATTLE_ACTION.CUT_SHORT,
    });

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
    });
    expect(match.status).toBe("NO_SHOW");
  });

  it("lastActionがUNKNOWN(0)のバトルは従来どおり候補にする", async () => {
    // 判定できないものまで落とすと、古い観測行が一斉に検知から外れる(fail-open)。
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const battleId = `${PREFIX}_cs11_${uniqueSuffix()}`;
    for (const roomId of [a.roomId, b.roomId]) {
      await insertBattle({
        roomId,
        battleId,
        startedAt: BATTLE_START,
        endedAt: BATTLE_END,
        action: BATTLE_ACTION.UNKNOWN,
      });
    }

    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
    });
    expect(match.detectedBattleId).toBe(battleId);
  });
});

describe("トーナメント表は作り直さず、破棄してから作る", () => {
  it("表があるイベントでは、何も進行していなくても作成を拒否する", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    // 参加3人 = 2のべき乗でないので1回戦にBYEが入り、その場でFINISHEDへ自動確定する。
    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id],
    });
    const before = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });

    // 不戦勝しか確定していない = 失う結果は無いが、それでも作成は通さない。
    // **表を消すのは破棄(destroyBracket)だけの仕事**にしてある。
    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id, c.id].reverse(),
      })
    ).rejects.toMatchObject({ code: "BRACKET_EXISTS" });

    const after = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });
    expect(after.map((m) => m.id).sort()).toEqual(before.map((m) => m.id).sort());
  });

  it("主催者が手動確定した対戦があっても、拒否の理由は同じ", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
    });

    const match = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1 },
      include: { sides: true },
    });
    await prisma.eventMatch.update({
      where: { id: match.id },
      data: { status: "FINISHED", winnerSideId: match.sides[0].id, winnerDecidedBy: "MANUAL" },
    });

    // 進行状態で理由を出し分けない。主催者がすることは「先に破棄する」の1つだけ。
    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
      })
    ).rejects.toMatchObject({ code: "BRACKET_EXISTS" });
  });

  it("NO_SHOW だけの表は破棄して作り直せる", async () => {
    // 1回戦の開始を過去に置くと、集計の周回で NO_SHOW が付く。これを「進行済み」と
    // 数えていたせいで、その表は二度と作り直せなくなっていた。破棄はイベント名さえ
    // 合えば通るので、この状態でも作り直しへ抜けられる。
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
    });
    await prisma.eventMatch.updateMany({
      where: { eventId: event.id },
      data: { status: "NO_SHOW" },
    });

    await expect(destroyBracket(event.id, { confirm: title })).resolves.toMatchObject({
      destroyed: 1,
    });
    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
      })
    ).resolves.toMatchObject({ matches: 1 });
  });

  it("VOID だけの表は破棄して作り直せる", async () => {
    // 「作り直すには対戦を無効にすること」と案内しておきながら、無効にすると
    // 永久にブロックされる状態だった。
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
    });
    await prisma.eventMatch.updateMany({
      where: { eventId: event.id },
      data: { status: "VOID" },
    });

    await expect(destroyBracket(event.id, { confirm: title })).resolves.toMatchObject({
      destroyed: 1,
    });
    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
      })
    ).resolves.toMatchObject({ matches: 1 });
  });

  it("破棄してから作れば作り直せる。表が無いあいだの最終集計も巻き戻す", async () => {
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
    });
    const before = await finishFirstMatch(event.id);

    await expect(destroyBracket(event.id, { confirm: title })).resolves.toMatchObject({
      destroyed: 1,
    });

    // **破棄と作成は別のトランザクションになった。** その隙にワーカーが「対戦0件の
    // イベント」として最終集計を終えることがあるので、作成側でも巻き戻す必要がある。
    await prisma.event.update({
      where: { id: event.id },
      data: { finalizedAt: new Date() },
    });

    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
      })
    ).resolves.toMatchObject({ matches: 1 });

    const after = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      select: { id: true, status: true },
    });
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(before);
    expect(after[0].status).toBe("SCHEDULED");
    const reopened = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(reopened.finalizedAt).toBeNull();
  });

  it("同時に2つ作成しても、成功するのは片方だけ", async () => {
    // 存在確認は advisory lock の内側でやる。外でやると、2つのリクエストが
    // どちらも「表は無い」と読んで2組ぶんの表が重なる。
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    const results = await Promise.allSettled([
      createBracket({ eventId: event.id, entrantIds: [a.id, b.id] }),
      createBracket({ eventId: event.id, entrantIds: [b.id, a.id] }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "BRACKET_EXISTS",
    });
    expect(await prisma.eventMatch.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("作成が日程の指定不正で失敗したら、何も書き込まない", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const finalizedAt = new Date();
    await prisma.event.update({ where: { id: event.id }, data: { finalizedAt } });

    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id],
        // このイベントに無い日程。planRoundSessions が通らない。
        roundSessionIds: ["not-a-session-of-this-event"],
      })
    ).rejects.toMatchObject({ code: "INVALID_SESSION" });

    expect(await prisma.eventMatch.count({ where: { eventId: event.id } })).toBe(0);
    // 失敗した作成で最終集計を巻き戻さない(確定済みのイベントが再集計へ戻ってしまう)。
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
    });

    await expect(destroyBracket(event.id, {})).rejects.toMatchObject({
      code: "CONFIRM_MISMATCH",
    });
    expect(await prisma.eventMatch.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("イベント名が一致しなければ拒否し、既存の表と結果を残す", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
    });
    const kept = await finishFirstMatch(event.id);

    await expect(
      destroyBracket(event.id, { confirm: "まったく違うイベント名" })
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
    });
    await finishFirstMatch(event.id);
    await prisma.event.update({
      where: { id: event.id },
      data: { title: `${oldTitle} 改` },
    });

    await expect(destroyBracket(event.id, { confirm: oldTitle })).rejects.toMatchObject({
      code: "CONFIRM_MISMATCH",
    });
    expect(await prisma.eventMatch.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("表が入れ替わっていたら BRACKET_CHANGED で拒否する", async () => {
    // 別タブが作り直した表を、古い画面の破棄リクエストが消さないようにする。
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id],
    });
    const staleIds = (
      await prisma.eventMatch.findMany({ where: { eventId: event.id }, select: { id: true } })
    ).map((m) => m.id);

    // 別タブが破棄して作り直す。
    await destroyBracket(event.id, { confirm: title });
    await createBracket({ eventId: event.id, entrantIds: [b.id, a.id] });
    const current = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });

    await expect(
      destroyBracket(event.id, { confirm: title, expectedMatchIds: staleIds })
    ).rejects.toMatchObject({ code: "BRACKET_CHANGED" });

    const after = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });
    expect(after.map((m) => m.id).sort()).toEqual(current.map((m) => m.id).sort());
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

describe("日程が終わった表が永久にブロックされない", () => {
  it("出場者が未確定の枠は NO_SHOW にならず、破棄して作り直せる", async () => {
    // 日程が終わった表を作り、集計を1周させる。
    // 以前はこの周回で2回戦以降まで NO_SHOW になり、以後その表は
    // 「進行済み」と判定されて二度と作り直せなくなっていた。
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id],
    });
    await endSessionInThePast(event.id);

    await aggregateEvent(event.id);

    const matches = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      orderBy: [{ round: "asc" }, { bracketPosition: "asc" }],
      select: { round: true, status: true, winnerDecidedBy: true },
    });

    // 1回戦の実試合は日程が実際に終わっているので NO_SHOW でよい(仕様)。
    const realRound1 = matches.filter((m) => m.round === 1 && m.winnerDecidedBy !== "BYE");
    expect(realRound1.every((m) => m.status === "NO_SHOW")).toBe(true);

    // 2回戦は「まだ相手が決まっていない」だけ。検知待ちのまま残ること。
    const round2 = matches.filter((m) => m.round === 2);
    expect(round2.length).toBeGreaterThan(0);
    expect(round2.every((m) => m.status === "SCHEDULED")).toBe(true);

    // そしてこの状態から破棄 → 作成で作り直せること(永久ブロックの回帰)。
    await expect(destroyBracket(event.id, { confirm: title })).resolves.toMatchObject({
      destroyed: matches.length,
    });
    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: [a.id, b.id, c.id],
      })
    ).resolves.toMatchObject({ matches: expect.any(Number) });
  });
});

describe("締切後に表を作り直しても進行が止まらない", () => {
  it("不戦勝の勝者は表を作った時点で次のラウンドへ入る", async () => {
    // **転送を集計ワーカー任せにしない。** ワーカーは開催前(SCHEDULED)のイベントを
    // 対象にしない(`aggregationWindow`)ので、事前に組んだ表が永久に進まなくなる。
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id],
    });

    // **集計を1周も回していない状態で**決勝の片側が埋まっていること。
    const final = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 2 },
      select: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { participants: { select: { participantId: true } } },
        },
      },
    });
    expect(final.sides.filter((s) => s.participants.length > 0)).toHaveLength(1);
  });

  it("勝者を下流へ送った周回では最終集計にしない", async () => {
    // 転送そのものは1回の呼び出しで全ラウンド伝播しきるが、**新しく埋まった枠の
    // バトル検知は次の周**になる(検知は進行より先に走る)。締切後にそのまま
    // finalizedAt を立てると、2回戦以降が永久に SCHEDULED のまま取り残される。
    const event = await newPastTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id],
    });

    // 1回戦の実試合(不戦勝で自動確定していない枠)に、日程内で終わったバトルを置く。
    // これで1周目に「検知 → 勝敗確定 → 決勝へ転送」が起きる。
    const real = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1, winnerDecidedBy: null },
      select: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { participants: { select: { participant: { select: { roomId: true } } } } },
        },
      },
    });
    const rooms = real.sides.map((s) => s.participants[0].participant.roomId);
    const battleId = `${PREFIX}_defer_${uniqueSuffix()}`;
    const battleStart = new Date(PAST_ROUND1_START.getTime() + 10 * 60_000);
    const battleEnd = new Date(PAST_ROUND1_START.getTime() + 20 * 60_000);
    for (const roomId of rooms) {
      await insertBattle({ roomId, battleId, startedAt: battleStart, endedAt: battleEnd });
    }
    // 同点(0対0を含む)だと自動確定しないので、片側にだけギフトを入れる。
    await insertGift({
      roomId: rooms[0],
      uniqueId: "listener1",
      diamonds: 500,
      receivedAt: new Date(battleStart.getTime() + 60_000),
    });

    // 1周目: 実試合が確定して決勝へ送られる = 進行があったので確定しない。
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

  it("途中終了と判明して関連を解除した周回でも最終集計にしない", async () => {
    // 解除した対戦の再検知(同じ日程に残っている正常終了バトルへの付け替え)は次の周回。
    // ここで finalizedAt を立てると、そのまま SCHEDULED / NO_SHOW で固定されてしまう。
    const event = await newPastTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id] });

    const battleId = `${PREFIX}_cs12_${uniqueSuffix()}`;
    const startedAt = new Date(PAST_ROUND1_START.getTime() + 10 * 60_000);
    const endedAt = new Date(PAST_ROUND1_START.getTime() + 20 * 60_000);
    for (const roomId of [a.roomId, b.roomId]) {
      await insertBattle({ roomId, battleId, startedAt, endedAt });
    }

    // 締切後なので、進行が起きなければ1周目でそのまま最終集計になる。
    await aggregateEvent(event.id);
    expect(
      (
        await prisma.event.findUniqueOrThrow({
          where: { id: event.id },
          select: { finalizedAt: true },
        })
      ).finalizedAt
    ).not.toBeNull();

    // 主催者が期間を延ばすなどで再集計へ戻り、そこで途中終了だったと分かる。
    await prisma.event.update({ where: { id: event.id }, data: { finalizedAt: null } });
    for (const roomId of [a.roomId, b.roomId]) {
      await updateBattle({ roomId, battleId, action: BATTLE_ACTION.CUT_SHORT, endedAt });
    }

    await aggregateEvent(event.id);
    const afterRetract = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(afterRetract.finalizedAt).toBeNull();

    // 解除は冪等(detectedBattleId を消すので次周は該当しない)。ここで最終集計になる。
    await aggregateEvent(event.id);
    const settled = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(settled.finalizedAt).not.toBeNull();
  });
});

describe("手動で配置したトーナメント表", () => {
  it("置いた枠のとおりに1回戦が組まれる(シード順の振り分けをしない)", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");
    const d = await newParticipant(event.id, "d");

    // シード順(標準方式)なら1回戦は a対d / b対c になる並び。手動配置ではそうならない。
    await createBracket({
      eventId: event.id,
      placement: [a.id, b.id, c.id, d.id],
    });

    const round1 = await prisma.eventMatch.findMany({
      where: { eventId: event.id, round: 1 },
      orderBy: { bracketPosition: "asc" },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { sideIndex: true, participants: { select: { participantId: true } } },
        },
      },
    });
    expect(
      round1.map((m) => m.sides.map((s) => s.participants.map((p) => p.participantId)))
    ).toEqual([
      [[a.id], [b.id]],
      [[c.id], [d.id]],
    ]);
  });

  it("右側だけ置いた枠は、下段(sideIndex 1)のまま不戦勝で確定する", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    await createBracket({
      eventId: event.id,
      placement: [null, a.id, b.id, c.id],
    });

    const bye = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1, bracketPosition: 0 },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { id: true, sideIndex: true, participants: { select: { participantId: true } } },
        },
      },
    });
    expect(bye.status).toBe("FINISHED");
    expect(bye.winnerDecidedBy).toBe("BYE");
    expect(bye.rules).toMatchObject({ bye: true });
    // 主催者が下段へ置いたのだから、上段へ寄せ替えてはいけない。
    expect(bye.sides[0].participants).toEqual([]);
    expect(bye.sides[1].participants.map((p) => p.participantId)).toEqual([a.id]);
    expect(bye.winnerSideId).toBe(bye.sides[1].id);
  });

  it("両側が空の枝には対戦カードを作らない", async () => {
    const event = await newTournament();
    const entrants = [];
    for (const name of ["a", "b", "c", "d", "e"]) {
      entrants.push(await newParticipant(event.id, name));
    }

    // 8枠に5組。葉5〜7 が空なので、1回戦の position3 には誰も来ない。
    await createBracket({
      eventId: event.id,
      placement: [...entrants.map((p) => p.id), null, null, null],
    });

    const positions = await prisma.eventMatch.findMany({
      where: { eventId: event.id, round: 1 },
      orderBy: { bracketPosition: "asc" },
      select: { bracketPosition: true },
    });
    expect(positions.map((m) => m.bracketPosition)).toEqual([0, 1, 2]);
  });

  it("連続する不戦勝を通って決勝まで進み、勝者の転送も止まらない", async () => {
    const event = await newTournament();
    const [a, b, c, d, e] = [
      await newParticipant(event.id, "a"),
      await newParticipant(event.id, "b"),
      await newParticipant(event.id, "c"),
      await newParticipant(event.id, "d"),
      await newParticipant(event.id, "e"),
    ];

    // 8枠に5組。e は1回戦・準決勝とも不戦勝(相手が構造的に存在しない)で決勝へ上がる。
    await createBracket({
      eventId: event.id,
      placement: [a.id, b.id, c.id, d.id, e.id, null, null, null],
    });

    // a対b は実際のバトル。a が勝って2回戦へ進むところまで見る。
    const battleId = `${PREFIX}_manual_${uniqueSuffix()}`;
    await insertBattle({ roomId: a.roomId, battleId, startedAt: BATTLE_START, endedAt: BATTLE_END });
    await insertBattle({ roomId: b.roomId, battleId, startedAt: BATTLE_START, endedAt: BATTLE_END });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "listener1",
      diamonds: 500,
      receivedAt: GIFT_AT,
    });
    await insertGift({
      roomId: b.roomId,
      uniqueId: "listener2",
      diamonds: 100,
      receivedAt: GIFT_AT,
    });

    // 検知は進行より先に走るので、1周で進むのは1ラウンドだけ。決勝(3回戦)まで回す。
    for (let i = 0; i < 4; i++) await aggregateEvent(event.id);

    // e は1回戦の不戦勝 → 準決勝も不戦勝 → 決勝の下側へ。
    const semiBye = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 2, bracketPosition: 1 },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { id: true, participants: { select: { participantId: true } } },
        },
      },
    });
    expect(semiBye.status).toBe("FINISHED");
    expect(semiBye.winnerDecidedBy).toBe("BYE");
    // 不戦勝行は検知の対象にならない(部外者とのバトルを拾わない)。
    expect(semiBye.detectedBattleId).toBeNull();
    expect(semiBye.sides[0].participants.map((p) => p.participantId)).toEqual([e.id]);
    expect(semiBye.winnerSideId).toBe(semiBye.sides[0].id);

    const final = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 3, bracketPosition: 0 },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { sideIndex: true, participants: { select: { participantId: true } } },
        },
      },
    });
    expect(final.sides[1].participants.map((p) => p.participantId)).toEqual([e.id]);
    // 実試合の側はまだ c対d が終わっていないので空のまま。
    expect(final.sides[0].participants).toEqual([]);

    // a はバトルに勝って準決勝の上側へ入っている。
    const semiReal = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 2, bracketPosition: 0 },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { sideIndex: true, participants: { select: { participantId: true } } },
        },
      },
    });
    expect(semiReal.sides[0].participants.map((p) => p.participantId)).toEqual([a.id]);
  });

  it("枠数が配置数に見合わない配置は拒否する", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    // 2組しか置いていないのに8枠。疎で不戦勝だらけの表を作らせない。
    await expect(
      createBracket({
        eventId: event.id,
        placement: [a.id, null, null, null, b.id, null, null, null],
      })
    ).rejects.toMatchObject({ code: "INVALID_PLACEMENT" });

    expect(await prisma.eventMatch.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("このイベントに存在しないエントリーを置いたら拒否する", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");

    await expect(
      createBracket({
        eventId: event.id,
        placement: [a.id, `${PREFIX}_unknown`],
      })
    ).rejects.toMatchObject({ code: "UNKNOWN_ENTRANT" });
  });

  it("シード順で作った表を破棄して手動配置で作り直せる", async () => {
    const event = await newTournament();
    const title = await eventTitle(event.id);
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");
    const d = await newParticipant(event.id, "d");

    await createBracket({ eventId: event.id, entrantIds: [a.id, b.id, c.id, d.id] });
    await destroyBracket(event.id, { confirm: title });

    await createBracket({
      eventId: event.id,
      placement: [b.id, c.id, a.id, d.id],
    });

    const first = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1, bracketPosition: 0 },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { participants: { select: { participantId: true } } },
        },
      },
    });
    expect(first.sides.map((s) => s.participants.map((p) => p.participantId))).toEqual([
      [b.id],
      [c.id],
    ]);
  });
});

describe("順位決定戦", () => {
  /**
   * 4人・標準方式で3位決定戦つきの表を作り、1回戦(=準決勝)を両方とも決着させる。
   *
   * 座標は R=2 なので、1回戦が (1,0) と (1,1)、決勝が (2,0)、3位決定戦が **(2,1)**。
   * 戻り値の `loserOfFirst` / `loserOfSecond` が3位決定戦に入るはずの2人。
   */
  async function tournamentWithThirdPlace() {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");
    const d = await newParticipant(event.id, "d");

    // シード順 [a,b,c,d] → 1回戦は (a,d) と (b,c)。
    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id, d.id],
      placementDepth: 1,
    });

    // (1,0): a が d に勝つ。
    const battle1 = `${PREFIX}_sf1_${uniqueSuffix()}`;
    await insertBattle({ roomId: a.roomId, battleId: battle1, startedAt: BATTLE_START, endedAt: BATTLE_END });
    await insertBattle({ roomId: d.roomId, battleId: battle1, startedAt: BATTLE_START, endedAt: BATTLE_END });
    await insertGift({ roomId: a.roomId, uniqueId: "l1", diamonds: 500, receivedAt: GIFT_AT });
    await insertGift({ roomId: d.roomId, uniqueId: "l2", diamonds: 300, receivedAt: GIFT_AT });

    // (1,1): b が c に勝つ。
    const battle2 = `${PREFIX}_sf2_${uniqueSuffix()}`;
    await insertBattle({ roomId: b.roomId, battleId: battle2, startedAt: BATTLE_START, endedAt: BATTLE_END });
    await insertBattle({ roomId: c.roomId, battleId: battle2, startedAt: BATTLE_START, endedAt: BATTLE_END });
    await insertGift({ roomId: b.roomId, uniqueId: "l3", diamonds: 400, receivedAt: GIFT_AT });
    await insertGift({ roomId: c.roomId, uniqueId: "l4", diamonds: 200, receivedAt: GIFT_AT });

    return { event, a, b, c, d };
  }

  /** (2,1) = 3位決定戦のサイドに入っている参加者ID。 */
  async function thirdPlaceSides(eventId: string): Promise<(string | null)[]> {
    const match = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId, round: 2, bracketPosition: 1 },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { participants: { select: { participantId: true } } },
        },
      },
    });
    return match.sides.map((s) => s.participants[0]?.participantId ?? null);
  }

  it("3位決定戦の行が本選と衝突しない座標に作られる", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");
    const d = await newParticipant(event.id, "d");

    const result = await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id, d.id],
      placementDepth: 1,
    });
    // 本選3件 + 3位決定戦1件
    expect(result.matches).toBe(4);

    const rows = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      orderBy: [{ round: "asc" }, { bracketPosition: "asc" }],
      select: { round: true, bracketPosition: true, rules: true },
    });
    expect(rows.map((r) => `${r.round}:${r.bracketPosition}`)).toEqual([
      "1:0",
      "1:1",
      "2:0",
      "2:1",
    ]);

    const third = rows.find((r) => r.round === 2 && r.bracketPosition === 1)!;
    expect(third.rules).toMatchObject({
      roundLabel: "3位決定戦",
      placement: { depth: 1, rank: 3 },
      loserFrom: [
        { round: 1, position: 0 },
        { round: 1, position: 1 },
      ],
    });

    // 決勝(2,0)は順位決定戦の印を持たない。
    const final = rows.find((r) => r.round === 2 && r.bracketPosition === 0)!;
    expect((final.rules as { placement?: unknown }).placement).toBeUndefined();
  });

  it("準決勝が確定すると、敗者が3位決定戦へ入る", async () => {
    const { event, c, d } = await tournamentWithThirdPlace();

    await aggregateEvent(event.id);

    // 勝者は決勝へ、敗者は3位決定戦へ。
    const final = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 2, bracketPosition: 0 },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { participants: { select: { participantId: true } } },
        },
      },
    });
    expect(final.sides.map((s) => s.participants[0]?.participantId ?? null)).toEqual([
      expect.any(String),
      expect.any(String),
    ]);

    expect(await thirdPlaceSides(event.id)).toEqual([d.id, c.id]);

    // 3位決定戦はまだバトルが起きていないので検知されない。
    const third = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 2, bracketPosition: 1 },
      select: { status: true, detectedBattleId: true },
    });
    expect(third.status).toBe("SCHEDULED");
    expect(third.detectedBattleId).toBeNull();
  });

  it("上流を無効(VOID)にすると、3位決定戦の出場者も取り消される", async () => {
    const { event, c, d } = await tournamentWithThirdPlace();
    await aggregateEvent(event.id);
    expect(await thirdPlaceSides(event.id)).toEqual([d.id, c.id]);

    await prisma.eventMatch.updateMany({
      where: { eventId: event.id, round: 1, bracketPosition: 0 },
      data: { status: "VOID", winnerSideId: null, winnerDecidedBy: null },
    });
    await aggregateEvent(event.id);

    // 敗者のいない対戦になったので、そのサイドは空へ戻る。
    expect(await thirdPlaceSides(event.id)).toEqual([null, c.id]);
  });

  it("決勝が始まっていたら、3位決定戦のほうも古いまま揃える(同じ人が両方に載らない)", async () => {
    // **転送はソース単位の all-or-nothing。** 辺ごとに判定すると、勝敗が覆ったときに
    // 「決勝は始まっているので旧勝者のまま、3位決定戦は未開始なので新しい敗者を受け取る」
    // となり、同じ参加者が決勝と3位決定戦の両方に載る。
    const { event, a, c, d } = await tournamentWithThirdPlace();
    await aggregateEvent(event.id);

    const finalBefore = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 2, bracketPosition: 0 },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { participants: { select: { participantId: true } } },
        },
      },
    });
    expect(finalBefore.sides[0].participants.map((p) => p.participantId)).toEqual([a.id]);

    // 決勝がすでに進行中。
    await prisma.eventMatch.updateMany({
      where: { eventId: event.id, round: 2, bracketPosition: 0 },
      data: { status: "DETECTED" },
    });

    // 準決勝の勝敗がひっくり返る(勝者 d / 敗者 a)。
    const semi = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1, bracketPosition: 0 },
      include: { sides: { orderBy: { sideIndex: "asc" } } },
    });
    await prisma.eventMatch.update({
      where: { id: semi.id },
      data: { winnerSideId: semi.sides[1].id, winnerDecidedBy: "MANUAL" },
    });
    await aggregateEvent(event.id);

    // 決勝は blocked のまま a。3位決定戦も追従せず d のまま。
    const finalAfter = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 2, bracketPosition: 0 },
      include: {
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { participants: { select: { participantId: true } } },
        },
      },
    });
    expect(finalAfter.sides[0].participants.map((p) => p.participantId)).toEqual([a.id]);

    const third = await thirdPlaceSides(event.id);
    expect(third).toEqual([d.id, c.id]);
    // a が決勝と3位決定戦の両方に載っていないこと。
    expect(third).not.toContain(a.id);
  });

  it("3位決定戦が始まっていたら、上流の結果が変わっても出場者を差し替えない", async () => {
    const { event, a, c, d } = await tournamentWithThirdPlace();
    await aggregateEvent(event.id);
    expect(await thirdPlaceSides(event.id)).toEqual([d.id, c.id]);

    // 3位決定戦がすでに進行中。ここで出場者を差し替えると集計対象が途中で変わる。
    await prisma.eventMatch.updateMany({
      where: { eventId: event.id, round: 2, bracketPosition: 1 },
      data: { status: "DETECTED" },
    });

    // 主催者が準決勝の勝敗をひっくり返す(敗者が a になる)。
    const semi = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 1, bracketPosition: 0 },
      include: { sides: { orderBy: { sideIndex: "asc" } } },
    });
    await prisma.eventMatch.update({
      where: { id: semi.id },
      data: { winnerSideId: semi.sides[1].id, winnerDecidedBy: "MANUAL" },
    });
    await aggregateEvent(event.id);

    // 反映されない(d のまま)。a には入れ替わらない。
    const sides = await thirdPlaceSides(event.id);
    expect(sides).toEqual([d.id, c.id]);
    expect(sides).not.toContain(a.id);
  });

  it("出場者が決まる前に行われたバトルは3位決定戦の候補にならない", async () => {
    const { event, c, d } = await tournamentWithThirdPlace();

    // 準決勝より前に、たまたま d と c が戦っていた(練習バトル等)。
    const stale = `${PREFIX}_stale_${uniqueSuffix()}`;
    const staleStart = new Date(ROUND1_START.getTime() + 60_000);
    const staleEnd = new Date(ROUND1_START.getTime() + 5 * 60_000);
    await insertBattle({ roomId: d.roomId, battleId: stale, startedAt: staleStart, endedAt: staleEnd });
    await insertBattle({ roomId: c.roomId, battleId: stale, startedAt: staleStart, endedAt: staleEnd });

    // 1周目で準決勝が決着し、敗者が3位決定戦へ入る。2周目で初めて検知の対象になる。
    await aggregateEvent(event.id);
    await aggregateEvent(event.id);

    expect(await thirdPlaceSides(event.id)).toEqual([d.id, c.id]);
    const third = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 2, bracketPosition: 1 },
      select: { status: true, detectedBattleId: true },
    });
    expect(third.detectedBattleId).toBeNull();
    expect(third.status).toBe("SCHEDULED");
  });

  it("順位決定戦を含む表も破棄して作り直せる", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");
    const d = await newParticipant(event.id, "d");

    await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id, d.id],
      placementDepth: 1,
    });

    // 破棄してから、順位決定戦なしで作り直す。
    await destroyBracket(event.id, { confirm: await eventTitle(event.id) });
    const rebuilt = await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id, d.id],
      placementDepth: 0,
    });
    expect(rebuilt.matches).toBe(3);
    expect(
      await prisma.eventMatch.count({ where: { eventId: event.id, round: 2, bracketPosition: 1 } })
    ).toBe(0);

    // 破棄も通る。
    const destroyed = await destroyBracket(event.id, { confirm: await eventTitle(event.id) });
    expect(destroyed.destroyed).toBe(3);
  });

  it("複数ラウンドのブロックが進行する(葉の不戦勝が自動確定し、その勝者が決定戦へ上がる)", async () => {
    // 7人・標準・depth=2。1回戦の実試合は3件(pos0は不戦勝)なので、5位決定戦のブロックは
    // 3人 = 「不戦勝の葉 + 実試合の葉 + 決定戦」の2ラウンド構成になる。
    //   (1,1)=第4対第5 / (1,2)=第2対第7 / (1,3)=第3対第6
    //   → (2,4) 不戦勝の葉[(1,1)の敗者] / (2,5) [(1,2)の敗者 対 (1,3)の敗者] / (3,2) 5位決定戦
    const event = await newTournament();
    const seeds = [];
    for (let i = 1; i <= 7; i++) seeds.push(await newParticipant(event.id, `p${i}`));

    await createBracket({
      eventId: event.id,
      entrantIds: seeds.map((s) => s.id),
      placementDepth: 2,
    });

    // 1回戦の実試合3件。上位シードが勝つ。
    const wins: [number, number][] = [
      [3, 4], // (1,1) 第4シード(index3) が 第5シード(index4) に勝つ
      [1, 6], // (1,2) 第2シード が 第7シード に勝つ
      [2, 5], // (1,3) 第3シード が 第6シード に勝つ
    ];
    for (const [winnerIndex, loserIndex] of wins) {
      const battleId = `${PREFIX}_r1_${uniqueSuffix()}`;
      const winner = seeds[winnerIndex];
      const loser = seeds[loserIndex];
      await insertBattle({ roomId: winner.roomId, battleId, startedAt: BATTLE_START, endedAt: BATTLE_END });
      await insertBattle({ roomId: loser.roomId, battleId, startedAt: BATTLE_START, endedAt: BATTLE_END });
      await insertGift({ roomId: winner.roomId, uniqueId: `w${winnerIndex}`, diamonds: 500, receivedAt: GIFT_AT });
      await insertGift({ roomId: loser.roomId, uniqueId: `l${loserIndex}`, diamonds: 100, receivedAt: GIFT_AT });
    }

    // 1周目: 1回戦が確定し、敗者がブロックの葉へ入る。
    await aggregateEvent(event.id);

    const sidesOf = async (round: number, position: number) => {
      const match = await prisma.eventMatch.findFirstOrThrow({
        where: { eventId: event.id, round, bracketPosition: position },
        include: {
          sides: {
            orderBy: { sideIndex: "asc" },
            select: { participants: { select: { participantId: true } } },
          },
        },
      });
      return match.sides.map((s) => s.participants[0]?.participantId ?? null);
    };

    // 不戦勝の葉: (1,1) の敗者(第5シード)だけが入り、相手側は永久に空。
    expect(await sidesOf(2, 4)).toEqual([seeds[4].id, null]);
    const byeLeaf = await prisma.eventMatch.findFirstOrThrow({
      where: { eventId: event.id, round: 2, bracketPosition: 4 },
      select: { status: true, winnerDecidedBy: true, rules: true },
    });
    expect(byeLeaf.status).toBe("FINISHED");
    expect(byeLeaf.winnerDecidedBy).toBe("BYE");
    expect((byeLeaf.rules as { bye?: unknown }).bye).toBe(true);

    // 実試合の葉: (1,2) と (1,3) の敗者が向かい合う。
    expect(await sidesOf(2, 5)).toEqual([seeds[6].id, seeds[5].id]);

    // 不戦勝の葉(2,4)はその場で自動確定するので、勝者は同じ advanceBracket 呼び出しの中で
    // さらに下流の5位決定戦まで届く(1回の呼び出しで全ラウンド伝播しきる設計)。
    expect(await sidesOf(3, 2)).toEqual([seeds[4].id, null]);

    // 3位決定戦(準決勝の敗者)はまだ誰も来ていない。
    expect(await sidesOf(3, 1)).toEqual([null, null]);
  });

  it("順位決定戦のラウンドごとに、本選とは別の日程を割り当てられる", async () => {
    const event = await prisma.event.create({
      data: {
        slug: `${PREFIX}-${uniqueSuffix()}`,
        title: `${PREFIX} 2日程トーナメント`,
        ownerUserId: `${PREFIX}_owner`,
        format: "TOURNAMENT",
        entryMode: "SOLO",
        status: "RUNNING",
        startAt: START,
        endAt: END,
        sessions: {
          create: [
            { name: "1日目", startAt: START, endAt: new Date(NOW - 86_400_000) },
            { name: "2日目", startAt: new Date(NOW - 86_400_000), endAt: END },
          ],
        },
      },
      select: { id: true, sessions: { orderBy: { startAt: "asc" }, select: { id: true } } },
    });
    createdEventIds.push(event.id);
    const [day1, day2] = event.sessions.map((s) => s.id);

    const seeds = [];
    for (let i = 1; i <= 7; i++) seeds.push(await newParticipant(event.id, `p${i}`));

    // 順位決定戦の並びは placementRounds() と同じ「ブロック順 → ブロック内ラウンド順」。
    // [3位決定戦, 5位決定 1回戦, 5位決定戦]
    await createBracket({
      eventId: event.id,
      entrantIds: seeds.map((s) => s.id),
      roundSessionIds: [day1, day1, day2],
      placementDepth: 2,
      placementSessionIds: [day2, day1, day2],
    });

    const sessionOf = async (round: number, position: number) =>
      (
        await prisma.eventMatch.findFirstOrThrow({
          where: { eventId: event.id, round, bracketPosition: position },
          select: { sessionId: true },
        })
      ).sessionId;

    expect(await sessionOf(3, 1)).toBe(day2); // 3位決定戦
    expect(await sessionOf(2, 4)).toBe(day1); // 5位決定 1回戦(不戦勝の葉)
    expect(await sessionOf(2, 5)).toBe(day1); // 5位決定 1回戦
    expect(await sessionOf(3, 2)).toBe(day2); // 5位決定戦

    // 出場者が決まる本選ラウンドより前には置けない。
    await expect(
      createBracket({
        eventId: event.id,
        entrantIds: seeds.map((s) => s.id),
        roundSessionIds: [day2, day2, day2],
        placementDepth: 1,
        placementSessionIds: [day1],
      })
    ).rejects.toThrow(BracketError);
  });

  it("組めない深さを指定しても、組める段までしか作らない", async () => {
    const event = await newTournament();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    // 3人では準決勝の実試合が1件しかないので、3位は無試合で確定する = ブロックを作れない。
    const result = await createBracket({
      eventId: event.id,
      entrantIds: [a.id, b.id, c.id],
      placementDepth: 3,
    });
    expect(result.matches).toBe(3);
    const rows = await prisma.eventMatch.findMany({
      where: { eventId: event.id },
      select: { rules: true },
    });
    expect(rows.every((r) => (r.rules as { placement?: unknown }).placement === undefined)).toBe(
      true
    );
  });
});
