// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// analytics の view を読むので、live-sidestage-analytics/sql/event-integration.sql を
// 先に適用しておくこと。
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { aggregateEvent } from "./aggregate";
import { assertEventSession, createSingleMatch, SingleMatchError } from "./single-match";

const PREFIX = "itest_dm";
const NOW = Date.now();
const START = new Date(NOW - 3 * 86_400_000);
const END = new Date(NOW + 3 * 86_400_000);
const SLOT1 = new Date(NOW - 2 * 86_400_000);
const SLOT2 = new Date(NOW - 1 * 86_400_000);

let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const createdEventIds: string[] = [];
const createdRoomIds: string[] = [];

async function createRoom(tiktokId: string): Promise<string> {
  // monitoringSuspended: true は監視対象からの隔離。Streamer 0人の部屋も watchedRoomFilter() の
  // 監視対象になったため、そのままだと並行して走る listener 系テストの getMyRooms() が
  // グローバルに claim して workerId / listenerStatus を書きに来る。集計の検証に監視は要らない。
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt", "monitoringSuspended")
    VALUES (gen_random_uuid()::text, ${tiktokId}, NOW(), true)
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

async function insertBattle(params: {
  roomId: string;
  battleId: string;
  startedAt: Date;
  endedAt: Date;
}) {
  await prisma.$executeRaw`
    INSERT INTO public.tiktok_battles
      (id, "roomId", "battleId", action, "startedAt", "startedAtEstimated", "endedAt",
       "durationSec", "hostUserIds", "hostDisplayIds", "hostScores", "updatedAt")
    VALUES
      (gen_random_uuid()::text, ${params.roomId}, ${params.battleId}, 5,
       ${params.startedAt}, false, ${params.endedAt}, 300,
       ARRAY[]::text[], ARRAY[]::text[], '{}'::jsonb, NOW())
  `;
}

async function newDeathmatch(rules?: Record<string, number>, entryMode: "SOLO" | "TEAM" = "SOLO") {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} デスマッチ`,
      ownerUserId: `${PREFIX}_owner`,
      format: "DEATHMATCH",
      entryMode,
      status: "RUNNING",
      startAt: START,
      endAt: END,
      rules: rules ? { deathmatch: rules } : {},
      // 対戦は開催日程へ割り当てる。旧テストが時間枠で分けていた2つの対戦を、
      // 2つの日程(SLOT1 / SLOT2 の各1時間)で分ける。
      sessions: {
        create: [
          { name: "1日目", startAt: SLOT1, endAt: new Date(SLOT1.getTime() + 3_600_000) },
          { name: "2日目", startAt: SLOT2, endAt: new Date(SLOT2.getTime() + 3_600_000) },
        ],
      },
    },
    select: { id: true },
  });
  createdEventIds.push(event.id);
  return event;
}

/** その時刻を含む開催日程の id。対戦はこの日程へ割り当てる。 */
async function sessionAt(eventId: string, when: Date): Promise<string> {
  const session = await prisma.eventSession.findFirstOrThrow({
    where: { eventId, startAt: { lte: when }, endAt: { gt: when } },
    select: { id: true },
  });
  return session.id;
}

async function newTeam(eventId: string, name: string) {
  return prisma.eventTeam.create({
    data: { eventId, name: `${name}_${uniqueSuffix()}` },
    select: { id: true },
  });
}

async function newParticipant(eventId: string, name: string, teamId?: string) {
  const tiktokId = `${PREFIX}_${name}_${uniqueSuffix()}`;
  const roomId = await createRoom(tiktokId);
  const p = await prisma.eventParticipant.create({
    data: { eventId, tiktokId, roomId, displayName: name, teamId },
    select: { id: true },
  });
  return { id: p.id, roomId };
}

/** 1件の対戦を組み、そこで実際にバトルが起きてダイヤが入った状態を作る。 */
async function playMatch(params: {
  eventId: string;
  a: { id: string; roomId: string };
  b: { id: string; roomId: string };
  slot: Date;
  aDiamonds: number;
  bDiamonds: number;
}) {
  const { matchId } = await createSingleMatch({
    eventId: params.eventId,
    sideA: { participantIds: [params.a.id] },
    sideB: { participantIds: [params.b.id] },
    sessionId: await sessionAt(params.eventId, params.slot),
  });

  const battleId = `${PREFIX}_b_${uniqueSuffix()}`;
  const battleStart = new Date(params.slot.getTime() + 10 * 60_000);
  const battleEnd = new Date(params.slot.getTime() + 20 * 60_000);
  await insertBattle({ roomId: params.a.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });
  await insertBattle({ roomId: params.b.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });

  const at = new Date(params.slot.getTime() + 15 * 60_000);
  if (params.aDiamonds > 0) {
    await insertGift({ roomId: params.a.roomId, uniqueId: "l1", diamonds: params.aDiamonds, receivedAt: at });
  }
  if (params.bDiamonds > 0) {
    await insertGift({ roomId: params.b.roomId, uniqueId: "l2", diamonds: params.bDiamonds, receivedAt: at });
  }

  return matchId;
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

describe("デスマッチのライフ", () => {
  it("対戦がなくても全員が初期ライフで載る", async () => {
    const event = await newDeathmatch({ initialLife: 3 });
    await newParticipant(event.id, "a");
    await newParticipant(event.id, "b");

    await aggregateEvent(event.id);

    const lives = await prisma.eventLifePoint.findMany({ where: { eventId: event.id } });
    expect(lives).toHaveLength(2);
    expect(lives.every((l) => l.current === 3 && l.eliminatedAt === null)).toBe(true);
  });

  it("敗北でライフが減り、履歴が残る", async () => {
    const event = await newDeathmatch({ initialLife: 3, lossDelta: 1 });
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    const matchId = await playMatch({
      eventId: event.id,
      a,
      b,
      slot: SLOT1,
      aDiamonds: 500,
      bDiamonds: 200,
    });

    await aggregateEvent(event.id);

    const lives = await prisma.eventLifePoint.findMany({ where: { eventId: event.id } });
    expect(lives.find((l) => l.subjectId === a.id)?.current).toBe(3);
    expect(lives.find((l) => l.subjectId === b.id)?.current).toBe(2);

    const ledger = await prisma.eventLifeLedger.findMany({ where: { eventId: event.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ subjectId: b.id, delta: -1, reason: "MATCH_LOSS", matchId });
  });

  it("ライフが尽きたら脱落し、その後は対戦を組めない", async () => {
    const event = await newDeathmatch({ initialLife: 1, lossDelta: 1 });
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await playMatch({ eventId: event.id, a, b, slot: SLOT1, aDiamonds: 500, bDiamonds: 100 });
    await aggregateEvent(event.id);

    const life = await prisma.eventLifePoint.findFirst({
      where: { eventId: event.id, subjectId: b.id },
    });
    expect(life?.current).toBe(0);
    expect(life?.eliminatedAt).not.toBeNull();

    await expect(
      createSingleMatch({
        eventId: event.id,
        sideA: { participantIds: [a.id] },
        sideB: { participantIds: [b.id] },
        sessionId: await sessionAt(event.id, SLOT2),
      })
    ).rejects.toMatchObject({ code: "ELIMINATED" });
  });

  it("主催者が勝敗を覆すとライフが計算し直される", async () => {
    const event = await newDeathmatch({ initialLife: 3, lossDelta: 1 });
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    const matchId = await playMatch({
      eventId: event.id,
      a,
      b,
      slot: SLOT1,
      aDiamonds: 500,
      bDiamonds: 200,
    });
    await aggregateEvent(event.id);

    const sides = await prisma.eventMatchSide.findMany({
      where: { matchId },
      orderBy: { sideIndex: "asc" },
    });
    // 主催者が b を勝者として確定し直す。
    await prisma.eventMatch.update({
      where: { id: matchId },
      data: { winnerSideId: sides[1].id, winnerDecidedBy: "MANUAL", status: "FINISHED" },
    });
    await aggregateEvent(event.id);

    const lives = await prisma.eventLifePoint.findMany({ where: { eventId: event.id } });
    expect(lives.find((l) => l.subjectId === a.id)?.current).toBe(2);
    expect(lives.find((l) => l.subjectId === b.id)?.current).toBe(3);

    // 履歴も入れ替わる(古い MATCH_LOSS が残らない)。
    const ledger = await prisma.eventLifeLedger.findMany({ where: { eventId: event.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].subjectId).toBe(a.id);
  });

  it("対戦を無効にするとライフが戻る", async () => {
    const event = await newDeathmatch({ initialLife: 3, lossDelta: 1 });
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    const matchId = await playMatch({
      eventId: event.id,
      a,
      b,
      slot: SLOT1,
      aDiamonds: 500,
      bDiamonds: 200,
    });
    await aggregateEvent(event.id);
    expect(
      (await prisma.eventLifePoint.findFirst({ where: { eventId: event.id, subjectId: b.id } }))
        ?.current
    ).toBe(2);

    await prisma.eventMatch.update({
      where: { id: matchId },
      data: { status: "VOID", winnerSideId: null, winnerDecidedBy: null },
    });
    await aggregateEvent(event.id);

    const lives = await prisma.eventLifePoint.findMany({ where: { eventId: event.id } });
    expect(lives.every((l) => l.current === 3)).toBe(true);
    expect(await prisma.eventLifeLedger.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("引き分けで確定すると両者のライフが減る", async () => {
    const event = await newDeathmatch({ initialLife: 3, lossDelta: 1, drawDelta: 1 });
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    const matchId = await playMatch({
      eventId: event.id,
      a,
      b,
      slot: SLOT1,
      aDiamonds: 300,
      bDiamonds: 300,
    });
    await aggregateEvent(event.id);

    // 同点なので自動では決まらない。
    const detected = await prisma.eventMatch.findUnique({ where: { id: matchId } });
    expect(detected?.status).toBe("DETECTED");
    expect(detected?.winnerSideId).toBeNull();

    await prisma.eventMatch.update({
      where: { id: matchId },
      data: { status: "FINISHED", winnerDecidedBy: "DRAW" },
    });
    await aggregateEvent(event.id);

    const lives = await prisma.eventLifePoint.findMany({ where: { eventId: event.id } });
    expect(lives.every((l) => l.current === 2)).toBe(true);
    expect(
      (await prisma.eventLifeLedger.findMany({ where: { eventId: event.id } })).every(
        (l) => l.reason === "MATCH_DRAW"
      )
    ).toBe(true);
  });

  it("引き分けの確定は自動集計で上書きされない", async () => {
    const event = await newDeathmatch({ initialLife: 3, drawDelta: 1 });
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    const matchId = await playMatch({
      eventId: event.id,
      a,
      b,
      slot: SLOT1,
      aDiamonds: 500,
      bDiamonds: 100,
    });
    await prisma.eventMatch.update({
      where: { id: matchId },
      data: { status: "FINISHED", winnerDecidedBy: "DRAW", winnerSideId: null },
    });

    await aggregateEvent(event.id);
    await aggregateEvent(event.id);

    const match = await prisma.eventMatch.findUnique({ where: { id: matchId } });
    expect(match?.winnerDecidedBy).toBe("DRAW");
    expect(match?.winnerSideId).toBeNull();
  });
});

describe("createSingleMatch", () => {
  it("同じ日程に同じ出場者の対戦を複数組める", async () => {
    // 対戦に個別の時間枠が無くなったので、同じ日程で同じ人が何度も戦うのが常態。
    // 曖昧な検知は assignBattles が自動確定を諦めることで受け止める。
    const event = await newDeathmatch();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    await createSingleMatch({
      eventId: event.id,
      sideA: { participantIds: [a.id] },
      sideB: { participantIds: [b.id] },
      sessionId: await sessionAt(event.id, SLOT1),
    });

    const second = await createSingleMatch({
      eventId: event.id,
      sideA: { participantIds: [a.id] },
      sideB: { participantIds: [c.id] },
      sessionId: await sessionAt(event.id, SLOT1),
    });

    expect(second.matchId).toBeTruthy();
  });

  it("別の日程にも同じ出場者で組める", async () => {
    const event = await newDeathmatch();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");

    await createSingleMatch({
      eventId: event.id,
      sideA: { participantIds: [a.id] },
      sideB: { participantIds: [b.id] },
      sessionId: await sessionAt(event.id, SLOT1),
    });

    const second = await createSingleMatch({
      eventId: event.id,
      sideA: { participantIds: [a.id] },
      sideB: { participantIds: [c.id] },
      sessionId: await sessionAt(event.id, SLOT2),
    });

    expect(second.matchId).toBeTruthy();
  });

  it("同じ出場者を両サイドに入れられない", async () => {
    const event = await newDeathmatch();
    const a = await newParticipant(event.id, "a");

    await expect(
      createSingleMatch({
        eventId: event.id,
        sideA: { participantIds: [a.id] },
        sideB: { participantIds: [a.id] },
        sessionId: await sessionAt(event.id, SLOT1),
      })
    ).rejects.toBeInstanceOf(SingleMatchError);
  });

  it("他のイベントの日程には組めない", async () => {
    const event = await newDeathmatch();
    const other = await newDeathmatch();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await expect(
      createSingleMatch({
        eventId: event.id,
        sideA: { participantIds: [a.id] },
        sideB: { participantIds: [b.id] },
        sessionId: await sessionAt(other.id, SLOT1),
      })
    ).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });

  it("他のイベントの参加者は組めない", async () => {
    const event = await newDeathmatch();
    const other = await newDeathmatch();
    const a = await newParticipant(event.id, "a");
    const stranger = await newParticipant(other.id, "x");

    await expect(
      createSingleMatch({
        eventId: event.id,
        sideA: { participantIds: [a.id] },
        sideB: { participantIds: [stranger.id] },
        sessionId: await sessionAt(event.id, SLOT1),
      })
    ).rejects.toMatchObject({ code: "UNKNOWN_SUBJECT" });
  });

  it("最終集計が済んでいても対戦を足せば再集計へ戻る", async () => {
    const event = await newDeathmatch();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await prisma.event.update({ where: { id: event.id }, data: { finalizedAt: new Date() } });

    await createSingleMatch({
      eventId: event.id,
      sideA: { participantIds: [a.id] },
      sideB: { participantIds: [b.id] },
      sessionId: await sessionAt(event.id, SLOT1),
    });

    const after = await prisma.event.findUnique({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(after?.finalizedAt).toBeNull();
  });
});

describe("createSingleMatch（チーム戦）", () => {
  it("出場するメンバーだけがサイドに入る", async () => {
    const event = await newDeathmatch(undefined, "TEAM");
    const teamA = await newTeam(event.id, "A");
    const teamB = await newTeam(event.id, "B");
    const a1 = await newParticipant(event.id, "a1", teamA.id);
    // a2 はチームにいるが、この対戦には出さない。
    await newParticipant(event.id, "a2", teamA.id);
    const b1 = await newParticipant(event.id, "b1", teamB.id);

    const { matchId } = await createSingleMatch({
      eventId: event.id,
      sideA: { teamId: teamA.id, participantIds: [a1.id] },
      sideB: { teamId: teamB.id, participantIds: [b1.id] },
      sessionId: await sessionAt(event.id, SLOT1),
    });

    const match = await prisma.eventMatch.findUnique({
      where: { id: matchId },
      select: {
        matchType: true,
        sides: {
          orderBy: { sideIndex: "asc" },
          select: { teamId: true, participants: { select: { participantId: true } } },
        },
      },
    });

    expect(match?.matchType).toBe("1V1");
    expect(match?.sides[0].teamId).toBe(teamA.id);
    // チーム全員ではなく、選んだ1人だけ。
    expect(match?.sides[0].participants.map((p) => p.participantId)).toEqual([a1.id]);
    expect(match?.sides[1].participants.map((p) => p.participantId)).toEqual([b1.id]);
  });

  it("2人ずつ選ぶと 2V2 になる", async () => {
    const event = await newDeathmatch(undefined, "TEAM");
    const teamA = await newTeam(event.id, "A");
    const teamB = await newTeam(event.id, "B");
    const a1 = await newParticipant(event.id, "a1", teamA.id);
    const a2 = await newParticipant(event.id, "a2", teamA.id);
    const b1 = await newParticipant(event.id, "b1", teamB.id);
    const b2 = await newParticipant(event.id, "b2", teamB.id);

    const { matchId } = await createSingleMatch({
      eventId: event.id,
      sideA: { teamId: teamA.id, participantIds: [a1.id, a2.id] },
      sideB: { teamId: teamB.id, participantIds: [b1.id, b2.id] },
      sessionId: await sessionAt(event.id, SLOT1),
    });

    const match = await prisma.eventMatch.findUnique({
      where: { id: matchId },
      select: { matchType: true },
    });
    expect(match?.matchType).toBe("2V2");
  });

  it("そのチームに所属していないメンバーは出せない", async () => {
    const event = await newDeathmatch(undefined, "TEAM");
    const teamA = await newTeam(event.id, "A");
    const teamB = await newTeam(event.id, "B");
    const a1 = await newParticipant(event.id, "a1", teamA.id);
    const b1 = await newParticipant(event.id, "b1", teamB.id);

    await expect(
      createSingleMatch({
        eventId: event.id,
        // b1 は teamB の所属。teamA のサイドには入れられない。
        sideA: { teamId: teamA.id, participantIds: [b1.id] },
        sideB: { teamId: teamB.id, participantIds: [a1.id] },
        sessionId: await sessionAt(event.id, SLOT1),
      })
    ).rejects.toMatchObject({ code: "UNKNOWN_SUBJECT" });
  });

  it("チームの指定がないと組めない", async () => {
    const event = await newDeathmatch(undefined, "TEAM");
    const teamA = await newTeam(event.id, "A");
    const teamB = await newTeam(event.id, "B");
    const a1 = await newParticipant(event.id, "a1", teamA.id);
    const b1 = await newParticipant(event.id, "b1", teamB.id);

    await expect(
      createSingleMatch({
        eventId: event.id,
        sideA: { participantIds: [a1.id] },
        sideB: { teamId: teamB.id, participantIds: [b1.id] },
        sessionId: await sessionAt(event.id, SLOT1),
      })
    ).rejects.toMatchObject({ code: "INVALID_SIDES" });
  });
});

describe("バトル中のみ集計する(デスマッチ)", () => {
  it("バトル外のギフトは順位表のダイヤに入らない", async () => {
    const event = await newDeathmatch();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await playMatch({ eventId: event.id, a, b, slot: SLOT1, aDiamonds: 100, bDiamonds: 50 });
    // バトル区間の外(対戦の前)に大きなギフト。旧仕様ならこれも計上されていた。
    await insertGift({
      roomId: a.roomId,
      uniqueId: "outside",
      diamonds: 9000,
      receivedAt: new Date(SLOT1.getTime() + 60_000),
    });

    await aggregateEvent(event.id);
    await aggregateEvent(event.id);

    const standing = await prisma.eventStanding.findFirstOrThrow({
      where: { eventId: event.id, subjectType: "PARTICIPANT", subjectId: a.id },
    });
    expect(standing.diamonds).toBe(100n);

    // リスナー貢献にもバトル外の分は出ない。
    const outside = await prisma.eventContribution.findFirst({
      where: { eventId: event.id, scope: "EVENT", listenerUniqueId: "outside" },
    });
    expect(outside).toBeNull();
  });

  it("同ライフのタイブレークもバトル限定のダイヤで決まる", async () => {
    const event = await newDeathmatch();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const c = await newParticipant(event.id, "c");
    const d = await newParticipant(event.id, "d");

    // a と c を別々の対戦で勝たせて、ライフを同じにする。
    await playMatch({ eventId: event.id, a, b, slot: SLOT1, aDiamonds: 100, bDiamonds: 50 });
    await playMatch({ eventId: event.id, a: c, b: d, slot: SLOT2, aDiamonds: 300, bDiamonds: 10 });
    // a はバトル外で大量に受け取るが、これはタイブレークに効かない。
    await insertGift({
      roomId: a.roomId,
      uniqueId: "outside",
      diamonds: 9000,
      receivedAt: new Date(SLOT1.getTime() + 60_000),
    });

    await aggregateEvent(event.id);
    await aggregateEvent(event.id);

    const standings = await prisma.eventStanding.findMany({
      where: { eventId: event.id, subjectType: "PARTICIPANT" },
    });
    const forA = standings.find((s) => s.subjectId === a.id);
    const forC = standings.find((s) => s.subjectId === c.id);
    // バトル中だけなら c(300) > a(100)。全期間なら a(9100) > c(300) で逆転していた。
    expect(forA?.diamonds).toBe(100n);
    expect(forC?.diamonds).toBe(300n);
  });

  it("集計方式(aggregationPolicy)を BATTLE_ONLY として記録する", async () => {
    const event = await newDeathmatch();
    await newParticipant(event.id, "a");

    await aggregateEvent(event.id);

    const row = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { aggregationPolicy: true },
    });
    expect(row.aggregationPolicy).toBe("BATTLE_ONLY");
  });
});

describe("同じ組み合わせが複数の対戦カードにある場合(cross-match衝突)", () => {
  it("同じ日程に同じ組み合わせの対戦カードが2つあると、検知したバトルは両方をAMBIGUOUSにする", async () => {
    // CLAUDE.md「同じ日程に同じ出場者の対戦が並ぶのは常態」の実例(1回戦と2回戦が
    // 同じ日程に同居する等)。1つのバトルがどちらのカードのものか機械的に区別できないため、
    // 両方を曖昧にして主催者の手動仕分けに委ねる(専用の再割当てAPIは追加しない、確定方針)。
    const event = await newDeathmatch();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    const sessionId = await sessionAt(event.id, SLOT1);

    const { matchId: match1 } = await createSingleMatch({
      eventId: event.id,
      sideA: { participantIds: [a.id] },
      sideB: { participantIds: [b.id] },
      sessionId,
    });
    const { matchId: match2 } = await createSingleMatch({
      eventId: event.id,
      sideA: { participantIds: [a.id] },
      sideB: { participantIds: [b.id] },
      sessionId,
    });

    const battleId = `${PREFIX}_amb_${uniqueSuffix()}`;
    const battleStart = new Date(SLOT1.getTime() + 10 * 60_000);
    const battleEnd = new Date(SLOT1.getTime() + 20 * 60_000);
    await insertBattle({ roomId: a.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });
    await insertBattle({ roomId: b.roomId, battleId, startedAt: battleStart, endedAt: battleEnd });

    await aggregateEvent(event.id);

    const m1 = await prisma.eventMatch.findUniqueOrThrow({ where: { id: match1 } });
    const m2 = await prisma.eventMatch.findUniqueOrThrow({ where: { id: match2 } });
    expect(m1.status).toBe("NEEDS_REVIEW");
    expect((m1.rules as { reviewReason?: string }).reviewReason).toBe("AMBIGUOUS");
    expect(m2.status).toBe("NEEDS_REVIEW");
    expect((m2.rules as { reviewReason?: string }).reviewReason).toBe("AMBIGUOUS");

    // 主催者が片方(match1)を手動で確定する(confirm相当、直接DBで模擬)。
    const side = await prisma.eventMatchSide.findFirstOrThrow({ where: { matchId: match1 } });
    await prisma.eventMatch.update({
      where: { id: match1 },
      data: {
        status: "FINISHED",
        winnerSideId: side.id,
        winnerDecidedBy: "MANUAL",
        decidedAt: new Date(),
      },
    });

    // **ambiguousはsticky。** match1がopenから外れても、match2の判定は動的にfalseへ
    // 戻らず、AMBIGUOUSのまま残る(残った片方だけを見て自動確定されないように)。
    await aggregateEvent(event.id);
    const m2After = await prisma.eventMatch.findUniqueOrThrow({ where: { id: match2 } });
    expect(m2After.status).toBe("NEEDS_REVIEW");
    expect((m2After.rules as { reviewReason?: string }).reviewReason).toBe("AMBIGUOUS");
  });
});

describe("assertEventSession", () => {
  it("このイベントの日程なら通る", async () => {
    const event = await newDeathmatch();
    const sessionId = await sessionAt(event.id, SLOT1);

    await expect(
      prisma.$transaction((tx) => assertEventSession(tx, event.id, sessionId))
    ).resolves.toMatchObject({ id: sessionId });
  });

  it("他のイベントの日程は拒否する", async () => {
    const event = await newDeathmatch();
    const other = await newDeathmatch();
    const foreign = await sessionAt(other.id, SLOT1);

    await expect(
      prisma.$transaction((tx) => assertEventSession(tx, event.id, foreign))
    ).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });
});
