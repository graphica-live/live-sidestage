// シングルイリミネーションのトーナメント表。純粋関数だけを置く(テスト対象)。
//
// TikTok のバトル検知とは独立している。検知が働かなくても主催者が手動で勝者を
// 確定できるよう、進行のルールはここだけに閉じ込める。

export type BracketSource =
  /** 1回戦の枠に入るエントリー(0始まり。シード順に割り当てる) */
  | { kind: "ENTRANT"; entrantIndex: number }
  /** 参加者数が2のべき乗でないときの不戦勝枠 */
  | { kind: "BYE" }
  /** 前のラウンドの勝者 */
  | { kind: "WINNER_OF"; round: number; position: number };

export type BracketMatch = {
  /** 1始まり。1が1回戦 */
  round: number;
  /** ラウンド内の位置。0始まり */
  position: number;
  sourceA: BracketSource;
  sourceB: BracketSource;
};

export type Bracket = {
  /** 決勝までのラウンド数 */
  roundCount: number;
  /** 1回戦の枠数(2のべき乗)。entrantCount との差が BYE になる */
  size: number;
  matches: BracketMatch[];
};

/** entrantCount 以上で最小の2のべき乗。 */
export function bracketSize(entrantCount: number): number {
  let size = 1;
  while (size < entrantCount) size *= 2;
  return Math.max(size, 2);
}

/**
 * 標準的なブラケットのシード順を作る。
 *
 * size=4 なら [1,4,2,3] — 1位と4位、2位と3位が1回戦で当たり、勝てば決勝で1位対2位になる。
 * 強い順に並べた参加者をこの順で枠へ入れると、上位シードが早い段階で潰し合わない。
 */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const pairSum = order.length * 2 + 1;
    const expanded: number[] = [];
    for (const seed of order) {
      expanded.push(seed, pairSum - seed);
    }
    order = expanded;
  }
  return order;
}

/**
 * 参加者数からトーナメント表の構造を作る。
 *
 * 2のべき乗でない場合は1回戦に BYE(不戦勝)が入り、上位シードが2回戦から始まる。
 * 実際の参加者・チームの割り当ては呼び出し側で行う(ここは構造だけ)。
 */
export function buildBracket(entrantCount: number): Bracket {
  if (entrantCount < 2) {
    return { roundCount: 0, size: 0, matches: [] };
  }

  const size = bracketSize(entrantCount);
  const roundCount = Math.log2(size);
  const order = seedOrder(size);
  const matches: BracketMatch[] = [];

  // 1回戦。シード順の枠に参加者を入れ、定員を超える枠は BYE にする。
  for (let position = 0; position < size / 2; position++) {
    const seedA = order[position * 2];
    const seedB = order[position * 2 + 1];
    matches.push({
      round: 1,
      position,
      sourceA: toSource(seedA, entrantCount),
      sourceB: toSource(seedB, entrantCount),
    });
  }

  // 2回戦以降は前のラウンドの勝者同士。
  for (let round = 2; round <= roundCount; round++) {
    const count = size / 2 ** round;
    for (let position = 0; position < count; position++) {
      matches.push({
        round,
        position,
        sourceA: { kind: "WINNER_OF", round: round - 1, position: position * 2 },
        sourceB: { kind: "WINNER_OF", round: round - 1, position: position * 2 + 1 },
      });
    }
  }

  return { roundCount, size, matches };
}

function toSource(seed: number, entrantCount: number): BracketSource {
  return seed <= entrantCount
    ? { kind: "ENTRANT", entrantIndex: seed - 1 }
    : { kind: "BYE" };
}

/** 勝者が進む先。決勝(次がない)なら null。 */
export function nextSlot(
  round: number,
  position: number,
  roundCount: number
): { round: number; position: number; sideIndex: number } | null {
  if (round >= roundCount) return null;
  return {
    round: round + 1,
    position: Math.floor(position / 2),
    // 偶数位置の勝者が上側(sideIndex 0)、奇数位置が下側に入る
    sideIndex: position % 2,
  };
}

export type ResolvedMatch = {
  round: number;
  position: number;
  /** 各サイドに入る参加者。null は未確定 */
  sides: (number | null)[];
  /** 不戦勝で自動的に勝者が決まる場合、その sideIndex */
  autoWinnerSide: number | null;
};

/**
 * トーナメント表に参加者を配置し、不戦勝を解決する。
 *
 * `entrants` はシード順(強い順)に並べた参加者ID。1回戦で BYE と当たった側は
 * 対戦せずに次のラウンドへ進む(`autoWinnerSide` が立つ)。
 */
export function resolveBracket(entrants: string[]): {
  roundCount: number;
  matches: (ResolvedMatch & { sideIds: (string | null)[] })[];
} {
  const bracket = buildBracket(entrants.length);
  const resolved: (ResolvedMatch & { sideIds: (string | null)[] })[] = [];

  for (const match of bracket.matches) {
    const sides = [match.sourceA, match.sourceB].map((s) =>
      s.kind === "ENTRANT" ? s.entrantIndex : null
    );
    const sideIds = sides.map((i) => (i === null ? null : (entrants[i] ?? null)));

    // 片方が BYE で、もう片方に参加者がいるなら不戦勝。
    const byeSides = [match.sourceA, match.sourceB].map((s) => s.kind === "BYE");
    let autoWinnerSide: number | null = null;
    if (byeSides[0] && !byeSides[1]) autoWinnerSide = 1;
    else if (byeSides[1] && !byeSides[0]) autoWinnerSide = 0;

    resolved.push({
      round: match.round,
      position: match.position,
      sides,
      sideIds,
      autoWinnerSide,
    });
  }

  return { roundCount: bracket.roundCount, matches: resolved };
}

/** ラウンドの呼び名。決勝から逆算する。 */
export function roundLabel(round: number, roundCount: number): string {
  const remaining = roundCount - round;
  if (remaining === 0) return "決勝";
  if (remaining === 1) return "準決勝";
  if (remaining === 2) return "準々決勝";
  return `${2 ** (remaining + 1)}人制 ${round}回戦`;
}
