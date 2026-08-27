// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// 勝利条件(1本勝負/2本先取)対応で追加した selectCandidates / resetCandidates の検証。
// 候補過多(CANDIDATES_EXCEEDED)状態からの選択確定・選び直しのフローを一通り確認する。
import { createHash } from "crypto";
import { describe, it, expect, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildCandidatesFingerprintInput,
  buildSelectionFingerprintInput,
} from "@/event/candidates-fingerprint";

const auth = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: async () => (auth.userId ? { user: { id: auth.userId } } : null),
}));

// next-auth をモックしてから読む(authz.ts が import 時に束縛するため)。
const { PATCH } = await import("./route");

/** route.ts の computeCandidatesFingerprint と同じ計算(Next.js の route ファイルは
 * HTTPメソッド以外を export できないので、ここで同じロジックを組み立てる)。 */
function computeCandidatesFingerprint(
  candidates: {
    id: string;
    startedAt: Date;
    endedAt: Date | null;
    confidence: string;
    ambiguous: boolean;
  }[]
): string {
  return createHash("sha256").update(buildCandidatesFingerprintInput(candidates)).digest("hex");
}

/** route.ts の computeSelectionFingerprint と同じ計算。 */
function computeSelectionFingerprint(
  candidates: { id: string; organizerSelected: boolean; combinedGroupId: string | null }[]
): string {
  return createHash("sha256").update(buildSelectionFingerprintInput(candidates)).digest("hex");
}

const PREFIX = "itest_selcand";
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
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt")
    VALUES (gen_random_uuid()::text, ${tiktokId}, NOW())
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

/** BEST_OF_THREE(2本先取)のトーナメントイベントを1件作る。 */
async function newBestOfThreeEvent() {
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
      rules: { matchRules: { winCondition: "BEST_OF_THREE" } },
      sessions: { create: [{ startAt: SESSION_START, endAt: SESSION_END }] },
    },
    select: { id: true, sessions: { select: { id: true } } },
  });
  createdEventIds.push(event.id);
  return { eventId: event.id, sessionId: event.sessions[0].id };
}

/** 対戦カード1件を、両サイドの参加者・room付きで作る。 */
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

async function addCandidate(params: {
  matchId: string;
  offsetMinutes: number;
  endedAt?: Date | null;
}) {
  const startedAt = new Date(SESSION_START.getTime() + params.offsetMinutes * 60_000);
  const endedAt =
    params.endedAt === undefined ? new Date(startedAt.getTime() + 5 * 60_000) : params.endedAt;
  return prisma.eventMatchBattleCandidate.create({
    data: {
      matchId: params.matchId,
      battleId: `${PREFIX}_battle_${uniqueSuffix()}`,
      startedAt,
      endedAt,
      confidence: "exact",
      endedAtSource: endedAt ? "observed" : null,
    },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      confidence: true,
      ambiguous: true,
      organizerSelected: true,
      combinedGroupId: true,
    },
  });
}

function patch(eventId: string, matchId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/events/${eventId}/matches/${matchId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: { id: eventId, matchId } });
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

