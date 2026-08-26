import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "./analytics-db";
import { buildManualBracket, buildPlacementBlocksFor, placementRoundLabel, type PlacementMatch } from "./bracket";
import {
  bracketShape,
  planRowMoves,
  restoreOccupancy,
  shapeKey,
  slotLeafRange,
  swapLeafRanges,
  type BracketShape,
} from "./bracket-swap";
import { acquireEventLock } from "./event-lock";
import { anyDownstreamStarted, downstreamStarted } from "./match-downstream";
import { advanceBracket } from "./match-results";
import { isByeRow, isPlainObject, isStartedMatch, parseLoserFrom, parsePlacement } from "./match-status";
import { MUTATION_TX_OPTIONS, reopenAggregation } from "./reopen-aggregation";

// トーナメント表の組み合わせ変更(スワップ)。表を破棄せずに、勝ち残っている出場者を
// 別の枠へ移す。
//
// **中身だけを差し替えるのではなく、葉(1回戦の枠)の占有パターンを交換して構造ごと動かす。**
// 進行(`advanceBracket`)は `nextSlot()` の固定座標で毎回下流を再構築するので、
// 準決勝のサイドを直接書き換えても次の集計周回で巻き戻される。詳しくは
// `bracket-swap.ts` の冒頭と `src/event/CLAUDE.md`。

export type SwapSlot = {
  matchId: string;
  sideIndex: number;
  /**
   * クライアントが見ていたそのスロットの出場者。楽観的排他に使う。
   *
   * 表示と実体がずれたまま入れ替えると、主催者が意図しない相手を動かす。空きスロットは
   * 空配列を送る。
   */
  expectedParticipantIds: string[];
};

export type SwapErrorCode =
  | "NOT_TOURNAMENT"
  | "SLOT_NOT_FOUND"
  | "SAME_SLOT"
  | "ROUND_MISMATCH"
  | "SOURCE_EMPTY"
  | "SLOT_LOCKED"
  | "DOWNSTREAM_STARTED"
  | "SLOT_CHANGED"
  | "BRACKET_INCONSISTENT";

export class BracketSwapError extends Error {
  constructor(
    message: string,
    readonly code: SwapErrorCode,
    readonly status: number
  ) {
    super(message);
    this.name = "BracketSwapError";
  }
}

type SideRow = {
  id: string;
  sideIndex: number;
  teamId: string | null;
  participants: { participantId: string }[];
};

type MatchRow = {
  id: string;
  round: number;
  bracketPosition: number;
  status: string;
  winnerSideId: string | null;
  winnerDecidedBy: string | null;
  rules: Prisma.JsonValue;
  sessionId: string;
  sides: SideRow[];
};

/**
 * 2つのスロットの中身を入れ替える。**`a` が主催者の掴んだ側**(必ず出場者がいる)で、
 * `b` は空きスロットでもよい(片道移動になる)。
 */
export async function swapBracketSlots(
  eventId: string,
  a: SwapSlot,
  b: SwapSlot
): Promise<void> {
  await prisma.$transaction(
    async (tx) => applyBracketSwap(tx, eventId, a, b),
    MUTATION_TX_OPTIONS
  );
}

/**
 * スワップの本体。**呼び出し側のトランザクションから使う**(テストはこちらを直接叩く)。
 *
 * ロックはこの関数が先頭で取る。破棄側(`tournament.ts`)・`[matchId]` API と同じ順序
 * (ロック → 読み取り → 書き込み)で、崩すとデッドロックする。
 */
