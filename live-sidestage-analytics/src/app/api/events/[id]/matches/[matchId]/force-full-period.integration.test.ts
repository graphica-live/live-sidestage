// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// ⚠️トラブル対処フラグ(forceFullPeriod)の固定テスト。
// - FINISHED の対戦にしか設定できない(不変条件)
// - loadBattleRangesByRoom が検知区間ではなく開催日程まるごとを返すようになる
// - reopen / void を通ると自動的に消える
import { describe, it, expect, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadBattleRangesByRoom } from "@/event/battles";

const auth = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: async () => (auth.userId ? { user: { id: auth.userId } } : null),
}));

// next-auth をモックしてから読む(authz.ts が import 時に束縛するため)。
const { PATCH } = await import("./route");

const PREFIX = "itest_ffp";
const OWNER = `${PREFIX}_owner`;
const NOW = Date.now();
const START = new Date(NOW - 3 * 86_400_000);
const END = new Date(NOW + 3 * 86_400_000);

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

async function newTournamentWithMatch(params: {
  status: string;
  winnerDecidedBy?: string | null;
  bye?: boolean;
}) {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} トーナメント`,
      ownerUserId: OWNER,
      format: "TOURNAMENT",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: START,
      endAt: END,
      sessions: { create: [{ startAt: START, endAt: END }] },
    },
    select: { id: true, sessions: { select: { id: true } } },
  });
  createdEventIds.push(event.id);

  const roomA = await createRoom(`${PREFIX}_a_${uniqueSuffix()}`);
  const roomB = await createRoom(`${PREFIX}_b_${uniqueSuffix()}`);
  const [a, b] = await Promise.all([
    prisma.eventParticipant.create({
      data: { eventId: event.id, tiktokId: `${PREFIX}_a_${uniqueSuffix()}`, roomId: roomA, displayName: "A" },
      select: { id: true },
    }),
    prisma.eventParticipant.create({
      data: { eventId: event.id, tiktokId: `${PREFIX}_b_${uniqueSuffix()}`, roomId: roomB, displayName: "B" },
      select: { id: true },
    }),
  ]);

  const match = await prisma.eventMatch.create({
    data: {
      eventId: event.id,
      sessionId: event.sessions[0].id,
      round: 1,
      bracketPosition: 0,
      status: params.status,
      winnerDecidedBy: params.winnerDecidedBy ?? null,
      decidedAt: params.status === "FINISHED" ? new Date() : null,
      rules: params.bye ? { bye: true } : {},
      sides: {
        create: [
          { sideIndex: 0, participants: { create: [{ participantId: a.id }] } },
          { sideIndex: 1, participants: { create: [{ participantId: b.id }] } },
        ],
      },
    },
    select: { id: true },
  });

  return { eventId: event.id, matchId: match.id, roomA, roomB };
}

async function send(eventId: string, matchId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/events/${eventId}/matches/${matchId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: { id: eventId, matchId } });
}

afterAll(async () => {
  for (const id of createdEventIds) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdRoomIds) {
    await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE id = ${id}`.catch(() => {});
  }
  await prisma.$disconnect();
});

describe("⚠️トラブル対処フラグ(forceFullPeriod)", () => {
  it("FINISHED の対戦で有効にすると、開催日程まるごとが集計区間になる", async () => {
    auth.userId = OWNER;
    const { eventId, matchId, roomA, roomB } = await newTournamentWithMatch({
      status: "FINISHED",
      winnerDecidedBy: "MANUAL",
    });

    const res = await send(eventId, matchId, { action: "forceFullPeriod", enabled: true });
    expect(res.status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect((match.rules as { forceFullPeriod?: boolean }).forceFullPeriod).toBe(true);

    const ranges = await loadBattleRangesByRoom(prisma, eventId);
    for (const roomId of [roomA, roomB]) {
      const r = ranges.get(roomId);
      expect(r).toBeDefined();
      expect(r![0].start.getTime()).toBe(START.getTime());
      expect(r![0].end.getTime()).toBe(END.getTime());
    }
  });

  it("FINISHED 以外の対戦には設定できない", async () => {
    auth.userId = OWNER;
    const { eventId, matchId } = await newTournamentWithMatch({ status: "NEEDS_REVIEW" });

    const res = await send(eventId, matchId, { action: "forceFullPeriod", enabled: true });
    expect(res.status).toBe(400);
  });

  it("不戦勝の対戦には設定できない", async () => {
    auth.userId = OWNER;
    const { eventId, matchId } = await newTournamentWithMatch({
      status: "FINISHED",
      winnerDecidedBy: "BYE",
      bye: true,
    });

    const res = await send(eventId, matchId, { action: "forceFullPeriod", enabled: true });
    expect(res.status).toBe(400);
  });

  it("enabled を真偽値以外で送ると拒否する", async () => {
    auth.userId = OWNER;
    const { eventId, matchId } = await newTournamentWithMatch({
      status: "FINISHED",
      winnerDecidedBy: "MANUAL",
    });

    const res = await send(eventId, matchId, { action: "forceFullPeriod" });
    expect(res.status).toBe(400);
  });

  it("検知をやり直す(reopen)とフラグが消える", async () => {
    auth.userId = OWNER;
    const { eventId, matchId } = await newTournamentWithMatch({
      status: "FINISHED",
      winnerDecidedBy: "MANUAL",
    });
    expect((await send(eventId, matchId, { action: "forceFullPeriod", enabled: true })).status).toBe(200);

    expect((await send(eventId, matchId, { action: "reopen" })).status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe("SCHEDULED");
    expect((match.rules as { forceFullPeriod?: boolean }).forceFullPeriod).toBeUndefined();
  });

  it("無効にする(void)とフラグが消える", async () => {
    auth.userId = OWNER;
    const { eventId, matchId } = await newTournamentWithMatch({
      status: "FINISHED",
      winnerDecidedBy: "MANUAL",
    });
    expect((await send(eventId, matchId, { action: "forceFullPeriod", enabled: true })).status).toBe(200);

    expect((await send(eventId, matchId, { action: "void" })).status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe("VOID");
    expect((match.rules as { forceFullPeriod?: boolean }).forceFullPeriod).toBeUndefined();
  });

  it("再度 enabled: false を送ると解除できる", async () => {
    auth.userId = OWNER;
    const { eventId, matchId } = await newTournamentWithMatch({
      status: "FINISHED",
      winnerDecidedBy: "MANUAL",
    });
    expect((await send(eventId, matchId, { action: "forceFullPeriod", enabled: true })).status).toBe(200);
    expect((await send(eventId, matchId, { action: "forceFullPeriod", enabled: false })).status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect((match.rules as { forceFullPeriod?: boolean }).forceFullPeriod).toBeUndefined();
  });
});