describe("selectCandidates", () => {
  it("候補過多でない対戦への selectCandidates は400", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newBestOfThreeEvent();
    const { matchId } = await newMatchWithSides(eventId, sessionId);
    // reviewReason を CANDIDATES_EXCEEDED 以外にしておく。
    await prisma.eventMatch.update({
      where: { id: matchId },
      data: { status: "DETECTED", rules: {} },
    });

    const res = await patch(eventId, matchId, {
      action: "selectCandidates",
      candidateIds: ["dummy"],
      candidatesFingerprint: "x",
    });
    expect(res.status).toBe(400);
  });

  it("candidateIds が maxGames(3件)を超えると400", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newBestOfThreeEvent();
    const { matchId } = await newMatchWithSides(eventId, sessionId);
    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });
    const c2 = await addCandidate({ matchId, offsetMinutes: 10 });
    const c3 = await addCandidate({ matchId, offsetMinutes: 20 });
    const c4 = await addCandidate({ matchId, offsetMinutes: 30 });

    const fingerprint = computeCandidatesFingerprint([c1, c2, c3, c4]);
    const res = await patch(eventId, matchId, {
      action: "selectCandidates",
      candidateIds: [c1.id, c2.id, c3.id, c4.id],
      candidatesFingerprint: fingerprint,
    });
    expect(res.status).toBe(400);
  });

  it("candidateIds に重複があると400", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newBestOfThreeEvent();
    const { matchId } = await newMatchWithSides(eventId, sessionId);
    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });

    const res = await patch(eventId, matchId, {
      action: "selectCandidates",
      candidateIds: [c1.id, c1.id],
      candidatesFingerprint: "x",
    });
    expect(res.status).toBe(400);
  });

  it("終了未確定(pending)の候補は選べず400", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newBestOfThreeEvent();
    const { matchId } = await newMatchWithSides(eventId, sessionId);
    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });
    const pending = await addCandidate({ matchId, offsetMinutes: 10, endedAt: null });

    const fingerprint = computeCandidatesFingerprint([c1, pending]);
    const res = await patch(eventId, matchId, {
      action: "selectCandidates",
      candidateIds: [pending.id],
      candidatesFingerprint: fingerprint,
    });
    expect(res.status).toBe(400);
  });

  it("他マッチの候補IDを混ぜると400(このマッチに存在しない候補)", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newBestOfThreeEvent();
    const { matchId } = await newMatchWithSides(eventId, sessionId);
    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });
    const { matchId: otherMatchId } = await newMatchWithSides(eventId, sessionId);
    const other = await addCandidate({ matchId: otherMatchId, offsetMinutes: 0 });

    const fingerprint = computeCandidatesFingerprint([c1]);
    const res = await patch(eventId, matchId, {
      action: "selectCandidates",
      candidateIds: [c1.id, other.id],
      candidatesFingerprint: fingerprint,
    });
    expect(res.status).toBe(400);
  });

  it("候補内容が変わった後の古い指紋では409(楽観的排他)", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newBestOfThreeEvent();
    const { matchId } = await newMatchWithSides(eventId, sessionId);
    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });

    const staleFingerprint = computeCandidatesFingerprint([c1]);
    // 画面を開いた後に新しい候補が増えた。
    await addCandidate({ matchId, offsetMinutes: 10 });

    const res = await patch(eventId, matchId, {
      action: "selectCandidates",
      candidateIds: [c1.id],
      candidatesFingerprint: staleFingerprint,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CANDIDATES_CHANGED");
  });

  it("正しく2件選ぶと、選んだ候補だけで2-0判定されFINISHEDになる(3件目は無視)", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newBestOfThreeEvent();
    const { matchId, roomA } = await newMatchWithSides(eventId, sessionId);

    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });
    const c2 = await addCandidate({ matchId, offsetMinutes: 10 });
    const c3 = await addCandidate({ matchId, offsetMinutes: 20 });
    const c4 = await addCandidate({ matchId, offsetMinutes: 30 });

    // c1・c2 の区間に a 側のギフトを入れて、a が2連勝する形にする。
    const cand1 = await prisma.eventMatchBattleCandidate.findUniqueOrThrow({
      where: { id: c1.id },
    });
    const cand2 = await prisma.eventMatchBattleCandidate.findUniqueOrThrow({
      where: { id: c2.id },
    });
    await insertGift({
      roomId: roomA,
      diamonds: 100,
      receivedAt: new Date(cand1.startedAt.getTime() + 60_000),
    });
    await insertGift({
      roomId: roomA,
      diamonds: 100,
      receivedAt: new Date(cand2.startedAt.getTime() + 60_000),
    });

    const fingerprint = computeCandidatesFingerprint([c1, c2, c3, c4]);
    const res = await patch(eventId, matchId, {
      action: "selectCandidates",
      candidateIds: [c1.id, c2.id],
      candidatesFingerprint: fingerprint,
    });
    expect(res.status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe("FINISHED");
    expect(match.winnerDecidedBy).toBe("AGGREGATE");

    const candidates = await prisma.eventMatchBattleCandidate.findMany({
      where: { matchId },
      orderBy: { startedAt: "asc" },
    });
    expect(candidates.map((c) => c.organizerSelected)).toEqual([true, true, false, false]);
    // effectiveGames は先取到達で打ち切るので、選んだ2件だけが selected=true。
    expect(candidates.map((c) => c.selected)).toEqual([true, true, false, false]);
  });

  it("reopen後はcandidatesConfirmedByOrganizerが消え、選択済み候補も全削除される", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newBestOfThreeEvent();
    const { matchId, roomA } = await newMatchWithSides(eventId, sessionId);
    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });
    const c2 = await addCandidate({ matchId, offsetMinutes: 10 });

    const cand1 = await prisma.eventMatchBattleCandidate.findUniqueOrThrow({
      where: { id: c1.id },
    });
    const cand2 = await prisma.eventMatchBattleCandidate.findUniqueOrThrow({
      where: { id: c2.id },
    });
    await insertGift({
      roomId: roomA,
      diamonds: 100,
      receivedAt: new Date(cand1.startedAt.getTime() + 60_000),
    });
    await insertGift({
      roomId: roomA,
      diamonds: 100,
      receivedAt: new Date(cand2.startedAt.getTime() + 60_000),
    });

    // ここでは候補数(2件)が maxGames(3)以内なので自動選定でよいが、明示的に
    // organizerSelected を立てた状態を作りたいので selectCandidates 経由で確定する。
    await prisma.eventMatch.update({
      where: { id: matchId },
      data: { rules: { reviewReason: "CANDIDATES_EXCEEDED" } },
    });
    await addCandidate({ matchId, offsetMinutes: 20 });
    await addCandidate({ matchId, offsetMinutes: 30 });
    const all = await prisma.eventMatchBattleCandidate.findMany({ where: { matchId } });
    const fingerprint = computeCandidatesFingerprint(all);
    await patch(eventId, matchId, {
      action: "selectCandidates",
      candidateIds: [c1.id, c2.id],
      candidatesFingerprint: fingerprint,
    });

    const res = await patch(eventId, matchId, { action: "reopen" });
    expect(res.status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect((match.rules as { candidatesConfirmedByOrganizer?: boolean }).candidatesConfirmedByOrganizer).toBeUndefined();
    expect(match.status).toBe("SCHEDULED");
    const remaining = await prisma.eventMatchBattleCandidate.findMany({ where: { matchId } });
    expect(remaining).toHaveLength(0);
  });
});

