// 勝者フィーダー(どの座標の勝者がどのスロットへ入るか)の解決マップ。**DB に触らない純粋関数。**
//
// 通常は `nextSlot()`(`bracket.ts`)の固定座標だけで転送先が決まるが、組み合わせ変更
// (winner feeder edge swap, `bracket-swap-apply.ts` の `swapWinnerFeeders()`)は
// 受け側(target)の行に `EventMatch.rules.winnerFeeders` を持たせて座標既定を上書きする。
//
// **勝者辺を座標から読む箇所(`advanceBracket()` / `anyDownstreamStarted()` / `battles.ts` の
// `upstreamSlots()`)は、すべてこのモジュールが構築する `WinnerFeederGraph` を経由すること。**
// 個別に「override優先、なければ`nextSlot()`」を書き散らすと、追従漏れが
// 「下流巻き戻り」「誤ブロック/素通り」「誤検知」に直結する(`src/event/CLAUDE.md` 参照)。

import { parseWinnerFeeders } from "./match-status";

export type BracketSlot = { round: number; position: number };

/**
 * `winnerFeeders` の override が壊れている(構文不正・ラウンド不整合・source不在・
 * 全単射崩壊・孤児source)ときに `buildWinnerFeederGraph()` の呼び出し元が投げる。
 * **fail closed** — `nextSlot()` の固定座標へフォールバックしない。
 *
 * トランザクション内の呼び出し元(`match-results.ts` / `match-downstream.ts` /
 * `battles.ts` 経由、`bracket-swap-apply.ts` / `[matchId]/route.ts` / `tournament.ts` から)は
 * そのまま伝播させてロールバックさせてよい。**集計ワーカー(`event-worker.ts` 経由)は
 * イベント単位で catch し、他イベントの集計を巻き込まないこと**(`src/event/CLAUDE.md` 参照)。
 */
export class BracketInconsistentError extends Error {
  constructor() {
    super("トーナメント表の構造が壊れているため処理できません。");
    this.name = "BracketInconsistentError";
  }
}

function shapeKey(round: number, position: number): string {
  return `${round}:${position}`;
}

/** 座標(target)側から見た既定のフィーダー。`nextSlot()` の逆算。1回戦(round<=1)はsourceを持たない。 */
export function defaultSourceOf(
  targetRound: number,
  targetPosition: number,
  sideIndex: number
): BracketSlot | null {
  if (targetRound <= 1) return null;
  return { round: targetRound - 1, position: targetPosition * 2 + sideIndex };
}

export type WinnerFeederRow = {
  round: number;
  bracketPosition: number;
  rules: unknown;
};

export type WinnerFeederGraph = {
  /**
   * target座標のshapeKey(`${round}:${position}`) → sideIndex順の source座標。
   * **`null` は「誰も来ない」**(段階的不戦勝方式で、既定計算が指す座標に実際の行が
   * 存在しないケース。手動配置で空き枠が隣り合ったとき等に生じる)。
   */
  sourcesOfTarget: Map<string, [BracketSlot | null, BracketSlot | null]>;
  /** source座標のshapeKey → その勝者が向かう target座標 + sideIndex。 */
  targetOfSource: Map<string, { round: number; position: number; sideIndex: number }>;
};

export type BuildWinnerFeederGraphResult = { ok: true; graph: WinnerFeederGraph } | { ok: false };

/**
 * 全行から `WinnerFeederGraph` を構築する。
 *
 * 失敗(`{ ok: false }`)を返すのは次のいずれか(すべて fail closed。呼び出し側は
 * `BRACKET_INCONSISTENT` で止めること):
 *
 * - ある行の `rules.winnerFeeders` が構文的に壊れている(`parseWinnerFeeders` が `{ok:false}`)
 * - override の `slots` が `source.round !== target.round - 1` を満たさない(ラウンド不整合)
 * - override の `slots` が実在しない座標(`rows` に無い行)を指している(source不在。
 *   override 対象は非bye行に限定されるため、override が「誰も来ない」座標を指すのは
 *   常に異常データ — 既定計算の場合と違い null へ読み替えない)
 * - 複数の target が同じ source を指している(全単射崩壊)
 * - 実在する行(決勝でない)の勝者辺がどの target にも向かっていない(孤児 source)
 */
