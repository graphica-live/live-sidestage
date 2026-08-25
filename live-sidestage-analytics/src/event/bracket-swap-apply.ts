import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "./analytics-db";
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
import { downstreamStarted } from "./match-downstream";
import { advanceBracket } from "./match-results";
import { isByeRow, isPlainObject, isStartedMatch } from "./match-status";
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

  const slotA = resolveSlot(matches, a);
  const slotB = resolveSlot(matches, b);

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
  // 葉の占有を復元し、交換後の構造を出す
  // ------------------------------------------------------------------
  const roundCount = Math.max(...matches.map((m) => m.round));
  const size = 2 ** roundCount;
  const occupancy = restoreOccupancy(
    matches.filter((m) => m.round === 1),
    size
  );

  const beforeShape = bracketShape(occupancy);
  const originalKeys = new Map(matches.map((m) => [m.id, shapeKey(m.round, m.bracketPosition)]));
  assertShapeMatches(beforeShape, [...originalKeys.values()]);

  const rangeA = slotLeafRange(slotA.match.round, slotA.match.bracketPosition, a.sideIndex);
  const rangeB = slotLeafRange(slotB.match.round, slotB.match.bracketPosition, b.sideIndex);
  const afterShape = bracketShape(swapLeafRanges(occupancy, rangeA, rangeB));

  // ------------------------------------------------------------------
  // 行の移動。**中身(結果・検知)はそのままで座標だけ動かす**ので、確定済みの
  // 1回戦カードも matchId ごと新しい枝へ移る。
  // ------------------------------------------------------------------
  const moves = planRowMoves({ rows: matches, rangeA, rangeB });
  for (const move of moves) {
    await tx.eventMatch.update({
      where: { id: move.id },
      data: { bracketPosition: move.to },
    });
  }
  // **一意制約が無く、同一トランザクション内で中間状態を読む主体もいない**ので、
  // 一時退避は要らない(`advanceBracket` はこの後で自分から読み直す)。
  const movedTo = new Map(moves.map((move) => [move.id, move.to]));
  for (const match of matches) {
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
  for (const match of matches) {
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
