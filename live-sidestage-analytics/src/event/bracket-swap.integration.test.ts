// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// **`vi.mock()` を足さないこと。** route handler を直接叩くためのモックは同じ vitest
// ワーカーに相乗りした別ファイルまで壊す(`battles.integration.test.ts` の冒頭を参照)。
// ここでは API ではなく `swapBracketSlots()` を直接呼ぶ。
//
// 葉範囲の算術そのものは DB を使わない `bracket-swap.test.ts` にある。ここで見るのは
// 「DB の行が期待どおり動くか」— 特に不戦勝の状態遷移と、行の削除。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { swapBracketSlots, type SwapSlot } from "./bracket-swap-apply";
import { acquireEventLock } from "./event-lock";
import { advanceBracket } from "./match-results";
import { createBracket } from "./tournament";

const PREFIX = "itest_swap";
const NOW = Date.now();
const START = new Date(NOW - 86_400_000);
const END = new Date(NOW + 86_400_000);

let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const createdEventIds: string[] = [];

afterAll(async () => {
  if (createdEventIds.length > 0) {
    // EventMatch → EventSession の FK は Restrict なので、対戦を先に消す。
    await prisma.eventMatch.deleteMany({ where: { eventId: { in: createdEventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  }
  await prisma.$disconnect();
});

/** 参加者 n 人のトーナメント(標準シード方式)。room は作らない — 検知を使わないため。 */
async function newTournament(count: number) {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} トーナメント`,
      ownerUserId: `${PREFIX}_owner`,
      format: "TOURNAMENT",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: START,
      endAt: END,
      sessions: { create: [{ startAt: START, endAt: END }] },
    },
    select: { id: true },
  });
  createdEventIds.push(event.id);

  const participants: string[] = [];
  for (let i = 0; i < count; i++) {
    const suffix = uniqueSuffix();
    const created = await prisma.eventParticipant.create({
      data: {
        eventId: event.id,
        tiktokId: `${PREFIX}_p${i}_${suffix}`,
        // EventParticipant.roomId は TiktokRoom への論理参照(FK ではない)。
        roomId: `${PREFIX}_room_${i}_${suffix}`,
        displayName: `P${i}`,
      },
      select: { id: true },
    });
    participants.push(created.id);
  }

  await createBracket({ eventId: event.id, entrantIds: participants });
  return { eventId: event.id, participants };
}

type LoadedMatch = Awaited<ReturnType<typeof loadMatches>>[number];

async function loadMatches(eventId: string) {
  return prisma.eventMatch.findMany({
    where: { eventId },
    orderBy: [{ round: "asc" }, { bracketPosition: "asc" }],
    include: {
      sides: {
        orderBy: { sideIndex: "asc" },
        include: { participants: { select: { participantId: true } } },
      },
    },
  });
}

function at(matches: LoadedMatch[], round: number, position: number): LoadedMatch {
  const match = matches.find((m) => m.round === round && m.bracketPosition === position);
  if (!match) throw new Error(`(${round}, ${position}) の対戦が無い`);
  return match;
}

function slotRef(match: LoadedMatch, sideIndex: number): SwapSlot {
  const side = match.sides.find((s) => s.sideIndex === sideIndex)!;
  return {
    matchId: match.id,
    sideIndex,
    expectedParticipantIds: side.participants.map((p) => p.participantId),
  };
}

function occupantsOf(match: LoadedMatch, sideIndex: number): string[] {
  return match.sides
    .find((s) => s.sideIndex === sideIndex)!
    .participants.map((p) => p.participantId);
}

/** 座標で指すスワップ。読み直してから呼ぶので、常に最新の matchId を送る。 */
async function swapAt(
  eventId: string,
  a: [round: number, position: number, sideIndex: number],
  b: [round: number, position: number, sideIndex: number]
) {
  const matches = await loadMatches(eventId);
  await swapBracketSlots(
    eventId,
    slotRef(at(matches, a[0], a[1]), a[2]),
    slotRef(at(matches, b[0], b[1]), b[2])
  );
}

/** そのラウンドの実試合を手動確定し、勝者を下流へ送る(不戦勝行はすでに確定済み)。 */
async function finishRound(eventId: string, round: number, winnerSideIndex = 0) {
  const matches = await loadMatches(eventId);
  for (const match of matches.filter((m) => m.round === round && m.status !== "FINISHED")) {
    const winner = match.sides.find((s) => s.sideIndex === winnerSideIndex)!;
    await prisma.eventMatch.update({
      where: { id: match.id },
      data: {
        status: "FINISHED",
        winnerSideId: winner.id,
        winnerDecidedBy: "MANUAL",
        decidedAt: new Date(),
      },
    });
  }
  await prisma.$transaction(async (tx) => {
    await acquireEventLock(tx, eventId);
    await advanceBracket(tx, eventId);
  });
}

/** 1件だけ手動確定して勝者を下流へ送る(他の枠は入れ替えられる状態のまま残す)。 */
async function finishMatch(
  eventId: string,
  round: number,
  position: number,
  winnerSideIndex = 0
) {
  const match = at(await loadMatches(eventId), round, position);
  const winner = match.sides.find((s) => s.sideIndex === winnerSideIndex)!;
  await prisma.eventMatch.update({
    where: { id: match.id },
    data: {
      status: "FINISHED",
      winnerSideId: winner.id,
      winnerDecidedBy: "MANUAL",
      decidedAt: new Date(),
    },
  });
  await prisma.$transaction(async (tx) => {
    await acquireEventLock(tx, eventId);
    await advanceBracket(tx, eventId);
  });
}

const isBye = (match: LoadedMatch) => (match.rules as { bye?: boolean } | null)?.bye === true;

describe("1回戦の入れ替え", () => {
  it("2つの枠の出場者が入れ替わる", async () => {
    const { eventId } = await newTournament(4);
    const before = await loadMatches(eventId);
    const moved = occupantsOf(at(before, 1, 0), 1);
    const target = occupantsOf(at(before, 1, 1), 0);

    await swapAt(eventId, [1, 0, 1], [1, 1, 0]);

    const after = await loadMatches(eventId);
    expect(occupantsOf(at(after, 1, 0), 1)).toEqual(target);
    expect(occupantsOf(at(after, 1, 1), 0)).toEqual(moved);
    // 触っていない枠はそのまま。
    expect(occupantsOf(at(after, 1, 0), 0)).toEqual(occupantsOf(at(before, 1, 0), 0));
  });

  it("最終集計が済んでいても再集計へ戻す", async () => {
    const { eventId } = await newTournament(4);
    await prisma.event.update({ where: { id: eventId }, data: { finalizedAt: new Date() } });

    await swapAt(eventId, [1, 0, 1], [1, 1, 0]);

    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { finalizedAt: true },
    });
    expect(event.finalizedAt).toBeNull();
  });
});

describe("準決勝の入れ替え(枝ごと交換)", () => {
  it("勝ち上がってきた1回戦のカードごと移動し、結果はそのまま残る", async () => {
    const { eventId } = await newTournament(8);
    await finishRound(eventId, 1);

    const before = await loadMatches(eventId);
    // 準決勝(round2)の position0 の下側 = 1回戦 position1 の勝者。
    const feederB = at(before, 1, 1);
    const feederC = at(before, 1, 2);
    const winnerOfB = occupantsOf(at(before, 2, 0), 1);
    const winnerOfC = occupantsOf(at(before, 2, 1), 0);
    expect(winnerOfB).toHaveLength(1);
    expect(winnerOfC).toHaveLength(1);

    await swapAt(eventId, [2, 0, 1], [2, 1, 0]);

    const after = await loadMatches(eventId);
    // 準決勝の顔ぶれが入れ替わっている。
    expect(occupantsOf(at(after, 2, 0), 1)).toEqual(winnerOfC);
    expect(occupantsOf(at(after, 2, 1), 0)).toEqual(winnerOfB);
    // 1回戦のカードは matchId ごと移動していて、結果(勝者)も保持されている。
    expect(at(after, 1, 2).id).toBe(feederB.id);
    expect(at(after, 1, 1).id).toBe(feederC.id);
    expect(at(after, 1, 2).winnerSideId).toBe(feederB.winnerSideId);
    expect(at(after, 1, 2).status).toBe("FINISHED");
  });
});

describe("空き枠への移動", () => {
  it("移動元が不戦勝になり、移動先の不戦勝が実際の対戦に戻る", async () => {
    // 3人: 1回戦 position0 が [e0, 空] の不戦勝、position1 が実試合。
    const { eventId } = await newTournament(3);
    const before = await loadMatches(eventId);
    expect(isBye(at(before, 1, 0))).toBe(true);
    expect(at(before, 1, 0).status).toBe("FINISHED");
    const stayer = occupantsOf(at(before, 1, 1), 1);
    const mover = occupantsOf(at(before, 1, 1), 0);

    // 実試合の上側を、不戦勝行の空き枠へ移す。
    await swapAt(eventId, [1, 1, 0], [1, 0, 1]);

    const after = await loadMatches(eventId);
    const filled = at(after, 1, 0);
    const emptied = at(after, 1, 1);

    // 不戦勝だった枠が実際の対戦になった。**status を戻さないと永久に検知されない。**
    expect(isBye(filled)).toBe(false);
    expect(filled.status).toBe("SCHEDULED");
    expect(filled.winnerSideId).toBeNull();
    expect(filled.winnerDecidedBy).toBeNull();
    expect(occupantsOf(filled, 1)).toEqual(mover);

    // 片方が抜けた枠が不戦勝になった。**1回戦は advanceBracket の転送先にならないので、
    // ここで確定させないと残った出場者が永久に次へ進めない。**
    expect(isBye(emptied)).toBe(true);
    expect(emptied.status).toBe("FINISHED");
    expect(emptied.winnerDecidedBy).toBe("BYE");
    expect(occupantsOf(emptied, 0)).toEqual([]);

    // その不戦勝の勝者が同じ操作の中で決勝へ送られている。
    expect(occupantsOf(at(after, 2, 0), 1)).toEqual(stayer);
  });

  it("不戦勝行の唯一の出場者を移すと、その行ごと消えて上流の不戦勝が付け替わる", async () => {
    // 5人(枠8): 1回戦 position0 / 2 / 3 が不戦勝、position1 が実試合。
    const { eventId } = await newTournament(5);
    const before = await loadMatches(eventId);
    expect(isBye(at(before, 1, 0))).toBe(true);
    expect(isBye(at(before, 1, 3))).toBe(true);
    const mover = occupantsOf(at(before, 1, 0), 0);
    expect(mover).toHaveLength(1);

    // 不戦勝で上がっていた組を、別の不戦勝行の空き枠へ移す。
    await swapAt(eventId, [1, 0, 0], [1, 3, 1]);

    const after = await loadMatches(eventId);
    // 誰も来なくなった1回戦の行は消える(失う対戦結果は無い)。
    expect(after.some((m) => m.round === 1 && m.bracketPosition === 0)).toBe(false);
    // 移動先は実際の対戦になった。
    const filled = at(after, 1, 3);
    expect(isBye(filled)).toBe(false);
    expect(occupantsOf(filled, 1)).toEqual(mover);
    // 子が片方だけになった2回戦は不戦勝行へ変わる。
    expect(isBye(at(after, 2, 0))).toBe(true);
    expect(isBye(at(after, 2, 1))).toBe(false);
  });
});

describe("既存データの壊れ方に耐える", () => {
  it("出場者を削除した確定済みカードがあっても、別の枠の入れ替えで構造が壊れない", async () => {
    // removeParticipant は EventParticipant を物理削除し、EventMatchSideParticipant は
    // Cascade で消える。葉の占有を「サイドの中身」から復元すると、この行が不戦勝行に
    // 化けてしまう(実試合の不戦勝化 = データ破損)。
    const { eventId } = await newTournament(8);
    // **入れ替える枠(position 2 / 3)は未確定のまま残す。** 確定させると
    // そちらが SLOT_LOCKED になり、この回帰が確かめたい経路へ届かない。
    await finishMatch(eventId, 1, 0);

    const before = await loadMatches(eventId);
    const finished = at(before, 1, 0);
    const loser = occupantsOf(finished, 1);
    expect(loser).toHaveLength(1);
    await prisma.eventParticipant.delete({ where: { id: loser[0] } });

    await swapAt(eventId, [1, 2, 0], [1, 3, 0]);

    const after = await loadMatches(eventId);
    const kept = at(after, 1, 0);
    expect(kept.id).toBe(finished.id);
    // 出場者が消えても不戦勝行にはならない。結果も残る。
    expect(isBye(kept)).toBe(false);
    expect(kept.status).toBe("FINISHED");
    expect(kept.winnerSideId).toBe(finished.winnerSideId);
  });
});

describe("入れ替えを断る条件", () => {
  it("同じカードの上下は入れ替えられない", async () => {
    const { eventId } = await newTournament(4);
    await expect(swapAt(eventId, [1, 0, 0], [1, 0, 1])).rejects.toMatchObject({
      code: "SAME_SLOT",
    });
  });

  it("ラウンドが違う枠どうしは入れ替えられない", async () => {
    const { eventId } = await newTournament(4);
    await finishRound(eventId, 1);
    await expect(swapAt(eventId, [1, 0, 0], [2, 0, 0])).rejects.toMatchObject({
      code: "ROUND_MISMATCH",
    });
  });

  it("進行中の対戦は入れ替えられない", async () => {
    const { eventId } = await newTournament(4);
    const matches = await loadMatches(eventId);
    await prisma.eventMatch.update({
      where: { id: at(matches, 1, 0).id },
      data: { status: "LIVE" },
    });
    await expect(swapAt(eventId, [1, 0, 1], [1, 1, 0])).rejects.toMatchObject({
      code: "SLOT_LOCKED",
    });
  });

  it("無効にした対戦は入れ替えられない(検知から永久に除外されるため)", async () => {
    const { eventId } = await newTournament(4);
    const matches = await loadMatches(eventId);
    await prisma.eventMatch.update({
      where: { id: at(matches, 1, 1).id },
      data: { status: "VOID" },
    });
    await expect(swapAt(eventId, [1, 0, 1], [1, 1, 0])).rejects.toMatchObject({
      code: "SLOT_LOCKED",
    });
  });

  it("次の対戦がすでに始まっていたら入れ替えられない", async () => {
    const { eventId } = await newTournament(4);
    const matches = await loadMatches(eventId);
    await prisma.eventMatch.update({
      where: { id: at(matches, 2, 0).id },
      data: { status: "DETECTED" },
    });
    await expect(swapAt(eventId, [1, 0, 1], [1, 1, 0])).rejects.toMatchObject({
      code: "DOWNSTREAM_STARTED",
    });
  });

  it("移動元が空の枠なら断る", async () => {
    const { eventId } = await newTournament(3);
    // 1回戦 position0 の side1 は不戦勝の空き枠。
    await expect(swapAt(eventId, [1, 0, 1], [1, 1, 0])).rejects.toMatchObject({
      code: "SOURCE_EMPTY",
    });
  });

  it("画面が見ていた出場者と食い違っていたら断る", async () => {
    const { eventId } = await newTournament(4);
    const matches = await loadMatches(eventId);
    const a = slotRef(at(matches, 1, 0), 1);
    const b = slotRef(at(matches, 1, 1), 0);
    await expect(
      swapBracketSlots(eventId, { ...a, expectedParticipantIds: ["itest_swap_stale"] }, b)
    ).rejects.toMatchObject({ code: "SLOT_CHANGED" });
  });
});
