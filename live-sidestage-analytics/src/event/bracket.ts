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

/**
 * ブラケットの方式。
 *
 * - STANDARD:    標準シード方式。不戦勝(BYE)を1回戦に集中させ、上位シードへ優先的に割り当てる
 *                (プロ大会でよく使われる方式)
 * - STAGED_BYE:  段階的不戦勝方式。各ラウンドで参加者数を半分に割り、奇数なら1人だけ不戦勝にする
 *                (アマチュア大会でよく使われる方式)。総試合数はどちらも entrantCount-1 で同じで、
 *                違うのは不戦勝の配り方だけ
 */
export const BRACKET_METHODS = ["STANDARD", "STAGED_BYE"] as const;
export type BracketMethod = (typeof BRACKET_METHODS)[number];

/** entrantCount 以上で最小の2のべき乗。 */
export function bracketSize(entrantCount: number): number {
  let size = 1;
  while (size < entrantCount) size *= 2;
  return Math.max(size, 2);
}

/**
 * 手動配置で受け付ける枠数の上限。
 *
 * 1イベントの参加者は 200 人・チームは 100 組が上限(`validation.ts` の `MAX_PARTICIPANTS` /
 * `MAX_TEAMS`)なので、必要な枠数は最大でも 256。これ以上を許すと、2組しか配置していない
 * のに巨大な疎ツリー(不戦勝行だらけ)を作れてしまう。
 */
export const MAX_BRACKET_SIZE = 256;

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

type StagedNode = {
  /** この節から誰か1人が勝ち上がってくるか。false なら試合は作らない(誰もいない)。 */
  alive: boolean;
  source: BracketSource | null;
};

/**
 * 段階的不戦勝方式でトーナメント表の構造を作る。
 *
 * **`nextSlot()` は「ラウンド r の位置 p, p+1(p が偶数)の勝者が、ラウンド r+1 の
 * 位置 p/2 に集約される」という固定の二分木座標を機械的に前提にしている。**
 * これは進行(match-results.ts)が行自身の (round, position) だけから次の送り先を
 * 計算するために必要な制約で、`sourceA`/`sourceB` に何を書いても変わらない
 * (`WINNER_OF{round,position}` は記録用途にすぎず、実際の転送先はこの座標だけで決まる)。
 *
 * したがって「誰と誰が対戦するか」は生成器側で自由に決められるものではなく、
 * **標準方式(`buildBracket`)と同じ size=2^roundCount の完全二分木**の上でしか
 * 表現できない。段階的方式の違いは、葉(1回戦)に置く ENTRANT/BYE の配置だけである:
 *
 * - 標準方式: `seedOrder()` で上位シードと下位シード(BYE 候補)をペアにし、
 *   BYE が生じても必ず 1回戦だけで消化しきる配置にする
 * - 段階的方式: 実participantを先頭の葉に詰め、残りをBYEにする。BYE同士が
 *   隣り合った葉は「試合が存在しない」(誰も来ない)ものとして扱い、その"空"が
 *   上位ラウンドへ伝播する。ある葉の片方だけが実participant側であれば、
 *   そのラウンドで初めて不戦勝行が生まれる — これにより、BYE をすべて1回戦で
 *   消化する標準方式と違い、不戦勝が複数ラウンドに分かれて出現するようになる
 *
 * 各節(round, position)の状態は、子2つ(round-1 の position*2, position*2+1)から
 * 再帰的に決まる:
 *
 * - 両方の子が alive → 実試合(sourceA/B は両方の子の source)
 * - 片方だけ alive → 不戦勝行(alive な側の source と BYE の組。**構造的に
 *   相手側には誰も来ないことが保証されている**行にのみ「不戦勝」の印を付けられる
 *   ので、実際に対戦しうる2人を誤って不戦勝処理してしまうことがない)
 * - 両方とも alive でない → この節は存在しない(試合を作らない。誰もここへ
 *   転送されない)
 *
 * 総試合数(alive な行の数)は entrantCount-1 で標準方式と同じ。ラウンド数も
 * 標準方式と一致する(どちらも entrantCount 以上で最小の2のべき乗の log2)。
 *
 * **葉の配置(誰を先頭に詰めるか)は、この2つの制約(1) 総試合数が最小、
 * (2) 対戦の同一性が座標だけで決まる、を満たす範囲で決定的でありさえすればよい**
 * — 実際に誰が何ラウンド不戦勝になるかの細かい公平性(同じ人の連続不戦勝を
 * 避けられるか等)は葉の配置次第で変わりうるが、それよりも「rules.bye の印と
 * 実際に転送される内容が必ず一致する」という安全性を優先する。
 */
