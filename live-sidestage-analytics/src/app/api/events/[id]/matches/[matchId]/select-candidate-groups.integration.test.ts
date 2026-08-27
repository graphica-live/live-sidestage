// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// バトル候補の「合算」機能(selectCandidateGroups)の検証。1回目のCodex独立レビューで
// 指摘されたCritical6件の直接固定を中心に、Fable-expertの2回目レビューで発見された
// 欠陥(A: フラグOFF期間のフォールバック, B: games分断, C: 低ダイヤ計算)への対応も
// select-candidate-groups側で検証できる範囲は含める。
import { createHash } from "crypto";
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
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

const { PATCH } = await import("./route");

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

function computeSelectionFingerprint(
  candidates: { id: string; organizerSelected: boolean; combinedGroupId: string | null }[]
): string {
  return createHash("sha256").update(buildSelectionFingerprintInput(candidates)).digest("hex");
}

const PREFIX = "itest_selgroups";
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

async function newEvent(winCondition: "SINGLE" | "BEST_OF_THREE") {
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
      rules: { matchRules: { winCondition } },
      sessions: { create: [{ startAt: SESSION_START, endAt: SESSION_END }] },
    },
    select: { id: true, sessions: { select: { id: true } } },
  });
  createdEventIds.push(event.id);
  return { eventId: event.id, sessionId: event.sessions[0].id };
}

