// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// public.gifts を直接読むので、`npm run db:push:local` 済みのDBが要る。
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { loadMatchContributions } from "./match-contributions";
import { resolveMatchResults } from "./match-results";
import { parseMatchRules } from "./match-rules";
import type { EventWindow } from "./sessions";

const PREFIX = "itest_mcontrib";

/** 開催日程は 1本だけ。バトルはこの中の 13:10-13:20 に置く。 */
const SESSION_START = new Date("2026-09-01T13:00:00.000Z");
const SESSION_END = new Date("2026-09-01T14:00:00.000Z");
const BATTLE_START = new Date("2026-09-01T13:10:00.000Z");
const BATTLE_END = new Date("2026-09-01T13:20:00.000Z");
/** バトルが終わったあとの時刻。これを `now` として渡す。 */
const NOW = new Date("2026-09-01T13:30:00.000Z");

const WINDOWS: EventWindow[] = [
  { id: null, start: SESSION_START, end: SESSION_END, name: null },
];

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
  repeatCount?: number;
  nickname?: string;
}) {
  await prisma.$executeRaw`
    INSERT INTO public.gifts
      (id, "roomId", "uniqueId", nickname, "giftId", "giftName", "repeatCount",
       "diamondCount", "totalDiamonds", "receivedAt", "dayKey", "orderId")
    VALUES
      (gen_random_uuid()::text, ${params.roomId}, ${params.uniqueId},
       ${params.nickname ?? params.uniqueId}, 5, 'Rose', ${params.repeatCount ?? 1},
       ${params.diamonds}, ${params.diamonds}, ${params.receivedAt}, '2026-09-01',
       ${`${PREFIX}_${uniqueSuffix()}`})
  `;
}

