import { describe, it, expect } from "vitest";
import { buildManualBracket } from "./bracket";
import {
  bracketShape,
  planRowMoves,
  restoreOccupancy,
  shapeKey,
  slotLeafRange,
  swapLeafRanges,
  type FirstRoundRow,
} from "./bracket-swap";

/** 1回戦の行1件。既定は実試合(両サイドに人が来る)。 */
function firstRound(
  position: number,
  options: { bye?: "rules" | "legacy"; winnerSideIndex?: number } = {}
): FirstRoundRow {
  const sides = [
    { id: `s${position}a`, sideIndex: 0 },
    { id: `s${position}b`, sideIndex: 1 },
  ];
  if (!options.bye) {
    return { bracketPosition: position, rules: {}, winnerDecidedBy: null, winnerSideId: null, sides };
  }
  const winner = sides[options.winnerSideIndex ?? 0];
  return {
    bracketPosition: position,
    // 旧データは `rules.bye` を持たず、`winnerDecidedBy` だけで不戦勝と分かる。
    rules: options.bye === "rules" ? { bye: true } : {},
    winnerDecidedBy: "BYE",
    winnerSideId: winner.id,
    sides,
  };
}

describe("slotLeafRange", () => {
  it("1回戦の枠は葉そのものを指す", () => {
    expect(slotLeafRange(1, 0, 0)).toEqual({ start: 0, length: 1 });
    expect(slotLeafRange(1, 0, 1)).toEqual({ start: 1, length: 1 });
    expect(slotLeafRange(1, 2, 1)).toEqual({ start: 5, length: 1 });
  });

  it("2回戦の枠は葉2つ分(1回戦のカード1枚)を指す", () => {
    expect(slotLeafRange(2, 0, 0)).toEqual({ start: 0, length: 2 });
    expect(slotLeafRange(2, 0, 1)).toEqual({ start: 2, length: 2 });
    expect(slotLeafRange(2, 1, 0)).toEqual({ start: 4, length: 2 });
  });

  it("3回戦の枠は葉4つ分(部分木まるごと)を指す", () => {
    expect(slotLeafRange(3, 0, 0)).toEqual({ start: 0, length: 4 });
    expect(slotLeafRange(3, 0, 1)).toEqual({ start: 4, length: 4 });
  });
});

describe("restoreOccupancy", () => {
  it("実試合の行は両方の葉を占有とみなす", () => {
    expect(restoreOccupancy([firstRound(0), firstRound(1)], 4)).toEqual([true, true, true, true]);
  });

  it("不戦勝行は勝者のいる側の葉だけを占有とみなす", () => {
    const rows = [firstRound(0), firstRound(1, { bye: "rules", winnerSideIndex: 1 })];
    expect(restoreOccupancy(rows, 4)).toEqual([true, true, false, true]);
  });

  it("rules.bye を持たない旧データも winnerDecidedBy で不戦勝と分かる", () => {
    const rows = [firstRound(0), firstRound(1, { bye: "legacy", winnerSideIndex: 0 })];
    expect(restoreOccupancy(rows, 4)).toEqual([true, true, true, false]);
  });

  it("行が無い枝(手動配置の空き)は誰も来ない", () => {
    expect(restoreOccupancy([firstRound(0)], 4)).toEqual([true, true, false, false]);
  });

  it("出場者が1人も残っていない実試合の行でも占有は保たれる", () => {
    // 参加者を削除すると EventMatchSideParticipant は Cascade で消えるが、行は残る。
    // 中身から復元すると確定済みの実試合が不戦勝行に化けるので、構造だけを見る。
    const rows = [firstRound(0), firstRound(1)];
    expect(restoreOccupancy(rows, 4)).toEqual([true, true, true, true]);
  });

  it("勝者未確定の不戦勝行は占有なしとして扱う", () => {
    const broken: FirstRoundRow = {
      bracketPosition: 0,
      rules: { bye: true },
      winnerDecidedBy: "BYE",
      winnerSideId: null,
      sides: [{ id: "x", sideIndex: 0 }],
    };
    expect(restoreOccupancy([broken, firstRound(1)], 4)).toEqual([false, false, true, true]);
  });
});

