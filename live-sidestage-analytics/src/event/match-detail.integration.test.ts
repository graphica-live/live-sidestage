// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// バトル候補の「合算」機能導入後の loadPublicMatchDetail() の検証。
// **欠陥B回帰(2回目レビュー)が中心**: games の組み立ては selected な候補だけを対象に
// グループ化する必要がある(全候補を対象にすると、非選択候補を挟んだ合算グループが
// 非隣接になり2つの偽の単独ゲームに分断されてしまう)。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { loadPublicMatchDetail, type MatchDetailEventInput } from "./match-detail";

const PREFIX = "itest_matchdetail";
const OWNER = `${PREFIX}_owner`;
const NOW = new Date();
const START = new Date(NOW.getTime() - 3 * 86_400_000);
const END = new Date(NOW.getTime() + 3 * 86_400_000);
const SESSION_START = new Date(NOW.getTime() - 2 * 86_400_000);
const SESSION_END = new Date(NOW.getTime() + 2 * 86_400_000);

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

async function insertGift(params: { roomId: string; diamonds: number; receivedAt: Date }) {
  await prisma.$executeRaw`
    INSERT INTO public.gifts
      (id, "roomId", "uniqueId", nickname, "giftId", "giftName", "repeatCount",
       "diamondCount", "totalDiamonds", "receivedAt", "dayKey", "orderId")
    VALUES
      (gen_random_uuid()::text, ${params.roomId}, 'listener1', 'listener1',
       5, 'Rose', 1, ${params.diamonds}, ${params.diamonds}, ${params.receivedAt},
       '2026-09-01', ${`${PREFIX}_${uniqueSuffix()}`})
  `;
}

async function newEvent(): Promise<{ event: MatchDetailEventInput; sessionId: string }> {
  const created = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} イベント`,
      ownerUserId: OWNER,
      format: "TOURNAMENT",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: START,
      endAt: END,
      rules: { matchRules: { winCondition: "BEST_OF_THREE" } },
      sessions: { create: [{ startAt: SESSION_START, endAt: SESSION_END }] },
    },
    select: { id: true, rules: true, startAt: true, endAt: true, sessions: { select: { id: true, startAt: true, endAt: true, name: true } } },
  });
  createdEventIds.push(created.id);
  return {
    event: {
      id: created.id,
      rules: created.rules,
      startAt: created.startAt,
      endAt: created.endAt,
      sessions: created.sessions,
    },
    sessionId: created.sessions[0].id,
  };
}

async function newMatchWithSides(eventId: string, sessionId: string, status = "FINISHED") {
  const roomA = await createRoom(`${PREFIX}_a_${uniqueSuffix()}`);
  const roomB = await createRoom(`${PREFIX}_b_${uniqueSuffix()}`);
  const pa = await prisma.eventParticipant.create({
    data: { eventId, tiktokId: `${PREFIX}_a_${uniqueSuffix()}`, roomId: roomA, displayName: "a" },
    select: { id: true },
  });
  const pb = await prisma.eventParticipant.create({
    data: { eventId, tiktokId: `${PREFIX}_b_${uniqueSuffix()}`, roomId: roomB, displayName: "b" },
    select: { id: true },
  });
  const match = await prisma.eventMatch.create({
    data: {
      eventId,
      sessionId,
      round: 1,
      bracketPosition: 0,
      matchType: "1V1",
      status,
      rules: {},
      sides: {
        create: [
          { sideIndex: 0, participants: { create: [{ participantId: pa.id }] } },
          { sideIndex: 1, participants: { create: [{ participantId: pb.id }] } },
        ],
      },
    },
    select: { id: true },
  });
  return { matchId: match.id, roomA, roomB };
}

async function addCandidate(params: {
  matchId: string;
  offsetMinutes: number;
  endedAt?: Date | null;
  selected?: boolean;
  combinedGroupId?: string | null;
}) {
  const startedAt = new Date(SESSION_START.getTime() + params.offsetMinutes * 60_000);
  const endedAt = params.endedAt === undefined ? new Date(startedAt.getTime() + 5 * 60_000) : params.endedAt;
  return prisma.eventMatchBattleCandidate.create({
    data: {
      matchId: params.matchId,
      battleId: `${PREFIX}_battle_${uniqueSuffix()}`,
      startedAt,
      endedAt,
      confidence: "exact",
      endedAtSource: endedAt ? "observed" : null,
      selected: params.selected ?? false,
      combinedGroupId: params.combinedGroupId ?? null,
    },
    select: { id: true, startedAt: true, endedAt: true },
  });
}

afterAll(async () => {
  if (createdEventIds.length > 0) {
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  }
  for (const id of createdRoomIds) {
    await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE id = ${id}`.catch(() => {});
  }
  await prisma.$disconnect();
});

