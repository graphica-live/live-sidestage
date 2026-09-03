// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// 候補選択UIの「1000ダイヤ以下を隠す」トグル用オンデマンドAPI(欠陥C対応)の検証。
import { describe, it, expect, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const auth = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: async () => (auth.userId ? { user: { id: auth.userId } } : null),
}));

const { GET } = await import("./route");

const PREFIX = "itest_canddiamonds";
const OWNER = `${PREFIX}_owner`;
const NOW = Date.now();
const START = new Date(NOW - 3 * 86_400_000);
const END = new Date(NOW + 3 * 86_400_000);
const SESSION_START = new Date(NOW - 2 * 86_400_000);
const SESSION_END = new Date(NOW + 2 * 86_400_000);

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

async function newEvent() {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} イベント`,
      ownerUserId: OWNER,
      format: "TOURNAMENT",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: START,
      endAt: END,
      sessions: { create: [{ startAt: SESSION_START, endAt: SESSION_END }] },
    },
    select: { id: true, sessions: { select: { id: true } } },
  });
  createdEventIds.push(event.id);
  return { eventId: event.id, sessionId: event.sessions[0].id };
}

async function newMatchWithSides(eventId: string, sessionId: string) {
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
      status: "NEEDS_REVIEW",
      rules: { reviewReason: "CANDIDATES_EXCEEDED" },
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

async function addCandidate(params: { matchId: string; offsetMinutes: number; endedAt?: Date | null }) {
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
    },
    select: { id: true, startedAt: true, endedAt: true },
  });
}

function get(eventId: string, matchId: string) {
  const req = new NextRequest(
    `http://localhost/api/events/${eventId}/matches/${matchId}/candidate-diamonds`
  );
  return GET(req, { params: { id: eventId, matchId } });
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

describe("GET candidate-diamonds", () => {
  it("owner以外は404", async () => {
    auth.userId = `${PREFIX}_other`;
    const { eventId, sessionId } = await newEvent();
    const { matchId } = await newMatchWithSides(eventId, sessionId);

    const res = await get(eventId, matchId);
    expect(res.status).toBe(404);
  });

  it("候補ごとの生ダイヤ(両サイド合計)を文字列で返す", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent();
    const { matchId, roomA, roomB } = await newMatchWithSides(eventId, sessionId);
    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });
    await insertGift({ roomId: roomA, diamonds: 1001, receivedAt: new Date(c1.startedAt.getTime() + 60_000) });
    await insertGift({ roomId: roomB, diamonds: 500, receivedAt: new Date(c1.startedAt.getTime() + 90_000) });

    const c2 = await addCandidate({ matchId, offsetMinutes: 10 });
    await insertGift({ roomId: roomA, diamonds: 10, receivedAt: new Date(c2.startedAt.getTime() + 60_000) });

    const res = await get(eventId, matchId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: { id: string; diamonds: string | null }[] };
    const byId = new Map(body.candidates.map((c) => [c.id, c.diamonds]));
    // c1: 1001 + 500 = 1501(1000超え)。c2: 10(1000以下)。
    expect(byId.get(c1.id)).toBe("1501");
    expect(byId.get(c2.id)).toBe("10");
  });

  it("未来終了(未終了含む)の候補はnullを返す(進行中候補が低ダイヤ扱いで隠れる事故を防ぐ)", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent();
    const { matchId } = await newMatchWithSides(eventId, sessionId);
    const pending = await addCandidate({ matchId, offsetMinutes: 0, endedAt: null });
    const future = await addCandidate({
      matchId,
      offsetMinutes: 10,
      endedAt: new Date(NOW + 999 * 86_400_000),
    });

    const res = await get(eventId, matchId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: { id: string; diamonds: string | null }[] };
    const byId = new Map(body.candidates.map((c) => [c.id, c.diamonds]));
    expect(byId.get(pending.id)).toBeNull();
    expect(byId.get(future.id)).toBeNull();
  });

  it("倍率は適用しない生ダイヤで返す", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent();
    const { matchId, roomA } = await newMatchWithSides(eventId, sessionId);
    await prisma.eventMultiplier.create({
      data: { eventId, kind: "BATTLE", factor: "3.00", startAt: null, endAt: null },
    });
    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });
    await insertGift({ roomId: roomA, diamonds: 200, receivedAt: new Date(c1.startedAt.getTime() + 60_000) });

    const res = await get(eventId, matchId);
    const body = (await res.json()) as { candidates: { id: string; diamonds: string | null }[] };
    const byId = new Map(body.candidates.map((c) => [c.id, c.diamonds]));
    // 倍率3倍が効いていれば600になるはずだが、生ダイヤ判定なので200のまま。
    expect(byId.get(c1.id)).toBe("200");
  });

  it("対戦固有のEventSessionのみを使い、他日程のギフトを含めない", async () => {
    auth.userId = OWNER;
    const { eventId } = await newEvent();
    // 2つ目の日程を作り、対戦は1つ目の日程に割り当てる。
    const otherSessionStartAt = new Date(SESSION_END.getTime() + 86_400_000);
    const otherSession = await prisma.eventSession.create({
      data: {
        eventId,
        startAt: otherSessionStartAt,
        endAt: new Date(SESSION_END.getTime() + 2 * 86_400_000),
      },
      select: { id: true },
    });
    const firstSession = await prisma.eventSession.findFirstOrThrow({
      where: { eventId, id: { not: otherSession.id } },
      select: { id: true },
    });
    const { matchId, roomA } = await newMatchWithSides(eventId, firstSession.id);
    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });
    await insertGift({ roomId: roomA, diamonds: 50, receivedAt: new Date(c1.startedAt.getTime() + 60_000) });
    // 他日程の時間帯にもギフトを置くが、候補の区間はfirstSessionの中に収まっているので
    // このギフト自体は候補の[startedAt,endedAt)区間外であり、そもそも候補集計には入らない
    // (この確認は「候補区間外は数えない」という scoreSides の既存挙動の確認)。
    await insertGift({
      roomId: roomA,
      diamonds: 9999,
      receivedAt: new Date(otherSessionStartAt.getTime() + 60_000),
    });

    const res = await get(eventId, matchId);
    const body = (await res.json()) as { candidates: { id: string; diamonds: string | null }[] };
    expect(body.candidates.find((c) => c.id === c1.id)?.diamonds).toBe("50");
  });
});
