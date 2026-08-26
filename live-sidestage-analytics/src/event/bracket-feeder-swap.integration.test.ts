// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// 組み合わせ変更「接続の交換(winner feeder edge swap)」— `swapWinnerFeeders()` /
// `resetWinnerFeeders()` のDBレベルの振る舞い。純粋関数(`WinnerFeederGraph` の構築、
// `parseWinnerFeeders`)のテストは `winner-feeders.test.ts` / `match-status.test.ts` にある。
//
// `vi.mock()` は足さない(`bracket-swap.integration.test.ts` と同じ理由)。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  applyBracketSwap,
  swapWinnerFeeders,
  resetWinnerFeeders,
  type FeederSwapSlot,
} from "./bracket-swap-apply";
import { acquireEventLock } from "./event-lock";
import { advanceBracket } from "./match-results";
import { createBracket } from "./tournament";

const PREFIX = "itest_feeder_swap";
const NOW = Date.now();
const START = new Date(NOW - 86_400_000);
const END = new Date(NOW + 86_400_000);

let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const createdEventIds: string[] = [];

afterAll(async () => {
  if (createdEventIds.length > 0) {
    await prisma.eventMatch.deleteMany({ where: { eventId: { in: createdEventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  }
  await prisma.$disconnect();
});

async function newTournament(count: number, options: { placementDepth?: number } = {}) {
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
        roomId: `${PREFIX}_room_${i}_${suffix}`,
        displayName: `P${i}`,
      },
      select: { id: true },
    });
    participants.push(created.id);
  }

  await createBracket({
    eventId: event.id,
    entrantIds: participants,
    placementDepth: options.placementDepth,
  });
  return { eventId: event.id, participants };
}