describe("loadPublicMatchDetail — games (合算グループ)", () => {
  it("合算グループを1件のGameDetailとしてまとめ、candidateIdsに2件入る", async () => {
    const { event, sessionId } = await newEvent();
    const { matchId, roomA } = await newMatchWithSides(event.id, sessionId);
    const groupId = "grp-1";
    const a = await addCandidate({ matchId, offsetMinutes: 0, selected: true, combinedGroupId: groupId });
    const b = await addCandidate({ matchId, offsetMinutes: 10, selected: true, combinedGroupId: groupId });
    await insertGift({ roomId: roomA, diamonds: 10, receivedAt: new Date(a.startedAt.getTime() + 60_000) });

    const detail = await loadPublicMatchDetail(prisma, { event, matchId, now: NOW });
    expect(detail).not.toBeNull();
    expect(detail!.games).toHaveLength(1);
    expect(detail!.games[0].candidateIds.sort()).toEqual([a.id, b.id].sort());
  });

  it("欠陥B回帰: 非選択候補Bを挟んだ合算グループ(A+C)がA単独/C単独に分断されず、1件のGameDetailにまとまる", async () => {
    const { event, sessionId } = await newEvent();
    const { matchId, roomA } = await newMatchWithSides(event.id, sessionId);
    const groupId = "grp-ac";
    // A(21:00)、B(21:30、非選択=ゴミ検知)、C(22:00)。AとCを合算グループにし、Bは非選択のまま。
    const a = await addCandidate({ matchId, offsetMinutes: 0, selected: true, combinedGroupId: groupId });
    const b = await addCandidate({ matchId, offsetMinutes: 30, selected: false, combinedGroupId: null });
    const c = await addCandidate({ matchId, offsetMinutes: 60, selected: true, combinedGroupId: groupId });
    await insertGift({ roomId: roomA, diamonds: 5, receivedAt: new Date(a.startedAt.getTime() + 60_000) });

    const detail = await loadPublicMatchDetail(prisma, { event, matchId, now: NOW });
    expect(detail).not.toBeNull();
    // 分断されていれば games.length は3(A単独/B/C単独)や2(A単独+C単独、Bは含まれない)になる。
    // 正しくグルーピングされていれば games.length は1(A+C合算)。
    expect(detail!.games).toHaveLength(1);
    expect(detail!.games[0].candidateIds.sort()).toEqual([a.id, c.id].sort());
    // Bは選択されていないので battles には残るが、どの games グループにも含まれない。
    const gameCandidateIds = new Set(detail!.games.flatMap((g) => g.candidateIds));
    expect(gameCandidateIds.has(b.id)).toBe(false);
    expect(detail!.battles.some((bt) => bt.candidateId === b.id)).toBe(true);
  });

  it("completedはメンバー全員が終了していないとtrueにならない", async () => {
    const { event, sessionId } = await newEvent();
    const { matchId } = await newMatchWithSides(event.id, sessionId);
    const groupId = "grp-pending";
    await addCandidate({ matchId, offsetMinutes: 0, selected: true, combinedGroupId: groupId });
    // 2件目は未来のendedAt(未完了)。selectCandidateGroupsのAPI検証では通常拒否されるが、
    // ここではDB直接操作でloadPublicMatchDetail()単体の挙動を確かめる。
    await addCandidate({
      matchId,
      offsetMinutes: 10,
      endedAt: new Date(NOW.getTime() + 999 * 86_400_000),
      selected: true,
      combinedGroupId: groupId,
    });

    const detail = await loadPublicMatchDetail(prisma, { event, matchId, now: NOW });
    expect(detail).not.toBeNull();
    expect(detail!.games).toHaveLength(1);
    expect(detail!.games[0].completed).toBe(false);
  });

  it("単独候補(combinedGroupIdなし)はcandidateIds.length===1になる", async () => {
    const { event, sessionId } = await newEvent();
    const { matchId, roomA } = await newMatchWithSides(event.id, sessionId);
    const a = await addCandidate({ matchId, offsetMinutes: 0, selected: true });
    await insertGift({ roomId: roomA, diamonds: 5, receivedAt: new Date(a.startedAt.getTime() + 60_000) });

    const detail = await loadPublicMatchDetail(prisma, { event, matchId, now: NOW });
    expect(detail).not.toBeNull();
    expect(detail!.games).toHaveLength(1);
    expect(detail!.games[0].candidateIds).toEqual([a.id]);
  });

  it("battles配列は合算導入前と完全に同じ形・同じ値で返る(公開JSONの後方互換契約)", async () => {
    const { event, sessionId } = await newEvent();
    const { matchId, roomA } = await newMatchWithSides(event.id, sessionId);
    const a = await addCandidate({ matchId, offsetMinutes: 0, selected: true });
    await insertGift({ roomId: roomA, diamonds: 5, receivedAt: new Date(a.startedAt.getTime() + 60_000) });

    const detail = await loadPublicMatchDetail(prisma, { event, matchId, now: NOW });
    expect(detail).not.toBeNull();
    expect(detail!.battles).toHaveLength(1);
    const battle = detail!.battles[0];
    expect(battle).toHaveProperty("candidateId");
    expect(battle).toHaveProperty("battleId");
    expect(battle).toHaveProperty("startedAt");
    expect(battle).toHaveProperty("endedAt");
    expect(battle).toHaveProperty("confidence");
    expect(battle).toHaveProperty("selected");
    expect(battle).toHaveProperty("completed");
    expect(battle).toHaveProperty("calculatedWinnerSideId");
    expect(battle).toHaveProperty("sides");
    expect(battle).toHaveProperty("tiktokScores");
    expect(battle).toHaveProperty("contributions");
    expect(battle.candidateId).toBe(a.id);
  });

  it("候補が0件のとき games は空配列で例外にならない", async () => {
    const { event, sessionId } = await newEvent();
    const { matchId } = await newMatchWithSides(event.id, sessionId, "NO_SHOW");

    const detail = await loadPublicMatchDetail(prisma, { event, matchId, now: NOW });
    expect(detail).not.toBeNull();
    expect(detail!.games).toEqual([]);
    expect(detail!.battles).toEqual([]);
  });

  it("VOIDの対戦は games が空配列で例外にならない", async () => {
    const { event, sessionId } = await newEvent();
    const { matchId } = await newMatchWithSides(event.id, sessionId, "VOID");
    await addCandidate({ matchId, offsetMinutes: 0, selected: false });

    const detail = await loadPublicMatchDetail(prisma, { event, matchId, now: NOW });
    expect(detail).not.toBeNull();
    expect(detail!.games).toEqual([]);
  });
});