export async function applyBracketSwap(
  tx: DbClient,
  eventId: string,
  a: SwapSlot,
  b: SwapSlot
): Promise<void> {
  await acquireEventLock(tx, eventId);

  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { format: true },
  });
  if (!event) throw new BracketSwapError("イベントが見つかりません。", "SLOT_NOT_FOUND", 404);
  if (event.format !== "TOURNAMENT") {
    throw new BracketSwapError(
      "組み合わせを変更できるのはバトルトーナメントだけです。",
      "NOT_TOURNAMENT",
      400
    );
  }

  const matches: MatchRow[] = await tx.eventMatch.findMany({
    where: { eventId },
    orderBy: [{ round: "asc" }, { bracketPosition: "asc" }],
    select: {
      id: true,
      round: true,
      bracketPosition: true,
      status: true,
      winnerSideId: true,
      winnerDecidedBy: true,
      rules: true,
      sessionId: true,
      sides: {
        orderBy: { sideIndex: "asc" },
        select: {
          id: true,
          sideIndex: true,
          teamId: true,
          participants: { select: { participantId: true } },
        },
      },
    },
  });

  // 本選の行と順位決定戦の行は座標空間を共有しているが、葉の占有パターン交換の
  // 対象は本選だけ。順位決定戦のブロックは after 側で改めて再計算する(下記)。
  const mainRows = matches.filter((m) => !parsePlacement(m.rules));
  const placementRows = matches.filter((m) => parsePlacement(m.rules));

  const slotA = resolveSlot(mainRows, a);
  const slotB = resolveSlot(mainRows, b);

  if (slotA.match.id === slotB.match.id) {
    // 同じカードの上下を入れ替えても対戦相手は変わらない(表示順が変わるだけ)。
    throw new BracketSwapError(
      "同じ対戦カードの中では入れ替えられません。",
      "SAME_SLOT",
      400
    );
  }
  if (slotA.match.round !== slotB.match.round) {
    throw new BracketSwapError(
      "入れ替えられるのは同じラウンドの枠どうしだけです。",
      "ROUND_MISMATCH",
      400
    );
  }

  assertSwappable(slotA.match);
  assertSwappable(slotB.match);

  // 掴んだ側に出場者がいないと「何も動かない」操作になる。空きスロットへの片道移動は
  // 掴む側にだけ出場者を求める(要件: 勝ち残っている人を動かす)。
  if (slotA.side.participants.length === 0 && slotA.side.teamId === null) {
    throw new BracketSwapError(
      "移動元の枠に出場者がいません。",
      "SOURCE_EMPTY",
      400
    );
  }

  assertUnchanged(slotA.side, a);
  assertUnchanged(slotB.side, b);

  for (const slot of [slotA, slotB]) {
    if (await downstreamStarted(tx, eventId, slot.match.round, slot.match.bracketPosition)) {
      throw new BracketSwapError(
        "次の対戦がすでに始まっているため、この枠は入れ替えられません。",
        "DOWNSTREAM_STARTED",
        409
      );
    }
  }

  // ------------------------------------------------------------------
  // 葉の占有を復元し、交換後の構造を出す(本選の行だけを対象にする)
  // ------------------------------------------------------------------
  const roundCount = Math.max(...mainRows.map((m) => m.round));
  const size = 2 ** roundCount;
  const occupancy = restoreOccupancy(
    mainRows.filter((m) => m.round === 1),
    size
  );

  const beforeShape = bracketShape(occupancy);
  const originalKeys = new Map(mainRows.map((m) => [m.id, shapeKey(m.round, m.bracketPosition)]));
  assertShapeMatches(beforeShape, [...originalKeys.values()]);

  const rangeA = slotLeafRange(slotA.match.round, slotA.match.bracketPosition, a.sideIndex);
  const rangeB = slotLeafRange(slotB.match.round, slotB.match.bracketPosition, b.sideIndex);
  const afterOccupancy = swapLeafRanges(occupancy, rangeA, rangeB);
  const afterShape = bracketShape(afterOccupancy);

  // ------------------------------------------------------------------
  // 行の移動。**中身(結果・検知)はそのままで座標だけ動かす**ので、確定済みの
  // 1回戦カードも matchId ごと新しい枝へ移る。
  // ------------------------------------------------------------------
  const moves = planRowMoves({ rows: mainRows, rangeA, rangeB });

  // **移動する行それぞれの下流も、すでに始まっていないか確認する。** slotA/slotB 自身は
  // 上でチェック済みだが、`planRowMoves` は「勝ち上がってきた1回戦」等の付随する行も
  // 一緒に動かすので、それらが養う順位決定戦の枠(loserFrom の逆引き)まで含めて確認する
  // 必要がある。ここで弾かないと、進行中の順位決定戦の出場者を黙って差し替えてしまう。
  // **`anyDownstreamStarted` で1回にまとめる** — 移動する行1件ごとに呼ぶと、大きな
  // サブツリーの入れ替えで対戦全件のスキャンを何度も繰り返すことになる。
  if (
    moves.length > 0 &&
    (await anyDownstreamStarted(
      tx,
      eventId,
      moves.map((move) => ({ round: move.round, position: move.from }))
    ))
  ) {
    throw new BracketSwapError(
      "移動する対戦の下流(順位決定戦を含む)がすでに始まっているため、この入れ替えはできません。",
      "DOWNSTREAM_STARTED",
      409
    );
  }

  for (const move of moves) {
    await tx.eventMatch.update({
      where: { id: move.id },
      data: { bracketPosition: move.to },
    });
  }
  // **一意制約が無く、同一トランザクション内で中間状態を読む主体もいない**ので、
  // 一時退避は要らない(`advanceBracket` はこの後で自分から読み直す)。
  const movedTo = new Map(moves.map((move) => [move.id, move.to]));
  for (const match of mainRows) {
    const to = movedTo.get(match.id);
    if (to !== undefined) match.bracketPosition = to;
  }

  // ------------------------------------------------------------------
  // 行の増減。**増える方向は起こらない**(掴む側も置く側も画面にある行なので、
  // 新しく alive になる祖先はすでに行を持っている)。起きたら復元が実態とずれている
  // 証拠なので、正規化で傷を広げずに中断する。
  // ------------------------------------------------------------------
  const survivors: MatchRow[] = [];
  const removed: MatchRow[] = [];
  for (const match of mainRows) {
    (afterShape.has(shapeKey(match.round, match.bracketPosition)) ? survivors : removed).push(match);
  }
  assertShapeMatches(afterShape, survivors.map((m) => shapeKey(m.round, m.bracketPosition)));

  if (removed.length > 0) {
    // 消えるのは「もう誰も来ない」行だけ(不戦勝行か空行)。実際の対戦は起こり得ないので
    // 失う結果がない。`EventMatchSide` は onDelete: Cascade で一緒に消える。
    await tx.eventMatch.deleteMany({ where: { id: { in: removed.map((m) => m.id) } } });
  }

  // ------------------------------------------------------------------
  // 1回戦のサイドの中身。r >= 2 は行ごと動かしているので触る必要がない
  // (下流のサイドは advanceBracket が feeder の勝者から作り直す)。
  // ------------------------------------------------------------------
  if (slotA.match.round === 1) {
    await swapSideContents(tx, slotA.side, slotB.side);
  }

  await normalizeByeRows(tx, { survivors, originalKeys, beforeShape, afterShape });

  // ------------------------------------------------------------------
  // 順位決定戦のトポロジー再計算。**本選の構造が変わると、どの本選行が敗者を
  // 出すか(loserFrom)が変わりうる。** 座標(round, position)自体は feeders の数が
  // 変わらない限り不変だが、それも保証はしない — 実際に組み直して差分を取る。
  // ------------------------------------------------------------------
  await reconcilePlacementBlocks(tx, {
    eventId,
    placementRows,
    mainRows,
    beforeOccupancy: occupancy,
    afterOccupancy,
  });

  // 勝者を下流へ送り直す。不戦勝行の確定・解除もここが引き継ぐ。
  await advanceBracket(tx, eventId);
  // 組み合わせが変われば順位もライフも変わる。最終集計が済んでいても計算し直させる。
  await reopenAggregation(tx, eventId);
}

