// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// **AMBIGUOUS / END_UNKNOWN の対戦を引き分けで確定したら、検知情報を捨てること。**
//
// `confirm`(勝者の手動確定)は以前からこれをやっていたが、`draw` は検知を残したまま
// FINISHED にしていた。`loadBattleRangesByRoom()` は「FINISHED かつ両端あり」を拾うので、
// 「どのバトルか特定できていないため承認させない」はずの区間が、
// **バトル中のみ集計する種目では順位・リスナー貢献の母集団そのもの**になってしまう。
import { describe, it, expect, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const auth = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: async () => (auth.userId ? { user: { id: auth.userId } } : null),
}));

// next-auth をモックしてから読む(authz.ts が import 時に束縛するため)。
const { PATCH } = await import("./route");

const PREFIX = "itest_drawdetect";
const OWNER = `${PREFIX}_owner`;
const NOW = Date.now();
const START = new Date(NOW - 3 * 86_400_000);
const END = new Date(NOW + 3 * 86_400_000);
const BATTLE_START = new Date(NOW - 2 * 86_400_000);
const BATTLE_END = new Date(BATTLE_START.getTime() + 10 * 60_000);

let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;
const createdEventIds: string[] = [];

async function newDeathmatchWithMatch(reviewReason: string | null) {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} デスマッチ`,
      ownerUserId: OWNER,
      format: "DEATHMATCH",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: START,
      endAt: END,
      sessions: { create: [{ startAt: START, endAt: END }] },
    },
    select: { id: true, sessions: { select: { id: true } } },
  });
  createdEventIds.push(event.id);

  const match = await prisma.eventMatch.create({
    data: {
      eventId: event.id,
      sessionId: event.sessions[0].id,
      round: 1,
      bracketPosition: 0,
      matchType: "ONE_V_ONE",
      status: "NEEDS_REVIEW",
      detectedBattleId: `${PREFIX}_battle_${uniqueSuffix()}`,
      detectedStartAt: BATTLE_START,
      detectedEndAt: BATTLE_END,
      detectionConfidence: "exact",
      detectedEndSource: "observed",
      rules: reviewReason ? { reviewReason } : {},
      sides: {
        create: [
          { sideIndex: 0 },
          { sideIndex: 1 },
        ],
      },
    },
    select: { id: true },
  });

  return { eventId: event.id, matchId: match.id };
}

async function drawMatch(eventId: string, matchId: string) {
  const req = new NextRequest(`http://localhost/api/events/${eventId}/matches/${matchId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "draw" }),
  });
  return PATCH(req, { params: { id: eventId, matchId } });
}

afterAll(async () => {
  if (createdEventIds.length > 0) {
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  }
  await prisma.$disconnect();
});

describe("引き分け確定と検知情報", () => {
  it("AMBIGUOUS の対戦を引き分けにしたら検知情報を捨てる", async () => {
    auth.userId = OWNER;
    const { eventId, matchId } = await newDeathmatchWithMatch("AMBIGUOUS");

    const res = await drawMatch(eventId, matchId);
    expect(res.status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe("FINISHED");
    expect(match.winnerDecidedBy).toBe("DRAW");
    // 決着時刻はライフの適用順に要るので残す。
    expect(match.decidedAt).not.toBeNull();
    // 区間が確定していないので、集計の母集団に入れてはいけない。
    expect(match.detectedBattleId).toBeNull();
    expect(match.detectedStartAt).toBeNull();
    expect(match.detectedEndAt).toBeNull();
    expect(match.detectionConfidence).toBeNull();
    expect(match.detectedEndSource).toBeNull();
  });

  it("END_UNKNOWN の対戦を引き分けにしたら検知情報を捨てる", async () => {
    auth.userId = OWNER;
    const { eventId, matchId } = await newDeathmatchWithMatch("END_UNKNOWN");

    expect((await drawMatch(eventId, matchId)).status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.detectedBattleId).toBeNull();
    expect(match.detectedEndAt).toBeNull();
  });

  it("特定できている検知は引き分けにしても残す(バトル区間は集計対象のまま)", async () => {
    auth.userId = OWNER;
    // reviewReason 無し = どのバトルかは確定している。同点だから引き分けにしただけ。
    const { eventId, matchId } = await newDeathmatchWithMatch(null);

    expect((await drawMatch(eventId, matchId)).status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe("FINISHED");
    expect(match.winnerDecidedBy).toBe("DRAW");
    expect(match.detectedBattleId).not.toBeNull();
    expect(match.detectedStartAt).toEqual(BATTLE_START);
    expect(match.detectedEndAt).toEqual(BATTLE_END);
  });
});