/** 段階的不戦勝方式(STAGED_BYE)のトーナメント。round2以降にも不戦勝行が生じうる。 */
async function newStagedTournament(count: number) {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 段階的不戦勝トーナメント`,
      ownerUserId: `${PREFIX}_owner`,
      format: "TOURNAMENT",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: START,
      endAt: END,
      rules: { bracket: { method: "STAGED_BYE" } },
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
        tiktokId: `${PREFIX}_sp${i}_${suffix}`,
        roomId: `${PREFIX}_sroom_${i}_${suffix}`,
        displayName: `SP${i}`,
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

function occupantsOf(match: LoadedMatch, sideIndex: number): string[] {
  return match.sides
    .find((s) => s.sideIndex === sideIndex)!
    .participants.map((p) => p.participantId);
}

type WinnerFeedersRules = {
  winnerFeeders?: {
    slots: [{ round: number; position: number }, { round: number; position: number }];
    changedAt: string;
  };
};
const winnerFeedersOf = (match: LoadedMatch) =>
  (match.rules as WinnerFeedersRules | null)?.winnerFeeders ?? null;

type PlacementRules = {
  placement?: { depth: number; rank: number };
  loserFrom?: ({ round: number; position: number } | null)[];
};
const placementOf = (match: LoadedMatch) => (match.rules as PlacementRules | null)?.placement ?? null;
const loserFromOf = (match: LoadedMatch) => (match.rules as PlacementRules | null)?.loserFrom ?? null;
const isBye = (match: LoadedMatch) => (match.rules as { bye?: boolean } | null)?.bye === true;

/** target(round,position)のsideIndexが「今」受け取っているsource座標。override優先、無ければ既定。 */
function currentSourceOf(
  match: LoadedMatch,
  sideIndex: number
): { round: number; position: number } {
  const wf = winnerFeedersOf(match);
  if (wf) return wf.slots[sideIndex];
  return { round: match.round - 1, position: match.bracketPosition * 2 + sideIndex };
}

function feederSlotRef(matches: LoadedMatch[], match: LoadedMatch, sideIndex: number): FeederSwapSlot {
  const source = currentSourceOf(match, sideIndex);
  const sourceMatch = at(matches, source.round, source.position);
  return {
    matchId: match.id,
    sideIndex,
    expectedFeeder: {
      round: source.round,
      position: source.position,
      matchId: sourceMatch.id,
      participantIds: sourceMatch.sides.flatMap((s) => s.participants.map((p) => p.participantId)),
    },
  };
}

/** 座標で指す接続交換。読み直してから呼ぶので、常に最新の matchId/フィンガープリントを送る。 */
async function swapFeedersAt(
  eventId: string,
  a: [round: number, position: number, sideIndex: number],
  b: [round: number, position: number, sideIndex: number]
) {
  const matches = await loadMatches(eventId);
  await swapWinnerFeeders(
    eventId,
    feederSlotRef(matches, at(matches, a[0], a[1]), a[2]),
    feederSlotRef(matches, at(matches, b[0], b[1]), b[2])
  );
}

/** そのラウンドの実試合を手動確定し、勝者を下流へ送る。 */
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

/** 1件だけ手動確定して勝者(敗者)を下流へ送る。 */
async function finishMatch(eventId: string, round: number, position: number, winnerSideIndex = 0) {
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

describe("接続の交換(基本動作)", () => {
  it("未実施の準決勝どうしで、接続(フィーダー)だけが入れ替わり中身は変わらない", async () => {
    const { eventId } = await newTournament(8);
    await finishRound(eventId, 1);

    const before = await loadMatches(eventId);
    // (2,0)のside1は(1,1)の勝者、(2,1)のside0は(1,2)の勝者。
    expect(winnerFeedersOf(at(before, 2, 0))).toBeNull();
    const winnerOf1 = occupantsOf(at(before, 1, 1), 0);
    const winnerOf2 = occupantsOf(at(before, 1, 2), 0);

    await swapFeedersAt(eventId, [2, 0, 1], [2, 1, 0]);

    const after = await loadMatches(eventId);
    // 1回戦の行(matchId・座標・結果)は一切変わっていない。
    expect(at(after, 1, 1).id).toBe(at(before, 1, 1).id);
    expect(at(after, 1, 1).status).toBe("FINISHED");
    expect(at(after, 1, 1).winnerSideId).toBe(at(before, 1, 1).winnerSideId);
    expect(occupantsOf(at(after, 1, 2), 0)).toEqual(winnerOf2);

    // 接続だけが交換されている。
    expect(winnerFeedersOf(at(after, 2, 0))?.slots).toEqual([
      { round: 1, position: 0 },
      { round: 1, position: 2 },
    ]);
    expect(winnerFeedersOf(at(after, 2, 1))?.slots).toEqual([
      { round: 1, position: 1 },
      { round: 1, position: 3 },
    ]);

    // advanceBracket が新しい接続に従って中身を転送している。
    expect(occupantsOf(at(after, 2, 0), 1)).toEqual(winnerOf2);
    expect(occupantsOf(at(after, 2, 1), 0)).toEqual(winnerOf1);
  });

  it("スワップ後に advanceBracket を2周回しても内容が変わらない(冪等)", async () => {
    const { eventId } = await newTournament(8);
    await finishRound(eventId, 1);
    await swapFeedersAt(eventId, [2, 0, 1], [2, 1, 0]);

    const beforeSecondPass = await loadMatches(eventId);
    await prisma.$transaction(async (tx) => {
      await acquireEventLock(tx, eventId);
      await advanceBracket(tx, eventId);
    });
    const afterSecondPass = await loadMatches(eventId);

    expect(afterSecondPass.map((m) => occupantsOf(m, 0))).toEqual(
      beforeSecondPass.map((m) => occupantsOf(m, 0))
    );
    expect(afterSecondPass.map((m) => occupantsOf(m, 1))).toEqual(
      beforeSecondPass.map((m) => occupantsOf(m, 1))
    );
  });

  it("完全スナップショット比較: matchId・座標・結果・placement全行・loserFromが一切変化しない", async () => {
    const { eventId } = await newTournament(8, { placementDepth: 1 });
    await finishRound(eventId, 1);

    const before = await loadMatches(eventId);
    const snapshotBefore = before.map((m) => ({
      id: m.id,
      round: m.round,
      position: m.bracketPosition,
      status: m.status,
      winnerSideId: m.winnerSideId,
      placement: placementOf(m),
      loserFrom: loserFromOf(m),
    }));

    await swapFeedersAt(eventId, [2, 0, 1], [2, 1, 0]);

    const after = await loadMatches(eventId);
    const snapshotAfter = after.map((m) => ({
      id: m.id,
      round: m.round,
      position: m.bracketPosition,
      status: m.status,
      winnerSideId: m.winnerSideId,
      placement: placementOf(m),
      loserFrom: loserFromOf(m),
    }));

    expect(snapshotAfter).toEqual(snapshotBefore);
  });

  it("最終集計が済んでいても再集計へ戻す", async () => {
    const { eventId } = await newTournament(8);
    await finishRound(eventId, 1);
    await prisma.event.update({ where: { id: eventId }, data: { finalizedAt: new Date() } });

    await swapFeedersAt(eventId, [2, 0, 1], [2, 1, 0]);

    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { finalizedAt: true },
    });
    expect(event.finalizedAt).toBeNull();
  });
});

describe("進行中の順位決定戦があっても、未実施の準決勝の接続は交換できる", () => {
  it("5位決定戦の一部がFINISHEDでも、まだ未実施の準決勝どうしの接続は交換できる", async () => {
    // 7人・5位決定戦(depth2)。1回戦は (a,BYE)(d,e)(b,g)(c,f)。position1(d,e)を
    // 確定させると、敗者(e)が5位決定戦の不戦勝の葉(2,4)へ自動的に送られ FINISHED になる。
    // これは「準決勝(round2)自体はまだ誰も対戦していない」が「下流の順位決定戦の一部は
    // すでに進行している」状態。5位決定戦の不戦勝葉の loserFrom は 1回戦の座標
    // (`{round:1,position:1}`)を指しており、準決勝(round2)自身のloserFromではないため、
    // 準決勝どうしの接続交換には影響しない。
    const { eventId } = await newTournament(7, { placementDepth: 2 });
    await finishMatch(eventId, 1, 1, 0);
    await finishMatch(eventId, 1, 2, 0);

    const before = await loadMatches(eventId);
    const fifthLeaf = before.find((m) => m.round === 2 && m.bracketPosition === 4)!;
    expect(fifthLeaf.status).toBe("FINISHED");
    expect(loserFromOf(fifthLeaf)).toEqual([{ round: 1, position: 1 }, null]);
    const winnerOfPos2 = occupantsOf(at(before, 1, 2), 0);

    // round2 position0(a不戦勝の勝者 vs d,eの勝者)と position1(b,gの勝者 vs c,fの勝者)の
    // 接続を交換する。どちらもまだ未実施(round2はまだ誰も対戦していない)。
    await swapFeedersAt(eventId, [2, 0, 1], [2, 1, 0]);

    const after = await loadMatches(eventId);
    // 5位決定戦の不戦勝葉は一切変わらない(座標ベースのloserFromは今回のスワップ対象外)。
    const fifthLeafAfter = after.find((m) => m.id === fifthLeaf.id)!;
    expect(fifthLeafAfter.status).toBe("FINISHED");
    expect(loserFromOf(fifthLeafAfter)).toEqual([{ round: 1, position: 1 }, null]);
    // 接続は交換されている。
    expect(occupantsOf(at(after, 2, 0), 1)).toEqual(winnerOfPos2);
  });

  it("準決勝自身が敗者を送る順位決定戦(3位決定戦)が進行中なら拒否する", async () => {
    // 8人・3位決定戦(depth1)。3位決定戦のフィーダーは両方の準決勝そのもの
    // (loserFromが{round:2,position:0}と{round:2,position:1}を指す)。準決勝自体は
    // まだ未実施でも、3位決定戦の行が(検知等で)先に進行してしまっている異常系を再現する。
    const { eventId } = await newTournament(8, { placementDepth: 1 });
    await finishRound(eventId, 1);

    const matches = await loadMatches(eventId);
    const third = matches.find((m) => placementOf(m)?.rank === 3)!;
    expect(loserFromOf(third)).toEqual([
      { round: 2, position: 0 },
      { round: 2, position: 1 },
    ]);
    await prisma.eventMatch.update({ where: { id: third.id }, data: { status: "DETECTED" } });

    await expect(swapFeedersAt(eventId, [2, 0, 1], [2, 1, 0])).rejects.toMatchObject({
      code: "DOWNSTREAM_STARTED",
    });
  });
});

describe("接続の交換を断る条件", () => {
  it("同じ枠は交換できない", async () => {
    const { eventId } = await newTournament(8);
    await finishRound(eventId, 1);
    await expect(swapFeedersAt(eventId, [2, 0, 0], [2, 0, 0])).rejects.toMatchObject({
      code: "SAME_SLOT",
    });
  });

  it("ラウンドが違う枠どうしは交換できない", async () => {
    const { eventId } = await newTournament(8);
    await finishRound(eventId, 1);
    await expect(swapFeedersAt(eventId, [2, 0, 0], [3, 0, 0])).rejects.toMatchObject({
      code: "ROUND_MISMATCH",
    });
  });

  it("1回戦の枠は接続を交換できない", async () => {
    const { eventId } = await newTournament(8);
    const matches = await loadMatches(eventId);
    // 1回戦は既定sourceを持たないので、テストヘルパー(feederSlotRef)で解決できない。
    // 実装側のROUND_MISMATCHガードはexpectedFeederの解決より前に効くので、ダミー値で足りる。
    const dummyFeeder = { round: 0, position: 0, matchId: "dummy", participantIds: [] as string[] };
    await expect(
      swapWinnerFeeders(
        eventId,
        { matchId: at(matches, 1, 0).id, sideIndex: 0, expectedFeeder: dummyFeeder },
        { matchId: at(matches, 1, 1).id, sideIndex: 0, expectedFeeder: dummyFeeder }
      )
    ).rejects.toMatchObject({ code: "ROUND_MISMATCH" });
  });

  it("すでに始まっている対戦は接続を交換できない", async () => {
    const { eventId } = await newTournament(8);
    await finishRound(eventId, 1);
    const matches = await loadMatches(eventId);
    await prisma.eventMatch.update({
      where: { id: at(matches, 2, 0).id },
      data: { status: "LIVE" },
    });
    await expect(swapFeedersAt(eventId, [2, 0, 0], [2, 1, 0])).rejects.toMatchObject({
      code: "SLOT_LOCKED",
    });
  });

  it("不戦勝の枠(target)は接続を交換できない", async () => {
    // 標準シード方式は不戦勝を1回戦だけで消化する設計なので、round2以降に不戦勝行を
    // 作るには段階的不戦勝方式(STAGED_BYE)が要る(`bracket.ts` の `buildStagedBracket` 参照)。
    const { eventId } = await newStagedTournament(6);
    const matches = await loadMatches(eventId);
    const bye = matches.find((m) => m.round === 2 && isBye(m));
    expect(bye).toBeTruthy();
    const other = matches.find(
      (m) => m.round === 2 && m.bracketPosition !== bye!.bracketPosition
    )!;
    await expect(
      swapFeedersAt(
        eventId,
        [bye!.round, bye!.bracketPosition, 0],
        [other.round, other.bracketPosition, 0]
      )
    ).rejects.toMatchObject({ code: "BYE_ROW" });
  });

  it("楽観的排他: 表示していた接続と現在の接続が食い違っていたら断る", async () => {
    const { eventId } = await newTournament(8);
    await finishRound(eventId, 1);
    const matches = await loadMatches(eventId);
    const a = feederSlotRef(matches, at(matches, 2, 0), 1);
    const b = feederSlotRef(matches, at(matches, 2, 1), 0);
    await expect(
      swapWinnerFeeders(eventId, { ...a, expectedFeeder: { ...a.expectedFeeder, participantIds: ["stale"] } }, b)
    ).rejects.toMatchObject({ code: "FEEDER_CHANGED" });
  });

  it("楽観的排他: 1回戦の葉スワップ(中身だけ変わる)との競合を座標だけでなく指紋で検知する", async () => {
    const { eventId } = await newTournament(8);
    await finishRound(eventId, 1);

    // 表示を開いた時点のフィンガープリントを保持しておく。
    const opened = await loadMatches(eventId);
    const a = feederSlotRef(opened, at(opened, 2, 0), 1);
    const b = feederSlotRef(opened, at(opened, 2, 1), 0);

    // 別タブが round=1 の葉を入れ替える(まだ確定していない1回戦位置3のみ動かす)。
    // ここでは round=1 の確定済みカードには触れず、座標そのものを変えずに中身を
    // 変える実際のケースを、DBの直接更新で模擬する(swapBracketSlots は未確定行しか
    // 動かせないため、確定済みの結果は直接上書きして「中身が変わった」状態を作る)。
    const feederRow = at(opened, a.expectedFeeder.round, a.expectedFeeder.position);
    const newParticipant = await prisma.eventParticipant.create({
      data: {
        eventId,
        tiktokId: `${PREFIX}_intruder_${uniqueSuffix()}`,
        roomId: `${PREFIX}_room_intruder_${uniqueSuffix()}`,
        displayName: "Intruder",
      },
      select: { id: true },
    });
    const winningSide = feederRow.sides.find((s) => s.id === feederRow.winnerSideId)!;
    await prisma.eventMatchSideParticipant.deleteMany({ where: { sideId: winningSide.id } });
    await prisma.eventMatchSideParticipant.create({
      data: { sideId: winningSide.id, participantId: newParticipant.id },
    });

    await expect(swapWinnerFeeders(eventId, a, b)).rejects.toMatchObject({
      code: "FEEDER_CHANGED",
    });
  });
});

describe("接続のリセット", () => {
  it("リセットすると winnerFeeders が消え、既定の nextSlot() 計算に戻る", async () => {
    const { eventId } = await newTournament(8);
    await finishRound(eventId, 1);
    await swapFeedersAt(eventId, [2, 0, 1], [2, 1, 0]);

    const swapped = await loadMatches(eventId);
    expect(winnerFeedersOf(at(swapped, 2, 0))).not.toBeNull();

    await resetWinnerFeeders(eventId);

    const after = await loadMatches(eventId);
    expect(winnerFeedersOf(at(after, 2, 0))).toBeNull();
    expect(winnerFeedersOf(at(after, 2, 1))).toBeNull();
    // advanceBracket が既定座標へ従って中身を戻している。
    expect(occupantsOf(at(after, 2, 0), 1)).toEqual(occupantsOf(at(swapped, 1, 1), 0));
  });

  it("接続がある間は葉スワップがFEEDER_OVERRIDDENで拒否され、リセット後は再び使える", async () => {
    const { eventId } = await newTournament(8);
    // 1回戦は確定させない(未確定のまま)。round2への接続交換自体は target(round2)が
    // 非bye行かつ未実施であれば成立し、source(1回戦)の状態は問わない。
    await swapFeedersAt(eventId, [2, 0, 1], [2, 1, 0]);

    // 接続(winnerFeeders)が1件でも存在する間、無関係な枠(未確定の1回戦どうし)の
    // 葉スワップも巻き込みで拒否される(判定はイベント全体、fail closed)。
    const matches1 = await loadMatches(eventId);
    const a1 = {
      matchId: at(matches1, 1, 0).id,
      sideIndex: 0,
      expectedParticipantIds: occupantsOf(at(matches1, 1, 0), 0),
    };
    const b1 = {
      matchId: at(matches1, 1, 1).id,
      sideIndex: 1,
      expectedParticipantIds: occupantsOf(at(matches1, 1, 1), 1),
    };
    await expect(applyBracketSwap(prisma, eventId, a1, b1)).rejects.toMatchObject({
      code: "FEEDER_OVERRIDDEN",
    });

    await resetWinnerFeeders(eventId);

    // リセット後は通常の葉スワップが通る。
    const matches2 = await loadMatches(eventId);
    const a2 = {
      matchId: at(matches2, 1, 0).id,
      sideIndex: 0,
      expectedParticipantIds: occupantsOf(at(matches2, 1, 0), 0),
    };
    const b2 = {
      matchId: at(matches2, 1, 1).id,
      sideIndex: 1,
      expectedParticipantIds: occupantsOf(at(matches2, 1, 1), 1),
    };
    await expect(applyBracketSwap(prisma, eventId, a2, b2)).resolves.toBeUndefined();
  });
});