export function buildStagedBracket(entrantCount: number): Bracket {
  if (entrantCount < 2) {
    return { roundCount: 0, size: 0, matches: [] };
  }

  const size = bracketSize(entrantCount);
  return buildFromLeaves(
    Array.from({ length: size }, (_, i) =>
      i < entrantCount ? ({ kind: "ENTRANT", entrantIndex: i } as BracketSource) : null
    )
  );
}

/**
 * 1回戦の枠(葉)の中身から表の構造を作る。段階的不戦勝方式と手動配置の共通の土台。
 *
 * `leaves[i]` が null の枠は「誰も来ない」。上の `buildStagedBracket` の解説どおり、
 * 各節の状態は子2つから再帰的に決まる(両方 alive なら実試合、片方だけなら不戦勝行、
 * どちらも来ないなら行を作らない)。**`nextSlot()` の固定座標の上でしか表現しない**ので、
 * 葉に何を置いても「不戦勝の印」と実際の転送内容が食い違うことはない。
 *
 * **片側だけ生きている場合に左右を入れ替えない。** 手動配置では「カードの上下どちらの枠へ
 * 置いたか」が主催者の指定そのもので、寄せてしまうと指定が失われる。段階的方式は葉を
 * 先頭から詰めるので右だけ生存という形にはならず、この違いによる挙動の変化はない。
 */
function buildFromLeaves(leaves: (BracketSource | null)[]): Bracket {
  const size = leaves.length;
  if (size < 2) return { roundCount: 0, size: 0, matches: [] };

  const roundCount = Math.log2(size);
  const matches: BracketMatch[] = [];

  let level: StagedNode[] = leaves.map((source) => ({ alive: source !== null, source }));

  for (let round = 1; round <= roundCount; round++) {
    const next: StagedNode[] = [];
    for (let position = 0; position * 2 < level.length; position++) {
      const left = level[position * 2];
      const right = level[position * 2 + 1];

      if (left.alive || right.alive) {
        matches.push({
          round,
          position,
          sourceA: left.alive ? left.source! : { kind: "BYE" },
          sourceB: right.alive ? right.source! : { kind: "BYE" },
        });
        next.push({ alive: true, source: { kind: "WINNER_OF", round, position } });
      } else {
        next.push({ alive: false, source: null });
      }
    }
    level = next;
  }

  return { roundCount, size, matches };
}

/**
 * 主催者が1回戦の枠へ直接エントリーを置いた表の構造。
 *
 * `occupied[i]` = 葉 i にエントリーが置かれているか。枠数(配列長)は2のべき乗で、
 * 空き枠は不戦勝(BYE)になる。**シード順の概念は無い** — 誰と誰が当たるかは配置がすべて。
 */
export function buildManualBracket(occupied: boolean[]): Bracket {
  if (occupied.filter(Boolean).length < 2) {
    return { roundCount: 0, size: 0, matches: [] };
  }
  return buildFromLeaves(
    occupied.map((taken, i) => (taken ? ({ kind: "ENTRANT", entrantIndex: i } as BracketSource) : null))
  );
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
  /**
   * どちらかのサイドが BYE の行か。静的(相手が ENTRANT、autoWinnerSide が立つ)・
   * 動的(相手が WINNER_OF、段階的方式で相手が実試合の勝者未確定)のどちらも該当する。
   * 呼び出し側(tournament.ts)が DB 行に不戦勝の印を残すために使う。
   */
  isBye: boolean;
};

/**
 * トーナメント表に参加者を配置し、不戦勝を解決する。
 *
 * `entrants` はシード順(強い順)に並べた参加者ID。1回戦で BYE と当たった側は
 * 対戦せずに次のラウンドへ進む(`autoWinnerSide` が立つ)。
 */
export function resolveBracket(
  entrants: string[],
  method: BracketMethod = "STANDARD"
): {
  roundCount: number;
  matches: (ResolvedMatch & { sideIds: (string | null)[] })[];
} {
  const bracket =
    method === "STAGED_BYE" ? buildStagedBracket(entrants.length) : buildBracket(entrants.length);
  return resolveFromBracket(bracket, (index) => entrants[index] ?? null);
}

/**
 * 主催者が1回戦の枠へ直接置いた配置を解決する。
 *
 * `slots[i]` = 葉 i に置いたエントリーID(空き枠は null)。**配列長がそのまま枠数**で、
 * 妥当性(2のべき乗・枠数と配置数の対応・重複)は `validatePlacement` で先に確かめる。
 */