describe("swapLeafRanges", () => {
  it("同じ長さの範囲を入れ替える", () => {
    const occupancy = [true, true, false, false];
    expect(swapLeafRanges(occupancy, { start: 0, length: 2 }, { start: 2, length: 2 })).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("元の配列を書き換えない", () => {
    const occupancy = [true, false];
    swapLeafRanges(occupancy, { start: 0, length: 1 }, { start: 1, length: 1 });
    expect(occupancy).toEqual([true, false]);
  });
});

describe("planRowMoves", () => {
  const rows = [
    { id: "r1p0", round: 1, bracketPosition: 0 },
    { id: "r1p1", round: 1, bracketPosition: 1 },
    { id: "r1p2", round: 1, bracketPosition: 2 },
    { id: "r1p3", round: 1, bracketPosition: 3 },
    { id: "r2p0", round: 2, bracketPosition: 0 },
    { id: "r2p1", round: 2, bracketPosition: 1 },
    { id: "r3p0", round: 3, bracketPosition: 0 },
  ];

  it("1回戦の枠を入れ替えても行は動かない(中身の交換で足りる)", () => {
    const moves = planRowMoves({
      rows,
      rangeA: slotLeafRange(1, 0, 0),
      rangeB: slotLeafRange(1, 3, 1),
    });
    expect(moves).toEqual([]);
  });

  it("2回戦の枠を入れ替えると feeder の1回戦カードが入れ替わる", () => {
    const moves = planRowMoves({
      rows,
      // 2回戦 position0 の下側(feeder = 1回戦 p1)と position1 の上側(feeder = 1回戦 p2)
      rangeA: slotLeafRange(2, 0, 1),
      rangeB: slotLeafRange(2, 1, 0),
    });
    expect(moves).toEqual([
      { id: "r1p1", round: 1, from: 1, to: 2 },
      { id: "r1p2", round: 1, from: 2, to: 1 },
    ]);
  });

  it("決勝の枠を入れ替えると部分木まるごと(複数ラウンド)が移動する", () => {
    const moves = planRowMoves({
      rows,
      rangeA: slotLeafRange(3, 0, 0),
      rangeB: slotLeafRange(3, 0, 1),
    });
    expect(moves).toEqual(
      expect.arrayContaining([
        { id: "r1p0", round: 1, from: 0, to: 2 },
        { id: "r1p1", round: 1, from: 1, to: 3 },
        { id: "r1p2", round: 1, from: 2, to: 0 },
        { id: "r1p3", round: 1, from: 3, to: 1 },
        { id: "r2p0", round: 2, from: 0, to: 1 },
        { id: "r2p1", round: 2, from: 1, to: 0 },
      ])
    );
    // 決勝そのものは範囲を包含する側なので動かない。
    expect(moves.some((m) => m.id === "r3p0")).toBe(false);
  });
});

describe("bracketShape", () => {
  it("不戦勝行には人が来る側の sideIndex が入る", () => {
    const shape = bracketShape([true, false, true, true]);
    expect(shape.get(shapeKey(1, 0))).toEqual({ isBye: true, aliveSideIndex: 0 });
    expect(shape.get(shapeKey(1, 1))).toEqual({ isBye: false, aliveSideIndex: null });
  });

  it("誰も来ない枝の行は作られない", () => {
    const shape = bracketShape([true, true, false, false]);
    expect(shape.has(shapeKey(1, 1))).toBe(false);
    // 決勝は片側しか来ないので不戦勝行になる。
    expect(shape.get(shapeKey(2, 0))).toEqual({ isBye: true, aliveSideIndex: 0 });
  });
});

/** 決定的な擬似乱数(テストを再現可能にする)。 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomOccupied(size: number, count: number, seed: number): boolean[] {
  const next = rng(seed);
  const indexes = Array.from({ length: size }, (_, i) => i);
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  const occupied = new Array<boolean>(size).fill(false);
  for (const index of indexes.slice(0, count)) occupied[index] = true;
  return occupied;
}

describe("スワップ後の座標の整合性", () => {
  it("交換後に必要な行が、行移動だけですべて揃う(新しい行の作成が要らない)", () => {
    // ここが崩れると、サーバー側は BRACKET_INCONSISTENT で中断するしかなくなる。
    // 逆に「余る行」は出てよい(誰も来なくなった不戦勝行・空行が消えるだけ)。
    const cases: boolean[][] = [
      [true, true, true, true],
      [true, false, true, true],
      [true, true, true, false],
      [true, false, false, true],
      [true, true, true, true, true, false, false, false],
      [true, false, true, false, true, false, true, false],
      ...[
        [8, 5],
        [8, 6],
        [16, 9],
        [16, 12],
        [16, 15],
        [32, 17],
      ].map(([size, count]) => randomOccupied(size, count, size * 31 + count)),
    ];

    for (const occupancy of cases) {
      const before = buildManualBracket(occupancy);
      const rows = before.matches.map((m) => ({
        id: shapeKey(m.round, m.position),
        round: m.round,
        bracketPosition: m.position,
      }));

      for (const match of before.matches) {
        for (const sideIndex of [0, 1]) {
          for (const other of before.matches) {
            if (other.round !== match.round || other.position === match.position) continue;
            for (const otherSide of [0, 1]) {
              const rangeA = slotLeafRange(match.round, match.position, sideIndex);
              const rangeB = slotLeafRange(other.round, other.position, otherSide);
              const after = buildManualBracket(swapLeafRanges(occupancy, rangeA, rangeB));

              const moved = new Map(rows.map((r) => [r.id, r.bracketPosition]));
              for (const move of planRowMoves({ rows, rangeA, rangeB })) {
                moved.set(move.id, move.to);
              }
              const available = new Set(
                rows.map((r) => shapeKey(r.round, moved.get(r.id)!))
              );

              for (const target of after.matches) {
                expect(
                  available.has(shapeKey(target.round, target.position)),
                  `size=${occupancy.length} ${shapeKey(match.round, match.position)}#${sideIndex} ⇄ ` +
                    `${shapeKey(other.round, other.position)}#${otherSide}: ` +
                    `${shapeKey(target.round, target.position)} の行が足りない`
                ).toBe(true);
              }

              // 行の総数は変わらないか減るだけ(増えない)。
              expect(after.matches.length).toBeLessThanOrEqual(rows.length);
            }
          }
        }
      }
    }
  });

  it("交換しても占有している葉の数は変わらない", () => {
    const occupancy = [true, true, false, true, true, false, false, true];
    const swapped = swapLeafRanges(occupancy, slotLeafRange(2, 0, 0), slotLeafRange(2, 1, 1));
    expect(swapped.filter(Boolean).length).toBe(occupancy.filter(Boolean).length);
  });
});