export function buildWinnerFeederGraph(
  rows: WinnerFeederRow[],
  roundCount: number
): BuildWinnerFeederGraphResult {
  const byShapeKey = new Map<string, WinnerFeederRow>();
  for (const row of rows) byShapeKey.set(shapeKey(row.round, row.bracketPosition), row);

  const sourcesOfTarget = new Map<string, [BracketSlot | null, BracketSlot | null]>();

  for (const row of rows) {
    const targetKey = shapeKey(row.round, row.bracketPosition);
    const parsed = parseWinnerFeeders(row.rules);

    if (parsed && !parsed.ok) return { ok: false };

    if (parsed && parsed.ok) {
      const expectedSourceRound = row.round - 1;
      const [a, b] = parsed.value.slots;
      if (a.round !== expectedSourceRound || b.round !== expectedSourceRound) return { ok: false };
      // override が指す source は実在しなければならない(bye行 = 誰も来ない座標を
      // 指すのは想定外。override 対象は非bye行に限定されているため異常データ扱い)。
      if (!byShapeKey.has(shapeKey(a.round, a.position))) return { ok: false };
      if (!byShapeKey.has(shapeKey(b.round, b.position))) return { ok: false };
      sourcesOfTarget.set(targetKey, [a, b]);
      continue;
    }

    // 1回戦(round<=1)は既定のsourceを持たない。この行はtargetとしてグラフに現れない
    // (誰も1回戦へ勝者を送らない)ので登録しない。
    if (row.round <= 1) continue;

    const rawA = defaultSourceOf(row.round, row.bracketPosition, 0)!;
    const rawB = defaultSourceOf(row.round, row.bracketPosition, 1)!;
    // 既定計算の座標に実際の行が存在しなければ「誰も来ない」(段階的不戦勝方式の
    // bye行、手動配置の空き枠隣接)。source不在エラーにはせず null として扱う。
    const a = byShapeKey.has(shapeKey(rawA.round, rawA.position)) ? rawA : null;
    const b = byShapeKey.has(shapeKey(rawB.round, rawB.position)) ? rawB : null;
    sourcesOfTarget.set(targetKey, [a, b]);
  }

  const targetOfSource = new Map<string, { round: number; position: number; sideIndex: number }>();

  for (const [targetKey, sources] of sourcesOfTarget) {
    const [roundStr, positionStr] = targetKey.split(":");
    const round = Number(roundStr);
    const position = Number(positionStr);

    for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
      const source = sources[sideIndex];
      if (!source) continue; // 「誰も来ない」側はグラフに辺を作らない
      const sourceKey = shapeKey(source.round, source.position);

      // 全単射崩壊: 同じsourceが複数のtargetから指されている。
      if (targetOfSource.has(sourceKey)) return { ok: false };

      targetOfSource.set(sourceKey, { round, position, sideIndex });
    }
  }

  // 孤児source検出: 実在する行(決勝でない。決勝は勝者辺を持たない)の勝者辺が
  // どのtargetにも向かっていない状態を検出する。順位決定戦ブロックの葉も同じ
  // 座標空間で `nextSlot()` がそのまま成立する(ブロックの決勝でなければ)ので対象に含む。
  for (const row of rows) {
    if (row.round >= roundCount) continue;
    const sourceKey = shapeKey(row.round, row.bracketPosition);
    if (!targetOfSource.has(sourceKey)) return { ok: false };
  }

  return { ok: true, graph: { sourcesOfTarget, targetOfSource } };
}

/** target座標(sideIndex込み)のフィーダーを1つ引く。`sourcesOfTarget` の薄いラッパ。 */
export function feederOf(
  graph: WinnerFeederGraph,
  round: number,
  position: number,
  sideIndex: number
): BracketSlot | null {
  const sources = graph.sourcesOfTarget.get(shapeKey(round, position));
  return sources ? sources[sideIndex] : null;
}

/** source座標の勝者が向かうtargetを引く。`targetOfSource` の薄いラッパ。 */
export function targetOf(
  graph: WinnerFeederGraph,
  round: number,
  position: number
): { round: number; position: number; sideIndex: number } | null {
  return graph.targetOfSource.get(shapeKey(round, position)) ?? null;
}

/**
 * 表示専用。座標既定(`nextSlot()`)と実際の勝者フローがずれている辺(=「接続の交換」で
 * 実効的に変わった辺)だけを列挙する。管理画面・公開ページの矢印可視化が使う。
 *
 * **正本は `buildWinnerFeederGraph()`。** 独自の緩い解釈は作らない — 書き込み側が
 * 不整合として拒否するデータに対して表示側だけ部分的な矢印を描くと「勝者辺の解釈は
 * このモジュールに閉じる」という不変条件に反する。失敗時は矢印を1本も出さない
 * (`{ ok: false, edges: [] }`。呼び出し側は矢印なしで表自体は描画を続けること)。
 *
 * 一度交換してから元へ戻した行は `changedAt` 保持のため `winnerFeeders` キー自体は
 * 残るが、解決値が既定と一致するので**ここでは矢印を返さない**(raw override の有無と
 * 実効差分は別物。バッジ/ドット/リセット導線は raw キーの有無で判定すること)。
 *
 * 辺の並びは座標で決定的に固定する(ポーリングのたびに矢印が並び替わらないように)。
 */
export type FeederFlowEdge = {
  from: BracketSlot;
  to: { round: number; position: number; sideIndex: number };
};

export type FeederFlowEdgesResult = { ok: true; edges: FeederFlowEdge[] } | { ok: false; edges: [] };

export function feederFlowEdges(rows: WinnerFeederRow[], roundCount: number): FeederFlowEdgesResult {
  const result = buildWinnerFeederGraph(rows, roundCount);
  if (!result.ok) return { ok: false, edges: [] };

  const edges: FeederFlowEdge[] = [];
  const targetKeys = [...result.graph.sourcesOfTarget.keys()].sort(compareShapeKey);

  for (const targetKey of targetKeys) {
    const [round, position] = targetKey.split(":").map(Number);
    const sources = result.graph.sourcesOfTarget.get(targetKey)!;

    for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
      const source = sources[sideIndex];
      if (!source) continue; // 「誰も来ない」側(bye行の空サイド)は矢印を作らない

      const def = defaultSourceOf(round, position, sideIndex);
      if (def && source.round === def.round && source.position === def.position) continue; // 既定と一致

      edges.push({ from: source, to: { round, position, sideIndex } });
    }
  }

  return { ok: true, edges };
}

function compareShapeKey(a: string, b: string): number {
  const [aRound, aPosition] = a.split(":").map(Number);
  const [bRound, bPosition] = b.split(":").map(Number);
  return aRound - bRound || aPosition - bPosition;
}