export function resolveManualBracket(slots: (string | null)[]): {
  roundCount: number;
  matches: (ResolvedMatch & { sideIds: (string | null)[] })[];
} {
  const bracket = buildManualBracket(slots.map((id) => id !== null));
  return resolveFromBracket(bracket, (index) => slots[index] ?? null);
}

function resolveFromBracket(
  bracket: Bracket,
  entrantAt: (index: number) => string | null
): {
  roundCount: number;
  matches: (ResolvedMatch & { sideIds: (string | null)[] })[];
} {
  const resolved: (ResolvedMatch & { sideIds: (string | null)[] })[] = [];

  for (const match of bracket.matches) {
    const sides = [match.sourceA, match.sourceB].map((s) =>
      s.kind === "ENTRANT" ? s.entrantIndex : null
    );
    const sideIds = sides.map((i) => (i === null ? null : entrantAt(i)));

    // 片方が BYE で、もう片方が実在の参加者(ENTRANT)なら、作成時点で不戦勝を確定できる。
    // もう片方が WINNER_OF(段階的方式の動的な不戦勝)の場合は、この時点では誰が来るか
    // 決まっていないので自動確定しない — match-results.ts の進行処理が、実際に
    // 参加者が埋まった時点で確定させる。
    let autoWinnerSide: number | null = null;
    if (match.sourceA.kind === "ENTRANT" && match.sourceB.kind === "BYE") autoWinnerSide = 0;
    else if (match.sourceB.kind === "ENTRANT" && match.sourceA.kind === "BYE") autoWinnerSide = 1;

    resolved.push({
      round: match.round,
      position: match.position,
      sides,
      sideIds,
      autoWinnerSide,
      isBye: match.sourceA.kind === "BYE" || match.sourceB.kind === "BYE",
    });
  }

  return { roundCount: bracket.roundCount, matches: resolved };
}

/**
 * 手動配置の妥当性。**サーバー側の検証の正本**(UI と API の両方がこれを使う)。
 *
 * 枠数を「配置数以上で最小の2のべき乗」に固定しているのが肝で、これがないと API を直接
 * 叩いて「2組しか置いていないのに 256 枠」のような疎ツリーを作れてしまう。不戦勝行と
 * DB 書き込みが無駄に増えるうえ、ウィザードが日程を割り当てたラウンド数とも食い違う。
 */
export function validatePlacement(
  slots: readonly (string | null)[]
): { ok: true } | { ok: false; error: string } {
  if (slots.length > MAX_BRACKET_SIZE) {
    return { ok: false, error: `トーナメント表の枠は${MAX_BRACKET_SIZE}までです。` };
  }

  const placed = slots.filter((id): id is string => id !== null);
  if (placed.length < 2) {
    return { ok: false, error: "トーナメント表を作るには2組以上を枠へ置いてください。" };
  }
  if (new Set(placed).size !== placed.length) {
    return { ok: false, error: "同じエントリーが複数の枠に置かれています。" };
  }

  const expected = bracketSize(placed.length);
  if (slots.length !== expected) {
    return {
      ok: false,
      error: `枠の数が合いません。${placed.length}組なら${expected}枠になります。`,
    };
  }

  return { ok: true };
}

/** ラウンドの呼び名。決勝から逆算する。標準方式専用(下の注記を参照)。 */
export function roundLabel(round: number, roundCount: number): string {
  const remaining = roundCount - round;
  if (remaining === 0) return "決勝";
  if (remaining === 1) return "準決勝";
  if (remaining === 2) return "準々決勝";
  return `${2 ** (remaining + 1)}人制 ${round}回戦`;
}

/**
 * ラウンドの呼び名。段階的不戦勝方式用。
 *
 * 標準方式の `roundLabel` は「Nラウンド前は 2^(N+1) 人制」という、参加枠数が
 * ラウンドごとに正確に半分になる標準方式だけの前提に依存している。段階的方式は
 * ラウンドごとの実際の人数が参加者数によって変わり、この前提が成立しないので、
 * 「N人制」の数値表記は出さない。
 */
export function stagedRoundLabel(round: number, roundCount: number): string {
  const remaining = roundCount - round;
  if (remaining === 0) return "決勝";
  if (remaining === 1) return "準決勝";
  if (remaining === 2) return "準々決勝";
  return `${round}回戦`;
}
