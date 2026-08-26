// トーナメント表の組み合わせ変更(スワップ)の純粋関数。**DB に触らない。**
//
// 進行(`match-results.ts` の `advanceBracket`)は `nextSlot()` の固定二分木座標だけで
// 転送先を決め、毎回下流を再構築する。したがって「準決勝カードのサイドの中身だけ
// 差し替える」は次の集計周回で必ず巻き戻される。**座標を壊さずに組み合わせを変える
// 唯一の方法は、上流のサブツリーごと位置を移すこと。**
//
// そこでスワップを「1回戦の葉(leaf)の占有パターンの交換」として定義する。
// 1回戦の入れ替えも準決勝の枝ごと交換も同じ操作になり、交換後の構造
// (どの行が存在するか / どれが不戦勝行か)は既存の `buildManualBracket()` が返す。
// 不戦勝の判定をここで書き直さないので、`rules.bye` の印と実際の転送内容が
// 食い違うことがない(食い違うと無関係な2人の実試合を丸ごと不戦勝処理する
// データ破損になる。`src/event/CLAUDE.md` 参照)。

import { buildManualBracket } from "./bracket";
import { isByeRow } from "./match-status";

/** 1回戦の葉の連続範囲。`[start, start + length)` の半開区間。 */
export type LeafRange = { start: number; length: number };

/**
 * スロット(round, position, sideIndex)が支配する1回戦の葉の範囲。
 *
 * side s of (r, p) へ勝ち上がってくるのは `nextSlot()` の座標上 (r-1, 2p+s) の行で、
 * その部分木の葉は `[(2p+s) * 2^(r-1), +2^(r-1))`(帰納法で成立)。
 * r = 1 なら長さ1、つまり葉そのものになる。
 */
export function slotLeafRange(round: number, position: number, sideIndex: number): LeafRange {
  const length = 2 ** (round - 1);
  return { start: (position * 2 + sideIndex) * length, length };
}

/** 葉の占有を復元するために読む1回戦の行。 */
export type FirstRoundRow = {
  bracketPosition: number;
  rules: unknown;
  winnerDecidedBy: string | null;
  winnerSideId: string | null;
  sides: { id: string; sideIndex: number }[];
};

/**
 * 1回戦の**行の構造から**葉の占有を復元する。
 *
 * **サイドに出場者がいるかで判定してはいけない。** `removeParticipant()` は
 * `EventParticipant` を物理削除し、`EventMatchSideParticipant` は `onDelete: Cascade` なので、
 * **確定済みの実試合カードからも出場者が消える**。中身から復元すると、参加者を1人外した
 * だけで確定済みの実試合が「不戦勝行」と判定され、無関係な行に `rules.bye` が付く
 * (両方消えていればその行ごと削除される)。構造だけを根拠にすればこの影響を受けない。
 *
 * 1回戦の静的不戦勝行は `createBracket()` が作成時に必ず `FINISHED` + `winnerSideId` を
 * 立てるので、副情報なしで生存側を特定できる。`rules.bye` を持たない旧データは
 * `winnerDecidedBy === "BYE"` で拾う(`isStartedMatch()` と同じ後方互換)。
 */
export function restoreOccupancy(rows: FirstRoundRow[], size: number): boolean[] {
  const occupancy = new Array<boolean>(size).fill(false);
  const byPosition = new Map(rows.map((row) => [row.bracketPosition, row]));

  for (let position = 0; position * 2 < size; position++) {
    const row = byPosition.get(position);
    // 行が無い枝は「誰も来ない」。手動配置で空き枠が隣り合ったときに生じる。
    if (!row) continue;

    if (isByeRow(row.rules) || row.winnerDecidedBy === "BYE") {
      const winner = row.sides.find((side) => side.id === row.winnerSideId);
      // 勝者未確定の不戦勝行は「まだ誰も来ていない」。1回戦では起こらないはずだが、
      // 壊れた行を占有ありと誤読して構造を書き換えないよう false のままにする。
      if (!winner) continue;
      occupancy[position * 2 + winner.sideIndex] = true;
      continue;
    }

    occupancy[position * 2] = true;
    occupancy[position * 2 + 1] = true;
  }

  return occupancy;
}

/** 2つの葉範囲の中身を入れ替える。長さは呼び出し側で揃える(同じラウンドなら必ず同じ)。 */
export function swapLeafRanges(
  occupancy: readonly boolean[],
  a: LeafRange,
  b: LeafRange
): boolean[] {
  const next = [...occupancy];
  for (let offset = 0; offset < a.length; offset++) {
    next[a.start + offset] = occupancy[b.start + offset];
    next[b.start + offset] = occupancy[a.start + offset];
  }
  return next;
}

export type MovableRow = { id: string; round: number; bracketPosition: number };

/**
 * 葉範囲の交換にともなう行の移動を計画する。
 *
 * 行 (round, position) が支配する葉は `[position * 2^round, +2^round)`。交換する範囲の
 * 長さは `2^(r-1)` で、範囲へ完全に含まれるのは `round < r` の行だけ(`round >= r` の行は
 * 範囲を包含するか素になる。二進区間なので部分的な重なりは起こらない)。
 *
 * 移動量 `(相手の start - 自分の start) / 2^round` は常に整数になる — どちらの start も
 * `2^(r-1)` の倍数で、`2^round` はその約数だから。
 */
export function planRowMoves(input: {
  rows: MovableRow[];
  rangeA: LeafRange;
  rangeB: LeafRange;
}): { id: string; round: number; from: number; to: number }[] {
  const { rows, rangeA, rangeB } = input;
  const moves: { id: string; round: number; from: number; to: number }[] = [];

  for (const row of rows) {
    const span = 2 ** row.round;
    const start = row.bracketPosition * span;
    const within = (range: LeafRange) =>
      start >= range.start && start + span <= range.start + range.length;

    const [from, to] = within(rangeA)
      ? [rangeA, rangeB]
      : within(rangeB)
        ? [rangeB, rangeA]
        : [null, null];
    if (!from || !to) continue;

    moves.push({
      id: row.id,
      round: row.round,
      from: row.bracketPosition,
      to: row.bracketPosition + (to.start - from.start) / span,
    });
  }

  return moves;
}

/** 表の形。`${round}:${position}` → その行が不戦勝行か、不戦勝ならどちら側に人が来るか。 */
export type BracketShape = Map<string, { isBye: boolean; aliveSideIndex: number | null }>;

export function shapeKey(round: number, position: number): string {
  return `${round}:${position}`;
}

/**
 * 葉の占有から表の形を出す。**構造の正本は `buildManualBracket()` 側**で、ここは
 * その結果を座標で引ける形へ畳んでいるだけ。
 *
 * 不戦勝行の `aliveSideIndex` は「BYE でない側」。両側 BYE の行は作られないので、
 * 不戦勝行なら必ずどちらか一方に決まる。
 */
export function bracketShape(occupancy: readonly boolean[]): BracketShape {
  const bracket = buildManualBracket([...occupancy]);
  const shape: BracketShape = new Map();

  for (const match of bracket.matches) {
    const byeA = match.sourceA.kind === "BYE";
    const byeB = match.sourceB.kind === "BYE";
    shape.set(shapeKey(match.round, match.position), {
      isBye: byeA || byeB,
      aliveSideIndex: byeA ? 1 : byeB ? 0 : null,
    });
  }

  return shape;
}