function resolveSlot(
  matches: MatchRow[],
  slot: SwapSlot
): { match: MatchRow; side: SideRow } {
  const match = matches.find((m) => m.id === slot.matchId);
  const side = match?.sides.find((s) => s.sideIndex === slot.sideIndex);
  if (!match || !side) {
    throw new BracketSwapError("対戦の枠が見つかりません。", "SLOT_NOT_FOUND", 404);
  }
  return { match, side };
}

/**
 * 入れ替えてよいカードか。
 *
 * `VOID` を外すのは、`battles.ts` の `LOCKED_STATUSES` が VOID を**検知から永久に除外する**
 * ため。新しい出場者を入れても照合されず、旧ペアへの「無効」宣言が新しい組み合わせに
 * 引き継がれてしまう。動かしたい場合は先に「検知をやり直す」で SCHEDULED へ戻す
 * (`assignSession` が `RESCHEDULABLE` を絞っているのと同じ考え方)。
 */
function assertSwappable(match: MatchRow): void {
  const isBye = isByeRow(match.rules);
  if (isStartedMatch({ status: match.status, winnerDecidedBy: match.winnerDecidedBy, isBye })) {
    throw new BracketSwapError(
      "すでに始まっている対戦の組み合わせは変更できません。",
      "SLOT_LOCKED",
      409
    );
  }
  if (match.status === "VOID") {
    throw new BracketSwapError(
      "無効にした対戦は入れ替えられません。先に検知をやり直してください。",
      "SLOT_LOCKED",
      409
    );
  }
}