describe("resetCandidates", () => {
  it("候補が1件もないマッチでは400", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newBestOfThreeEvent();
    const { matchId } = await newMatchWithSides(eventId, sessionId);

    const res = await patch(eventId, matchId, { action: "resetCandidates" });
    expect(res.status).toBe(400);
  });

  it("選択済みの候補をリセットすると、超過状態なら即座にCANDIDATES_EXCEEDEDへ戻る", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newBestOfThreeEvent();
    const { matchId } = await newMatchWithSides(eventId, sessionId);
    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });
    const c2 = await addCandidate({ matchId, offsetMinutes: 10 });
    const c3 = await addCandidate({ matchId, offsetMinutes: 20 });
    const c4 = await addCandidate({ matchId, offsetMinutes: 30 });

    const fingerprint = computeCandidatesFingerprint([c1, c2, c3, c4]);
    await patch(eventId, matchId, {
      action: "selectCandidates",
      candidateIds: [c1.id, c2.id],
      candidatesFingerprint: fingerprint,
    });

    const afterSelect = await prisma.eventMatchBattleCandidate.findMany({ where: { matchId } });
    const selectionFingerprint = computeSelectionFingerprint(afterSelect);
    const res = await patch(eventId, matchId, { action: "resetCandidates", selectionFingerprint });
    expect(res.status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe("NEEDS_REVIEW");
    expect((match.rules as { reviewReason?: string }).reviewReason).toBe("CANDIDATES_EXCEEDED");

    const candidates = await prisma.eventMatchBattleCandidate.findMany({ where: { matchId } });
    expect(candidates.every((c) => !c.organizerSelected && !c.selected)).toBe(true);
  });
});
