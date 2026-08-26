// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// 開催後(対戦カードが1件でもある)は matchRules.winCondition を変更できない
// (種目と同じ「作成後は変更できない」扱い)。過去のFINISHEDマッチが未決着に戻るのを防ぐ。
import { describe, it, expect, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const auth = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: async () => (auth.userId ? { user: { id: auth.userId } } : null),
}));

// next-auth をモックしてから読む(authz.ts が import 時に束縛するため)。
const { PATCH } = await import("./route");

const PREFIX = "itest_wincond";
const OWNER = `${PREFIX}_owner`;
const START = new Date("2026-09-01T00:00:00.000Z");
const END = new Date("2026-09-08T00:00:00.000Z");

let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;
const createdEventIds: string[] = [];

async function newTournament(winCondition: string) {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} イベント`,
      ownerUserId: OWNER,
      format: "TOURNAMENT",
      entryMode: "SOLO",
      status: "SCHEDULED",
      startAt: START,
      endAt: END,
      rules: { matchRules: { winCondition } },
      sessions: { create: [{ startAt: START, endAt: END }] },
    },
    select: { id: true, title: true },
  });
  createdEventIds.push(event.id);
  return event;
}

async function addMatch(eventId: string) {
  const session = await prisma.eventSession.findFirstOrThrow({
    where: { eventId },
    select: { id: true },
  });
  await prisma.eventMatch.create({
    data: { eventId, sessionId: session.id, round: 1, bracketPosition: 0, matchType: "1V1" },
  });
}

function baseBody(title: string, matchRules: Record<string, unknown>) {
  return {
    title,
    description: "",
    entryMode: "SOLO",
    matchRules,
  };
}

function patchEvent(eventId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: { id: eventId } });
}

afterAll(async () => {
  if (createdEventIds.length > 0) {
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  }
  await prisma.$disconnect();
});

describe("開催後のwinCondition変更禁止", () => {
  it("対戦カードが1件も無ければ勝利条件を変更できる", async () => {
    auth.userId = OWNER;
    const event = await newTournament("SINGLE");

    const res = await patchEvent(
      event.id,
      baseBody(event.title, { winCondition: "BEST_OF_THREE" })
    );
    expect(res.status).toBe(200);

    const updated = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(
      (updated.rules as { matchRules?: { winCondition?: string } }).matchRules?.winCondition
    ).toBe("BEST_OF_THREE");
  });

  it("対戦カードが1件でもあれば勝利条件の変更は409で拒否される", async () => {
    auth.userId = OWNER;
    const event = await newTournament("SINGLE");
    await addMatch(event.id);

    const res = await patchEvent(
      event.id,
      baseBody(event.title, { winCondition: "BEST_OF_THREE" })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("WIN_CONDITION_IMMUTABLE");

    // 実際には変更されていないことを確認する。
    const updated = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(
      (updated.rules as { matchRules?: { winCondition?: string } }).matchRules?.winCondition
    ).toBe("SINGLE");
  });

  it("対戦カードがあってもwinCondition以外(グローブ等)の変更は通る", async () => {
    auth.userId = OWNER;
    const event = await newTournament("SINGLE");
    await addMatch(event.id);

    const res = await patchEvent(
      event.id,
      baseBody(event.title, { winCondition: "SINGLE", glove: "FREE" })
    );
    expect(res.status).toBe(200);

    const updated = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    const matchRules = (updated.rules as { matchRules?: { glove?: string; winCondition?: string } })
      .matchRules;
    expect(matchRules?.glove).toBe("FREE");
    expect(matchRules?.winCondition).toBe("SINGLE");
  });
});