/** 画面が見ていた出場者と、ロック内で読み直した出場者が同じか。 */
function assertUnchanged(side: SideRow, slot: SwapSlot): void {
  const current = new Set(side.participants.map((p) => p.participantId));
  const expected = new Set(slot.expectedParticipantIds);
  const same = current.size === expected.size && [...current].every((id) => expected.has(id));
  if (!same) {
    throw new BracketSwapError(
      "この画面を開いた後に対戦表が変わりました。最新の状態を確認してください。",
      "SLOT_CHANGED",
      409
    );
  }
}

/** 復元した構造と実際の行の座標が一致するか。ずれていたら書き換えずに中断する。 */
function assertShapeMatches(shape: BracketShape, keys: string[]): void {
  const actual = new Set(keys);
  const same = actual.size === shape.size && [...shape.keys()].every((key) => actual.has(key));
  if (!same) {
    throw new BracketSwapError(
      "トーナメント表の構造が壊れているため入れ替えられません。表を破棄して作り直してください。",
      "BRACKET_INCONSISTENT",
      409
    );
  }
}

/** 1回戦の2つのサイドの中身(チームと出場者)を入れ替える。 */
async function swapSideContents(tx: DbClient, sideA: SideRow, sideB: SideRow): Promise<void> {
  const participantsA = sideA.participants.map((p) => p.participantId);
  const participantsB = sideB.participants.map((p) => p.participantId);

  await tx.eventMatchSideParticipant.deleteMany({
    where: { sideId: { in: [sideA.id, sideB.id] } },
  });
  const rows = [
    ...participantsB.map((participantId) => ({ sideId: sideA.id, participantId })),
    ...participantsA.map((participantId) => ({ sideId: sideB.id, participantId })),
  ];
  if (rows.length > 0) {
    await tx.eventMatchSideParticipant.createMany({ data: rows });
  }

  if (sideA.teamId !== sideB.teamId) {
    await tx.eventMatchSide.update({ where: { id: sideA.id }, data: { teamId: sideB.teamId } });
    await tx.eventMatchSide.update({ where: { id: sideB.id }, data: { teamId: sideA.teamId } });
  }

  // スナップショットも揃える(この後の不戦勝の正規化が出場者の有無を見る)。
  sideA.participants = participantsB.map((participantId) => ({ participantId }));
  sideB.participants = participantsA.map((participantId) => ({ participantId }));
  const teamA = sideA.teamId;
  sideA.teamId = sideB.teamId;
  sideB.teamId = teamA;
}

/**
 * 不戦勝の状態が変わった行を正規化する。
 *
 * **`advanceBracket()` には任せられない。** あちらの不戦勝処理は「転送先(target)」に
 * しか効かないので、
 *
 * - **1回戦の行は決して target にならない**(target は必ず round >= 2)。1回戦の静的な
 *   不戦勝は `createBracket()` が作成時に確定させている。放置すると新しく不戦勝に
 *   なった1回戦が `SCHEDULED` のまま固まり、生存者は永久に次のラウンドへ進めない
 *   (しかも `[matchId]` API は不戦勝行への確定を `BYE_ROW` で拒否するので手動でも直せない)
 * - **不戦勝でなくなった行は巻き戻されない**。`FINISHED` / `winnerDecidedBy: "BYE"` が
 *   残ると、対戦していない旧勝者が下流へ流れ続け、しかも `detectMatches()` の `open`
 *   フィルタが `MANUAL_DECISIONS`("BYE" を含む)を外すので永久に検知されない
 *
 * 触るのは**状態が変わった行だけ**。旧データが `rules.bye` を持たないことによる差分は
 * ここでは直さない(スワップと無関係な行を書き換えない)。
 */