async function newEvent() {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 対戦内訳テスト`,
      ownerUserId: `${PREFIX}_owner`,
      format: "TOURNAMENT",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: SESSION_START,
      endAt: SESSION_END,
      sessions: { create: [{ startAt: SESSION_START, endAt: SESSION_END }] },
    },
    select: { id: true, sessions: { select: { id: true } } },
  });
  createdEventIds.push(event.id);
  return { id: event.id, sessionId: event.sessions[0].id };
}

async function newParticipant(eventId: string, name: string) {
  const tiktokId = `${PREFIX}_${name}_${uniqueSuffix()}`;
  const roomId = await createRoom(tiktokId);
  const participant = await prisma.eventParticipant.create({
    data: { eventId, tiktokId, roomId, displayName: name },
    select: { id: true },
  });
  return { id: participant.id, roomId, tiktokId };
}

async function createMatch(params: {
  eventId: string;
  sessionId: string;
  status?: string;
  detectedStartAt?: Date | null;
  detectedEndAt?: Date | null;
  winnerDecidedBy?: string | null;
  /** サイドごとの参加者ID。2要素なら 1vs1、内側が2人なら 2vs2 */
  sides: string[][];
}): Promise<string> {
  const battleId = params.detectedStartAt ? `${PREFIX}_battle_${uniqueSuffix()}` : null;
  const match = await prisma.eventMatch.create({
    data: {
      eventId: params.eventId,
      sessionId: params.sessionId,
      round: 1,
      bracketPosition: 0,
      matchType: params.sides.some((s) => s.length > 1) ? "2V2" : "1V1",
      status: params.status ?? "DETECTED",
      detectedBattleId: battleId,
      detectedStartAt: params.detectedStartAt ?? null,
      detectedEndAt: params.detectedEndAt ?? null,
      detectionConfidence: params.detectedStartAt ? "exact" : null,
      winnerDecidedBy: params.winnerDecidedBy ?? null,
      sides: {
        create: params.sides.map((participantIds, sideIndex) => ({
          sideIndex,
          participants: { create: participantIds.map((participantId) => ({ participantId })) },
        })),
      },
    },
    select: { id: true },
  });

  // **勝敗確定の正本は候補(`EventMatchBattleCandidate`)。** 検知列(detectedStartAt/EndAt)は
  // その実効ゲーム集合のミラーでしかないので、埋めるだけでは `resolveMatchSeries()` が
  // 「候補0件」とみなして SCHEDULED へ差し戻す。同じ区間の候補を1件作っておく。
  if (battleId && params.detectedStartAt && params.detectedEndAt) {
    await prisma.eventMatchBattleCandidate.create({
      data: {
        matchId: match.id,
        battleId,
        startedAt: params.detectedStartAt,
        endedAt: params.detectedEndAt,
        endedAtSource: "observed",
        confidence: "exact",
        selected: true,
      },
    });
  }

  return match.id;
}

/** バトル区間の内・外にギフトを1件ずつ置く。戻り値は「区間内のダイヤ」。 */
async function seedGifts(roomId: string, uniqueId: string, insideDiamonds: number) {
  // 区間の外(開始前・終了後)。数えてはいけない。
  await insertGift({ roomId, uniqueId, diamonds: 999, receivedAt: new Date("2026-09-01T13:05:00.000Z") });
  await insertGift({ roomId, uniqueId, diamonds: 999, receivedAt: new Date("2026-09-01T13:25:00.000Z") });
  await insertGift({
    roomId,
    uniqueId,
    diamonds: insideDiamonds,
    receivedAt: new Date("2026-09-01T13:15:00.000Z"),
  });
  return insideDiamonds;
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
  await prisma.$disconnect();
});

describe("loadMatchContributions", () => {
  it("検知区間のギフトだけを枠ごとに集計する", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await seedGifts(a.roomId, "alice", 500);
    await insertGift({
      roomId: a.roomId,
      uniqueId: "bob",
      diamonds: 300,
      receivedAt: new Date("2026-09-01T13:16:00.000Z"),
    });
    await seedGifts(b.roomId, "carol", 400);

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      detectedStartAt: BATTLE_START,
      detectedEndAt: BATTLE_END,
      sides: [[a.id], [b.id]],
    });

    const result = await loadMatchContributions(prisma, {
      eventId: event.id,
      matchId,
      now: NOW,
    });

    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;

    expect(result.provisional).toBe(false);
    expect(result.unconfirmed).toBe(false);
    expect(result.hasMultiplier).toBe(false);
    expect(result.slots).toHaveLength(2);

    // 区間外の 999 ダイヤ × 2件は入らない。
    expect(result.slots[0]).toMatchObject({ participantId: a.id, sideIndex: 0, diamonds: "800" });
    expect(result.slots[0].listeners.map((l) => [l.uniqueId, l.diamonds])).toEqual([
      ["alice", "500"],
      ["bob", "300"],
    ]);
    expect(result.slots[1]).toMatchObject({ participantId: b.id, sideIndex: 1, diamonds: "400" });
    expect(result.slots[1].listeners.map((l) => l.uniqueId)).toEqual(["carol"]);
  });

  it("開催日程からはみ出したぶんは数えない", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    // 日程の中(13:59)と外(14:04)にそれぞれ置く。
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 100,
      receivedAt: new Date("2026-09-01T13:59:00.000Z"),
    });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 700,
      receivedAt: new Date("2026-09-01T14:04:00.000Z"),
    });

    // 22:59 開始 → 23:04 終了。日程の終わりをまたいだバトル。
    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      detectedStartAt: new Date("2026-09-01T13:59:00.000Z"),
      detectedEndAt: new Date("2026-09-01T14:04:00.000Z"),
      sides: [[a.id], [b.id]],
    });

    const result = await loadMatchContributions(prisma, {
      eventId: event.id,
      matchId,
      now: new Date("2026-09-01T15:00:00.000Z"),
    });

    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;
    expect(result.slots[0].diamonds).toBe("100");
  });

  it("バトルを検知していない対戦は no-detection", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      status: "SCHEDULED",
      sides: [[a.id], [b.id]],
    });

    const result = await loadMatchContributions(prisma, { eventId: event.id, matchId, now: NOW });
    expect(result?.status).toBe("no-detection");
  });

  it("終了を観測できないまま日程が終わった対戦(END_UNKNOWN)は no-end", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await seedGifts(a.roomId, "alice", 500);

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      status: "NEEDS_REVIEW",
      detectedStartAt: BATTLE_START,
      detectedEndAt: null,
      sides: [[a.id], [b.id]],
    });

    const result = await loadMatchContributions(prisma, { eventId: event.id, matchId, now: NOW });
    expect(result?.status).toBe("no-end");
  });

  it("バトル進行中(LIVE)は now までを provisional として返す", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    // 区間は 13:10(開始) 〜 13:30(now)。開始前は入らず、now までは全部入る。
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 999,
      receivedAt: new Date("2026-09-01T13:05:00.000Z"),
    });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 500,
      receivedAt: new Date("2026-09-01T13:15:00.000Z"),
    });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 300,
      receivedAt: new Date("2026-09-01T13:25:00.000Z"),
    });
    // now より後のギフトは、まだ受け取っていないので入らない。
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 999,
      receivedAt: new Date("2026-09-01T13:35:00.000Z"),
    });

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      status: "LIVE",
      detectedStartAt: BATTLE_START,
      detectedEndAt: null,
      sides: [[a.id], [b.id]],
    });

    const result = await loadMatchContributions(prisma, { eventId: event.id, matchId, now: NOW });
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;
    expect(result.provisional).toBe(true);
    expect(result.slots[0].diamonds).toBe("800");
  });

  it("LIVE で detectedEndAt が未来(duration 由来)でも now で切る", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await seedGifts(a.roomId, "alice", 500);
    // now(13:30)より後。duration から計算された将来の終了時刻。
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 999,
      receivedAt: new Date("2026-09-01T13:40:00.000Z"),
    });

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      status: "LIVE",
      detectedStartAt: BATTLE_START,
      detectedEndAt: new Date("2026-09-01T13:50:00.000Z"),
      sides: [[a.id], [b.id]],
    });

    const result = await loadMatchContributions(prisma, { eventId: event.id, matchId, now: NOW });
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;
    expect(result.provisional).toBe(true);
    // 13:15(500) + 13:25(999)。13:40 のぶんは now より後なので入らない。
    expect(result.slots[0].diamonds).toBe("1499");
  });

  it("確定していない対戦(NEEDS_REVIEW)は unconfirmed を立てたうえで数字を出す", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await seedGifts(a.roomId, "alice", 500);

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      status: "NEEDS_REVIEW",
      detectedStartAt: BATTLE_START,
      detectedEndAt: BATTLE_END,
      sides: [[a.id], [b.id]],
    });

    const result = await loadMatchContributions(prisma, { eventId: event.id, matchId, now: NOW });
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;
    expect(result.unconfirmed).toBe(true);
    expect(result.slots[0].diamonds).toBe("500");
  });

  it("バトル倍率を適用したポイントを返す", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await seedGifts(a.roomId, "alice", 500);

    await prisma.eventMultiplier.create({
      data: { eventId: event.id, kind: "BATTLE", factor: "2.5", startAt: null, endAt: null },
    });

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      detectedStartAt: BATTLE_START,
      detectedEndAt: BATTLE_END,
      sides: [[a.id], [b.id]],
    });

    const result = await loadMatchContributions(prisma, { eventId: event.id, matchId, now: NOW });
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;
    expect(result.hasMultiplier).toBe(true);
    expect(result.slots[0].diamonds).toBe("500");
    expect(result.slots[0].points).toBe("1250.00");
    expect(result.slots[0].listeners[0].points).toBe("1250.00");
  });

  it("2vs2 は4つの枠に割れ、サイドごとに sideIndex が付く", async () => {
    const event = await newEvent();
    const a1 = await newParticipant(event.id, "a1");
    const a2 = await newParticipant(event.id, "a2");
    const b1 = await newParticipant(event.id, "b1");
    const b2 = await newParticipant(event.id, "b2");

    await seedGifts(a1.roomId, "alice", 100);
    await seedGifts(a2.roomId, "bob", 200);
    await seedGifts(b1.roomId, "carol", 300);

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      detectedStartAt: BATTLE_START,
      detectedEndAt: BATTLE_END,
      sides: [
        [a1.id, a2.id],
        [b1.id, b2.id],
      ],
    });

    const result = await loadMatchContributions(prisma, { eventId: event.id, matchId, now: NOW });
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;

    expect(result.slots).toHaveLength(4);
    expect(result.slots.map((s) => s.sideIndex)).toEqual([0, 0, 1, 1]);
    expect(result.slots.map((s) => s.diamonds)).toEqual(["100", "200", "300", "0"]);
  });

  it("自動確定(AGGREGATE)した対戦では、枠合計の和が EventMatchSide.diamonds と一致する", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await seedGifts(a.roomId, "alice", 500);
    await seedGifts(b.roomId, "carol", 300);

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      status: "DETECTED",
      detectedStartAt: BATTLE_START,
      detectedEndAt: BATTLE_END,
      sides: [[a.id], [b.id]],
    });

    // 勝敗確定を走らせて EventMatchSide.diamonds を埋める。
    await prisma.$transaction(async (tx) => {
      await resolveMatchResults(tx, {
        eventId: event.id,
        matchRules: parseMatchRules(null),
        multipliers: [],
        windows: WINDOWS,
        now: NOW,
      });
    });

    const sides = await prisma.eventMatchSide.findMany({
      where: { matchId },
      orderBy: { sideIndex: "asc" },
      select: { diamonds: true },
    });
    const match = await prisma.eventMatch.findUniqueOrThrow({
      where: { id: matchId },
      select: { winnerDecidedBy: true },
    });
    expect(match.winnerDecidedBy).toBe("AGGREGATE");
    expect(sides.map((s) => s.diamonds)).toEqual([500n, 300n]);

    const result = await loadMatchContributions(prisma, { eventId: event.id, matchId, now: NOW });
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;

    // 枠は1サイド1つずつなので、そのまま突き合わせられる。
    expect(result.slots.map((s) => s.diamonds)).toEqual(["500", "300"]);
  });

  it("主催者が確定(MANUAL)した対戦は side.diamonds が 0 のままでも内訳は出す", async () => {
    // resolveMatchResults は MANUAL_DECISIONS をスコア確定から外すが、区間自体は
    // loadBattleRangesByRoom に拾われて順位表の母集団には入る。
    // ここの数字は順位表と同じ母集団から出しているので、非ゼロになるのが正しい。
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");
    await seedGifts(a.roomId, "alice", 500);

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      status: "FINISHED",
      detectedStartAt: BATTLE_START,
      detectedEndAt: BATTLE_END,
      winnerDecidedBy: "MANUAL",
      sides: [[a.id], [b.id]],
    });

    await prisma.$transaction(async (tx) => {
      await resolveMatchResults(tx, {
        eventId: event.id,
        matchRules: parseMatchRules(null),
        multipliers: [],
        windows: WINDOWS,
        now: NOW,
      });
    });

    const sides = await prisma.eventMatchSide.findMany({
      where: { matchId },
      orderBy: { sideIndex: "asc" },
      select: { diamonds: true },
    });
    expect(sides.map((s) => s.diamonds)).toEqual([0n, 0n]);

    const result = await loadMatchContributions(prisma, { eventId: event.id, matchId, now: NOW });
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;
    expect(result.slots[0].diamonds).toBe("500");
  });

  it("合算グループを持つ対戦は候補区間unionで集計され、CUT_SHORT〜やり直し間の空白ギフトが含まれない", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    // 候補1: 13:10-13:12(途中終了)、候補2: 13:20-13:22(やり直し)。間(13:12-13:20)は
    // 空白のはずで、そこに置いたギフトは union に含まれてはいけない。
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 100,
      receivedAt: new Date("2026-09-01T13:11:00.000Z"),
    });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 999,
      receivedAt: new Date("2026-09-01T13:15:00.000Z"),
    });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 200,
      receivedAt: new Date("2026-09-01T13:21:00.000Z"),
    });

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      detectedStartAt: new Date("2026-09-01T13:10:00.000Z"),
      detectedEndAt: new Date("2026-09-01T13:22:00.000Z"),
      sides: [[a.id], [b.id]],
    });

    // createMatch() が自動作成した単一候補を、合算グループの2候補に置き換える。
    await prisma.eventMatchBattleCandidate.deleteMany({ where: { matchId } });
    const groupId = "grp-union";
    await prisma.eventMatchBattleCandidate.create({
      data: {
        matchId,
        battleId: `${PREFIX}_battle_${uniqueSuffix()}`,
        startedAt: new Date("2026-09-01T13:10:00.000Z"),
        endedAt: new Date("2026-09-01T13:12:00.000Z"),
        endedAtSource: "observed",
        confidence: "exact",
        selected: true,
        combinedGroupId: groupId,
      },
    });
    await prisma.eventMatchBattleCandidate.create({
      data: {
        matchId,
        battleId: `${PREFIX}_battle_${uniqueSuffix()}`,
        startedAt: new Date("2026-09-01T13:20:00.000Z"),
        endedAt: new Date("2026-09-01T13:22:00.000Z"),
        endedAtSource: "observed",
        confidence: "exact",
        selected: true,
        combinedGroupId: groupId,
      },
    });

    const result = await loadMatchContributions(prisma, { eventId: event.id, matchId, now: NOW });
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;
    // 100 + 200 = 300。間の999は空白として除外される。
    expect(result.slots[0].diamonds).toBe("300");
  });

  it("合算なしの通常BO3は従来どおり連続区間のまま(意図的な非変更の固定)", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    // ゲーム間(13:12-13:20)にギフトを入れる。合算グループが無い対戦では、
    // resolveMatchSpans() のミラー列連続区間の挙動どおり、この空白ギフトも含まれる。
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 100,
      receivedAt: new Date("2026-09-01T13:11:00.000Z"),
    });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 999,
      receivedAt: new Date("2026-09-01T13:15:00.000Z"),
    });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "alice",
      diamonds: 200,
      receivedAt: new Date("2026-09-01T13:21:00.000Z"),
    });

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      detectedStartAt: new Date("2026-09-01T13:10:00.000Z"),
      detectedEndAt: new Date("2026-09-01T13:22:00.000Z"),
      sides: [[a.id], [b.id]],
    });
    // createMatch() が作る既定の単一候補(combinedGroupId=null)をそのまま使う。

    const result = await loadMatchContributions(prisma, { eventId: event.id, matchId, now: NOW });
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;
    // 100 + 999 + 200 = 1299。連続区間なので間のギフトも含まれる(既存挙動)。
    expect(result.slots[0].diamonds).toBe("1299");
  });

  it("他のイベントの対戦IDでは引けない", async () => {
    const event = await newEvent();
    const other = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    const matchId = await createMatch({
      eventId: event.id,
      sessionId: event.sessionId,
      detectedStartAt: BATTLE_START,
      detectedEndAt: BATTLE_END,
      sides: [[a.id], [b.id]],
    });

    const result = await loadMatchContributions(prisma, {
      eventId: other.id,
      matchId,
      now: NOW,
    });
    expect(result).toBeNull();
  });
});
