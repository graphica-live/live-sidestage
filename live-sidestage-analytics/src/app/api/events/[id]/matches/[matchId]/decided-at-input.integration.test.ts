// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// confirm/draw で主催者が「決着時刻(decidedAt)」を任意指定できることの検証。
//
// **背景**: decidedAt は下流ラウンドのバトル検知の下限(feederDecidedAt、match-detect.ts)と
// デスマッチのライフ適用順(life-points.ts)の両方に使われる。以前は
// `match.decidedAt ?? new Date()` — 既存の検知時刻が無ければ「主催者がボタンを押した瞬間の
// 時刻」がそのまま記録されていた。準決勝の手動確定が実際の対戦翌日にずれ込み、その時刻が
// 決勝の feederDecidedAt として使われた結果、前夜に正常終了していた決勝の本物のバトルが
// 検知候補から除外される実際の不具合(2026-08-26 awake-vol-3-kcmkdz)が起きたため、
// 主催者が実際の決着時刻を入力できるようにした(src/event/CLAUDE.md 参照)。
import { describe, it, expect, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const auth = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: async () => (auth.userId ? { user: { id: auth.userId } } : null),
}));

// next-auth をモックしてから読む(authz.ts が import 時に束縛するため)。
const { PATCH } = await import("./route");

const PREFIX = "itest_decidedat";
const OWNER = `${PREFIX}_owner`;
const NOW = Date.now();
const START = new Date(NOW - 3 * 86_400_000);
const END = new Date(NOW + 3 * 86_400_000);

let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;
const createdEventIds: string[] = [];

async function newDeathmatchWithMatch() {
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
      status: "SCHEDULED",
      rules: {},
      sides: { create: [{ sideIndex: 0 }, { sideIndex: 1 }] },
    },
    select: { id: true, sides: { select: { id: true, sideIndex: true } } },
  });

  return { eventId: event.id, matchId: match.id, sides: match.sides };
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
  await prisma.$disconnect();
});

describe("手動確定時の決着時刻(decidedAt)指定", () => {
  it("confirm で decidedAt を指定すると、JST解釈した時刻がそのまま保存される", async () => {
    auth.userId = OWNER;
    const { eventId, matchId, sides } = await newDeathmatchWithMatch();

    const res = await patch(eventId, matchId, {
      action: "confirm",
      winnerSideId: sides[0].id,
      decidedAt: "2026-08-26T22:06",
    });
    expect(res.status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    // JST 22:06 = UTC 13:06(同日)。
    expect(match.decidedAt?.toISOString()).toBe("2026-08-26T13:06:00.000Z");
  });

  it("decidedAt を省略すると、従来どおり現在時刻が使われる", async () => {
    auth.userId = OWNER;
    const { eventId, matchId } = await newDeathmatchWithMatch();
    const before = Date.now();

    const res = await patch(eventId, matchId, { action: "draw" });
    expect(res.status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.decidedAt).not.toBeNull();
    expect(match.decidedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("decidedAt の形式が不正なら400を返し、対戦は更新されない", async () => {
    auth.userId = OWNER;
    const { eventId, matchId, sides } = await newDeathmatchWithMatch();

    const res = await patch(eventId, matchId, {
      action: "confirm",
      winnerSideId: sides[0].id,
      decidedAt: "not-a-date",
    });
    expect(res.status).toBe(400);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe("SCHEDULED");
    expect(match.decidedAt).toBeNull();
  });

  it("未来の時刻でも拒否しない(イベント進行の押し・延びは予測できないため主催者の裁量を優先する設計)", async () => {
    auth.userId = OWNER;
    const { eventId, matchId, sides } = await newDeathmatchWithMatch();

    const res = await patch(eventId, matchId, {
      action: "confirm",
      winnerSideId: sides[0].id,
      decidedAt: "2030-01-01T00:00",
    });
    expect(res.status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    // JST 2030-01-01 00:00 = UTC 2029-12-31 15:00。
    expect(match.decidedAt?.toISOString()).toBe("2029-12-31T15:00:00.000Z");
  });

  it("既存の decidedAt があれば、主催者の入力値より優先される(再送でライフ順序を変えない)", async () => {
    auth.userId = OWNER;
    const { eventId, matchId, sides } = await newDeathmatchWithMatch();
    const original = new Date(NOW - 86_400_000);
    await prisma.eventMatch.update({ where: { id: matchId }, data: { decidedAt: original } });

    const res = await patch(eventId, matchId, {
      action: "confirm",
      winnerSideId: sides[0].id,
      decidedAt: "2026-08-26T22:06",
    });
    expect(res.status).toBe(200);

    const match = await prisma.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.decidedAt?.toISOString()).toBe(original.toISOString());
  });
});