async function normalizeByeRows(
  tx: DbClient,
  input: {
    survivors: MatchRow[];
    originalKeys: Map<string, string>;
    beforeShape: BracketShape;
    afterShape: BracketShape;
  }
): Promise<void> {
  const { survivors, originalKeys, beforeShape, afterShape } = input;

  for (const match of survivors) {
    const before = beforeShape.get(originalKeys.get(match.id)!);
    const after = afterShape.get(shapeKey(match.round, match.bracketPosition));
    if (!before || !after || before.isBye === after.isBye) continue;

    const rules = isPlainObject(match.rules) ? { ...match.rules } : {};

    if (after.isBye) {
      const alive = match.sides.find((s) => s.sideIndex === after.aliveSideIndex);
      const hasEntrant = !!alive && (alive.participants.length > 0 || alive.teamId !== null);
      await tx.eventMatch.update({
        where: { id: match.id },
        data: {
          rules: { ...rules, bye: true } as Prisma.InputJsonObject,
          status: hasEntrant ? "FINISHED" : "SCHEDULED",
          winnerSideId: hasEntrant ? alive!.id : null,
          winnerDecidedBy: hasEntrant ? "BYE" : null,
          decidedAt: null,
          detectedBattleId: null,
          detectedStartAt: null,
          detectedEndAt: null,
          detectionConfidence: null,
          detectedEndSource: null,
        },
      });
      continue;
    }

    // 不戦勝でなくなった。実際に戦う枠へ戻すので、検知のやり直しと同じ状態にする
    // (`[matchId]` API の `reopen` と揃えてある)。
    delete rules.bye;
    await tx.eventMatch.update({
      where: { id: match.id },
      data: {
        rules: rules as Prisma.InputJsonObject,
        status: "SCHEDULED",
        winnerSideId: null,
        winnerDecidedBy: null,
        decidedAt: null,
        detectedBattleId: null,
        detectedStartAt: null,
        detectedEndAt: null,
        detectionConfidence: null,
        detectedEndSource: null,
      },
    });
    await tx.eventMatchSide.updateMany({
      where: { matchId: match.id },
      data: { diamonds: 0, score: 0 },
    });
  }
}

/** `PlacementMatch.loserFrom` が指す2つの座標配列が同じか。 */
function sameLoserFrom(
  a: ({ round: number; position: number } | null)[] | null,
  b: ({ round: number; position: number } | null)[] | null
): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((slot, i) => {
    const other = b[i];
    if (slot === null || other === null) return slot === other;
    return slot.round === other.round && slot.position === other.position;
  });
}

/**
 * swap で本選の構造(occupancy)が変わったとき、順位決定戦ブロックのトポロジーを
 * 再計算して既存の行へ反映する。
 *
 * **座標(round, position)自体は、そのラウンドの実試合数(feeders)が変わらない限り
 * 不変**（`buildPlacementBlocksFor` はブロックの内部構造を feeders の数だけから組む）。
 * 変わりうるのは `loserFrom`（どの本選座標の敗者を待つか）と、`isBye`、稀に
 * feeders の数が変わったときのブロックの形そのもの。
 *
 * **影響を受ける既存行のどれかがすでに進行していたら、swap 全体を拒否する**
 * （呼び出し元のトランザクションがロールバックされるので、ここより前で行った
 * 本選側の書き込みも一緒に巻き戻る）。まだ何も起きていない行なら、新しい形に
 * 置き換えても失う結果がない。
 *
 * **既知の制約: 深さは「今の順位決定戦の行」からしか逆算しない。** 表を作った後に
 * `Event.rules.bracket.placementDepth`（希望値）を読み直すことはしない —
 * `tournament.ts` の `createBracket()` と同じく、正本は「今の表の状態」であって
 * イベントの希望値は表がまだ無いときの既定値でしかないため。したがって、
 * 進行していない順位決定戦ブロックが swap で丸ごと組めなくなって消えた場合、
 * 以後の swap では自動的には復活しない（`placementRows.length === 0` なら即 return する）。
 * 復活させたい主催者は表を破棄して作り直すこと。
 */