/** 対戦カード1件を、両サイドの参加者・room付きで作る。status/rulesは呼び出し側が上書きする。 */
async function newMatchWithSides(
  eventId: string,
  sessionId: string,
  overrides: { status?: string; rules?: unknown } = {}
) {
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
      status: overrides.status ?? "NEEDS_REVIEW",
      rules: overrides.rules ?? { reviewReason: "CANDIDATES_EXCEEDED" },
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
  durationMinutes?: number;
}) {
  const startedAt = new Date(SESSION_START.getTime() + params.offsetMinutes * 60_000);
  const durationMs = (params.durationMinutes ?? 5) * 60_000;
  const endedAt = params.endedAt === undefined ? new Date(startedAt.getTime() + durationMs) : params.endedAt;
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
      battleId: true,
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

beforeEach(() => {
  process.env.EVENT_CANDIDATE_GROUPING = "1";
});

afterEach(() => {
  delete process.env.EVENT_CANDIDATE_GROUPING;
});

afterAll(async () => {
  if (createdEventIds.length > 0) {
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  }
  for (const id of createdRoomIds) {
    await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE id = ${id}`.catch(() => {});
  }
  await prisma.$disconnect();
});

describe("selectCandidateGroups", () => {
  it("フラグ未設定時は400になる(段階的デプロイの固定)", async () => {
    delete process.env.EVENT_CANDIDATE_GROUPING;
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent("SINGLE");
    const { matchId } = await newMatchWithSides(eventId, sessionId, {
      status: "NEEDS_REVIEW",
      rules: { reviewReason: "CANDIDATES_EXCEEDED" },
    });
    const c1 = await addCandidate({ matchId, offsetMinutes: 0 });

    const res = await patch(eventId, matchId, {
      action: "selectCandidateGroups",
      candidateIds: [c1.id],
      candidatesFingerprint: "x",
      selectionFingerprint: "x",
    });
    expect(res.status).toBe(400);
  });

  it("BO3で生候補ちょうど3件(CANDIDATES_EXCEEDEDを経由しない)から、候補調整モードでA+B合算・C単独が実行できる(指摘1の直接固定)", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent("BEST_OF_THREE");
    // status=FINISHED・winnerDecidedBy=AGGREGATEの「自動確定済み」状態を模擬する
    // (超過判定に一度も引っかからず3ゲームとして確定済みのケース)。
    const { matchId, roomA } = await newMatchWithSides(eventId, sessionId, {
      status: "FINISHED",
      rules: {},
    });
    await prisma.eventMatch.update({
      where: { id: matchId },
      data: { winnerDecidedBy: "AGGREGATE" },
    });
    const a = await addCandidate({ matchId, offsetMinutes: 0 });
    const b = await addCandidate({ matchId, offsetMinutes: 10 });
    const c = await addCandidate({ matchId, offsetMinutes: 20 });

    const all = [a, b, c];
    const candidatesFingerprint = computeCandidatesFingerprint(all);
    const selectionFingerprint = computeSelectionFingerprint(all);

    const res = await patch(eventId, matchId, {
      action: "selectCandidateGroups",
      candidateIds: [a.id, b.id, c.id],
      groups: [[a.id, b.id], [c.id]],
      candidatesFingerprint,
      selectionFingerprint,
    });
    expect(res.status).toBe(200);

    const candidates = await prisma.eventMatchBattleCandidate.findMany({
      where: { matchId },
      orderBy: { startedAt: "asc" },
    });
    // a,bは同じcombinedGroupId、cはnull。
    expect(candidates[0].combinedGroupId).not.toBeNull();
    expect(candidates[0].combinedGroupId).toBe(candidates[1].combinedGroupId);
    expect(candidates[2].combinedGroupId).toBeNull();
  });

  it("SINGLE(maxGames=1)で2件をチェックして合算できる(指摘2の直接固定)", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent("SINGLE");
    const { matchId, roomA } = await newMatchWithSides(eventId, sessionId, {
      status: "NEEDS_REVIEW",
      rules: { reviewReason: "CANDIDATES_EXCEEDED" },
    });
    const a = await addCandidate({ matchId, offsetMinutes: 0 });
    const b = await addCandidate({ matchId, offsetMinutes: 10 });

    await insertGift({ roomId: roomA, diamonds: 100, receivedAt: new Date(a.startedAt.getTime() + 60_000) });
    await insertGift({ roomId: roomA, diamonds: 50, receivedAt: new Date(b.startedAt.getTime() + 60_000) });

    const all = [a, b];
    const candidatesFingerprint = computeCandidatesFingerprint(all);
    const selectionFingerprint = computeSelectionFingerprint(all);

    const res = await patch(eventId, matchId, {
      action: "selectCandidateGroups",
      candidateIds: [a.id, b.id],
      groups: [[a.id, b.id]],
      candidatesFingerprint,
      selectionFingerprint,
    });
    expect(res.status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe("FINISHED");
    expect(match.winnerDecidedBy).toBe("AGGREGATE");

    const sides = await prisma.eventMatchSide.findMany({ where: { matchId } });
    const winner = sides.find((s) => s.id === match.winnerSideId);
    // 合算(100+50=150ダイヤ)がAの合計。
    expect(winner?.diamonds.toString()).toBe("150");
  });

  it("未来終了(未終了含む)の候補をcandidateIdsに含めると400", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent("BEST_OF_THREE");
    const { matchId } = await newMatchWithSides(eventId, sessionId, {
      status: "NEEDS_REVIEW",
      rules: { reviewReason: "CANDIDATES_EXCEEDED" },
    });
    const a = await addCandidate({ matchId, offsetMinutes: 0 });
    const future = await addCandidate({
      matchId,
      offsetMinutes: 10,
      endedAt: new Date(NOW + 999 * 86_400_000), // 遠い未来
    });

    const all = [a, future];
    const res = await patch(eventId, matchId, {
      action: "selectCandidateGroups",
      candidateIds: [a.id, future.id],
      candidatesFingerprint: computeCandidatesFingerprint(all),
      selectionFingerprint: computeSelectionFingerprint(all),
    });
    expect(res.status).toBe(400);
  });

  it("groups内で重複IDがあると400(GROUP_DUPLICATE_ID)", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent("BEST_OF_THREE");
    const { matchId } = await newMatchWithSides(eventId, sessionId, {
      status: "NEEDS_REVIEW",
      rules: { reviewReason: "CANDIDATES_EXCEEDED" },
    });
    const a = await addCandidate({ matchId, offsetMinutes: 0 });
    const b = await addCandidate({ matchId, offsetMinutes: 10 });
    const c = await addCandidate({ matchId, offsetMinutes: 20 });
    const all = [a, b, c];

    const res = await patch(eventId, matchId, {
      action: "selectCandidateGroups",
      candidateIds: [a.id, b.id, c.id],
      groups: [[a.id, b.id], [b.id, c.id]],
      candidatesFingerprint: computeCandidatesFingerprint(all),
      selectionFingerprint: computeSelectionFingerprint(all),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("GROUP_DUPLICATE_ID");
  });

  it("非連続なグループ(a,cを合算しbを挟む)はGROUP_NOT_CONTIGUOUSで400", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent("BEST_OF_THREE");
    const { matchId } = await newMatchWithSides(eventId, sessionId, {
      status: "NEEDS_REVIEW",
      rules: { reviewReason: "CANDIDATES_EXCEEDED" },
    });
    const a = await addCandidate({ matchId, offsetMinutes: 0 });
    const b = await addCandidate({ matchId, offsetMinutes: 10 });
    const c = await addCandidate({ matchId, offsetMinutes: 20 });
    const all = [a, b, c];

    const res = await patch(eventId, matchId, {
      action: "selectCandidateGroups",
      candidateIds: [a.id, b.id, c.id],
      groups: [[a.id, c.id], [b.id]],
      candidatesFingerprint: computeCandidatesFingerprint(all),
      selectionFingerprint: computeSelectionFingerprint(all),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("GROUP_NOT_CONTIGUOUS");
  });

  it("startedAt変更後(検知ワーカーの再検知を模擬)、古いcandidatesFingerprintでは409", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent("BEST_OF_THREE");
    const { matchId } = await newMatchWithSides(eventId, sessionId, {
      status: "NEEDS_REVIEW",
      rules: { reviewReason: "CANDIDATES_EXCEEDED" },
    });
    const a = await addCandidate({ matchId, offsetMinutes: 0 });
    const staleFingerprint = computeCandidatesFingerprint([a]);

    // startedAt だけ書き換える(検知ワーカーの upsert を模擬)。
    await prisma.eventMatchBattleCandidate.update({
      where: { id: a.id },
      data: { startedAt: new Date(a.startedAt.getTime() + 5_000) },
    });

    const res = await patch(eventId, matchId, {
      action: "selectCandidateGroups",
      candidateIds: [a.id],
      candidatesFingerprint: staleFingerprint,
      selectionFingerprint: computeSelectionFingerprint([a]),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CANDIDATES_CHANGED");
  });

  it("既にcurated済みの対戦への再selectCandidateGroupsは、古いselectionFingerprintで409(SELECTION_CHANGED)", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent("BEST_OF_THREE");
    const { matchId } = await newMatchWithSides(eventId, sessionId, {
      status: "NEEDS_REVIEW",
      rules: { reviewReason: "CANDIDATES_EXCEEDED" },
    });
    const a = await addCandidate({ matchId, offsetMinutes: 0 });
    const b = await addCandidate({ matchId, offsetMinutes: 10 });
    const c = await addCandidate({ matchId, offsetMinutes: 20 });
    const all = [a, b, c];
    const staleSelectionFingerprint = computeSelectionFingerprint(all);

    // 一度確定する(選択状態が変わる)。
    await patch(eventId, matchId, {
      action: "selectCandidateGroups",
      candidateIds: [a.id, b.id, c.id],
      groups: [[a.id], [b.id], [c.id]],
      candidatesFingerprint: computeCandidatesFingerprint(all),
      selectionFingerprint: staleSelectionFingerprint,
    });

    // 古い(確定前の)selectionFingerprintで再送すると409。
    const res = await patch(eventId, matchId, {
      action: "selectCandidateGroups",
      candidateIds: [a.id, b.id],
      groups: [[a.id, b.id]],
      candidatesFingerprint: computeCandidatesFingerprint(all),
      selectionFingerprint: staleSelectionFingerprint,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("SELECTION_CHANGED");
  });

  it("合算グループのdecidedAtはグループ内最終endedAtになる", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent("SINGLE");
    const { matchId, roomA } = await newMatchWithSides(eventId, sessionId, {
      status: "NEEDS_REVIEW",
      rules: { reviewReason: "CANDIDATES_EXCEEDED" },
    });
    const a = await addCandidate({ matchId, offsetMinutes: 0, durationMinutes: 3 });
    const b = await addCandidate({ matchId, offsetMinutes: 10, durationMinutes: 5 });
    await insertGift({ roomId: roomA, diamonds: 10, receivedAt: new Date(a.startedAt.getTime() + 60_000) });

    const all = [a, b];
    const res = await patch(eventId, matchId, {
      action: "selectCandidateGroups",
      candidateIds: [a.id, b.id],
      groups: [[a.id, b.id]],
      candidatesFingerprint: computeCandidatesFingerprint(all),
      selectionFingerprint: computeSelectionFingerprint(all),
    });
    expect(res.status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.decidedAt?.toISOString()).toBe(b.endedAt!.toISOString());
  });

  it("合算後のEventMatchSide.diamondsが2候補の合算値と一致し、両メンバーがselected=trueになる", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent("SINGLE");
    const { matchId, roomA } = await newMatchWithSides(eventId, sessionId, {
      status: "NEEDS_REVIEW",
      rules: { reviewReason: "CANDIDATES_EXCEEDED" },
    });
    const a = await addCandidate({ matchId, offsetMinutes: 0 });
    const b = await addCandidate({ matchId, offsetMinutes: 10 });
    await insertGift({ roomId: roomA, diamonds: 30, receivedAt: new Date(a.startedAt.getTime() + 60_000) });
    await insertGift({ roomId: roomA, diamonds: 70, receivedAt: new Date(b.startedAt.getTime() + 60_000) });

    const all = [a, b];
    await patch(eventId, matchId, {
      action: "selectCandidateGroups",
      candidateIds: [a.id, b.id],
      groups: [[a.id, b.id]],
      candidatesFingerprint: computeCandidatesFingerprint(all),
      selectionFingerprint: computeSelectionFingerprint(all),
    });

    const sides = await prisma.eventMatchSide.findMany({ where: { matchId } });
    const total = sides.reduce((acc, s) => acc + Number(s.diamonds), 0);
    expect(total).toBe(100);

    const candidates = await prisma.eventMatchBattleCandidate.findMany({ where: { matchId } });
    expect(candidates.every((c) => c.selected)).toBe(true);
  });

  it("旧selectCandidates(groups無し)は従来どおり動作する(回帰確認)", async () => {
    auth.userId = OWNER;
    const { eventId, sessionId } = await newEvent("SINGLE");
    const { matchId, roomA } = await newMatchWithSides(eventId, sessionId, {
      status: "NEEDS_REVIEW",
      rules: { reviewReason: "CANDIDATES_EXCEEDED" },
    });
    const a = await addCandidate({ matchId, offsetMinutes: 0 });
    await insertGift({ roomId: roomA, diamonds: 10, receivedAt: new Date(a.startedAt.getTime() + 60_000) });

    const res = await patch(eventId, matchId, {
      action: "selectCandidates",
      candidateIds: [a.id],
      candidatesFingerprint: computeCandidatesFingerprint([a]),
    });
    expect(res.status).toBe(200);

    const candidates = await prisma.eventMatchBattleCandidate.findMany({ where: { matchId } });
    expect(candidates[0].combinedGroupId).toBeNull();
    expect(candidates[0].organizerSelected).toBe(true);
  });
});