async function reconcilePlacementBlocks(
  tx: DbClient,
  input: {
    eventId: string;
    placementRows: MatchRow[];
    mainRows: MatchRow[];
    beforeOccupancy: boolean[];
    afterOccupancy: boolean[];
  }
): Promise<void> {
  const { eventId, placementRows, mainRows, beforeOccupancy, afterOccupancy } = input;
  if (placementRows.length === 0) return;

  const depth = placementRows.reduce(
    (max, m) => Math.max(max, parsePlacement(m.rules)?.depth ?? 0),
    0
  );
  if (depth === 0) return;

  const beforeBlocks = buildPlacementBlocksFor(buildManualBracket(beforeOccupancy), depth);
  const afterBlocks = buildPlacementBlocksFor(buildManualBracket(afterOccupancy), depth);

  type PositionedMatch = { depth: number; rank: number; blockRoundCount: number; match: PlacementMatch };
  const indexByKey = (blocks: typeof beforeBlocks): Map<string, PositionedMatch> => {
    const byKey = new Map<string, PositionedMatch>();
    for (const block of blocks) {
      for (const m of block.matches) {
        byKey.set(shapeKey(m.round, m.position), {
          depth: block.depth,
          rank: block.rank,
          blockRoundCount: block.blockRoundCount,
          match: m,
        });
      }
    }
    return byKey;
  };
  const beforeByKey = indexByKey(beforeBlocks);
  const afterByKey = indexByKey(afterBlocks);
  const existingByKey = new Map(placementRows.map((m) => [shapeKey(m.round, m.bracketPosition), m]));

  // **座標(round, position)が同じでも、rank(順位)が変わることがある。** 深さdのブロックの
  // rank は「それより浅い深さのブロックの実試合数の合計 + 2」で決まるので、浅い側の
  // ブロックの feeders 数が変わると、深い側のブロックの rank だけがシフトしうる
  // (座標自体は feeders 数が変わったブロック自身でない限り不変)。
  const structureChanged = (key: string): boolean => {
    const before = beforeByKey.get(key) ?? null;
    const after = afterByKey.get(key) ?? null;
    if (!before || !after) return true;
    return (
      !sameLoserFrom(before.match.loserFrom, after.match.loserFrom) ||
      before.match.isBye !== after.match.isBye ||
      before.rank !== after.rank
    );
  };

  // 影響を受ける行(座標が消える・loserFrom や isBye や rank が変わる)のうち、すでに
  // 進行しているものが1つでもあれば、この swap は通さない(all-or-nothing)。
  //
  // **対象は `existingByKey` の全キー。** `beforeByKey ∪ afterByKey` だけを見ると、
  // 「現在の本選構造から理論的に導出される形」に存在しない座標にある既存行
  // (壊れたデータ)を見落とし、進行中かどうかを確かめずに削除してしまう。
  for (const [key, existing] of existingByKey) {
    if (!structureChanged(key)) continue;
    if (
      isStartedMatch({
        status: existing.status,
        winnerDecidedBy: existing.winnerDecidedBy,
        isBye: isByeRow(existing.rules),
      })
    ) {
      throw new BracketSwapError(
        "順位決定戦の組み合わせが変わるため、この入れ替えはできません。すでに進行している対戦があります。",
        "DOWNSTREAM_STARTED",
        409
      );
    }
  }

  // 新しく行を作る場合の日程の割り当て元。**粒度は (depth, roundInBlock)**
  // — tournament.ts の作成時(`planPlacementSessions`)と同じ粒度で揃える。
  // 同じ round でも別のブロック・別のラウンド内位置なら別の日程でありうるので、
  // round だけをキーにすると別ブロックの日程を誤って継承しうる。
  //
  // 1. 同じ (depth, roundInBlock) の既存の順位決定戦行があればそれを使う。
  // 2. 無ければ、`planPlacementSessions` の既定値ロジックと同じく本選の決勝と同じ日程にする。
  const sessionByBlockRound = new Map<string, string>();
  for (const [key, existing] of existingByKey) {
    const before = beforeByKey.get(key);
    if (!before) continue;
    const blockKey = `${before.depth}:${before.match.roundInBlock}`;
    if (!sessionByBlockRound.has(blockKey)) sessionByBlockRound.set(blockKey, existing.sessionId);
  }
  const finalMainSessionId = mainRows.reduce<{ round: number; sessionId: string } | null>(
    (best, m) => (!best || m.round > best.round ? { round: m.round, sessionId: m.sessionId } : best),
    null
  )?.sessionId;

  const sessionIdsToLoad = new Set<string>([
    ...sessionByBlockRound.values(),
    ...(finalMainSessionId ? [finalMainSessionId] : []),
  ]);
  const sessions = await tx.eventSession.findMany({
    where: { id: { in: [...sessionIdsToLoad] } },
    select: { id: true, startAt: true, endAt: true },
  });
  const sessionInfo = new Map(sessions.map((s) => [s.id, s]));

  // 削除: after に存在しなくなった既存行。
  const toDelete = [...existingByKey.entries()]
    .filter(([key]) => !afterByKey.has(key))
    .map(([, m]) => m.id);
  if (toDelete.length > 0) {
    await tx.eventMatch.deleteMany({ where: { id: { in: toDelete } } });
  }

  // 作成・更新。
  for (const [key, { depth: blockDepth, rank, blockRoundCount, match }] of afterByKey) {
    const existing = existingByKey.get(key);
    const rules: Prisma.InputJsonObject = {
      roundLabel: placementRoundLabel(rank, match.roundInBlock, blockRoundCount),
      placement: { depth: blockDepth, rank },
      ...(match.loserFrom ? { loserFrom: match.loserFrom } : {}),
      ...(match.isBye ? { bye: true } : {}),
    };

    if (existing) {
      if (!structureChanged(key)) continue; // 何も変わっていない行は触らない
      // 構造が変わった(が進行していないことは上で確認済み)行は検知やり直しと同じ状態へ戻す。
      // **サイドの出場者も消す。** loserFrom が変わると、旧サイドに残っていた出場者が
      // 新しい loserFrom の null 側(BYE 側)に取り残されうる — advanceBracket() は
      // null エントリを転送しないので、消さないと不戦勝行に旧出場者が残ったままになる。
      await tx.eventMatchSideParticipant.deleteMany({
        where: { sideId: { in: existing.sides.map((s) => s.id) } },
      });
      await tx.eventMatchSide.updateMany({
        where: { matchId: existing.id },
        data: { teamId: null, diamonds: 0, score: 0 },
      });
      await tx.eventMatch.update({
        where: { id: existing.id },
        data: {
          rules,
          status: "SCHEDULED",
          winnerSideId: null,
          winnerDecidedBy: null,
          decidedAt: null,
          detectedBattleId: null,
          detectedStartAt: null,
          detectedEndAt: null,
          detectionConfidence: null,
          detectedEndSource: null,
        },
      });
      continue;
    }

    // 新規作成(ブロックが拡大したケース)。
    const sessionId = sessionByBlockRound.get(`${blockDepth}:${match.roundInBlock}`) ?? finalMainSessionId;
    const session = sessionId ? sessionInfo.get(sessionId) : undefined;
    if (!sessionId || !session) {
      throw new BracketSwapError(
        "順位決定戦の新しい対戦に割り当てる日程が見つかりません。表を破棄して作り直してください。",
        "BRACKET_INCONSISTENT",
        409
      );
    }
    const created = await tx.eventMatch.create({
      data: {
        eventId,
        round: match.round,
        bracketPosition: match.position,
        matchType: "1V1",
        sessionId,
        scheduledStartAt: session.startAt,
        scheduledEndAt: session.endAt,
        status: "SCHEDULED",
        rules,
      },
    });
    await tx.eventMatchSide.createMany({
      data: [0, 1].map((sideIndex) => ({ matchId: created.id, sideIndex })),
    });
  }
}
