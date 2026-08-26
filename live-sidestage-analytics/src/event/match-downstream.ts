import type { DbClient } from "./analytics-db";
import { isByeRow, isStartedMatch, parseLoserFrom } from "./match-status";
import { buildWinnerFeederGraph, targetOf, BracketInconsistentError } from "./winner-feeders";

/**
 * この枠の下流(次のラウンド以降)がすでに始まっているか。**`anyDownstreamStarted()` の
 * 起点1つぶんの薄いラッパー。** 複数の枠についてまとめて確かめたいときはそちらを
 * 直接使う(全件読み込みを共有できる)。
 *
 * 結果を動かす操作(`[matchId]` の confirm / draw / void / reopen)と、組み合わせの
 * 入れ替え(`bracket-swap-apply.ts`)の**両方**がこれを使う。進行中の対戦の出場者が
 * 途中で入れ替わると、集計対象が変わって結果が壊れるため。
 *
 * 下流の辺は2種類ある:
 *
 * - **勝者辺** — `nextSlot()` の座標。順位決定戦ブロックも本選と同じ座標空間にいるので、
 *   ブロック内の進行はこれで辿れる
 * - **敗者辺** — 順位決定戦の葉が持つ `rules.loserFrom`。座標からは導出できないので逆引きする。
 *   これを見ないと「準決勝を void したら、すでに始まっている3位決定戦の出場者が黙って
 *   入れ替わる」が起きる
 *
 * 不戦勝行は自動通過にすぎないので、それ自体が FINISHED でも「進行が始まった」とは
 * 数えない。透過してさらに下流を見る(段階的不戦勝方式は不戦勝行が複数ラウンドに
 * わたることがある)。訪問済み集合で有界なので無限ループにはならない。
 *
 * **対戦は1イベントぶんしかない**(100人でも99行＋順位決定戦)ので、ホップごとに引かず
 * 1回で読み切る。
 */
export async function downstreamStarted(
  tx: DbClient,
  eventId: string,
  round: number,
  position: number
): Promise<boolean> {
  return anyDownstreamStarted(tx, eventId, [{ round, position }]);
}

/**
 * 複数の起点について、**いずれか1つでも**下流がすでに始まっているか。
 *
 * `downstreamStarted()` と同じ判定を、**1回の全件読み込みでまとめて**行う。
 * `bracket-swap-apply.ts` は組み合わせ入れ替えで移動する行すべてについてこの判定が
 * 要るが、行ごとに `downstreamStarted()` を呼ぶと同じ全件スキャンを N 回繰り返す
 * (N+1 クエリ)。起点が複数でも対戦の総数は変わらないので、まとめて1回で済ませる。
 */
export async function anyDownstreamStarted(
  tx: DbClient,
  eventId: string,
  starts: { round: number; position: number }[]
): Promise<boolean> {
  if (starts.length === 0) return false;

  const all = await tx.eventMatch.findMany({
    where: { eventId },
    select: {
      round: true,
      bracketPosition: true,
      status: true,
      winnerDecidedBy: true,
      rules: true,
    },
  });
  if (all.length === 0) return false;

  const roundCount = Math.max(...all.map((m) => m.round));
  const bySlot = new Map(all.map((m) => [`${m.round}:${m.bracketPosition}`, m]));

  // 勝者辺の解決マップ。`downstreamStarted()` は `advanceBracket()` と同じグラフを見る
  // 必要がある — ずれると、override先の実際の受け側とは別の(座標既定の)行だけを見て
  // 誤ってブロック/素通りする(`winner-feeders.ts` 参照)。
  const feederGraph = buildWinnerFeederGraph(
    all.map((m) => ({ round: m.round, bracketPosition: m.bracketPosition, rules: m.rules })),
    roundCount
  );
  if (!feederGraph.ok) throw new BracketInconsistentError();
  const graph = feederGraph.graph;

  const loserEdges = new Map<string, string[]>();
  for (const match of all) {
    for (const slot of parseLoserFrom(match.rules) ?? []) {
      if (!slot) continue;
      const from = `${slot.round}:${slot.position}`;
      const to = `${match.round}:${match.bracketPosition}`;
      const list = loserEdges.get(from);
      if (list) list.push(to);
      else loserEdges.set(from, [to]);
    }
  }

  const downstreamOf = (r: number, p: number): string[] => {
    const keys: string[] = [];
    const slot = targetOf(graph, r, p);
    if (slot) keys.push(`${slot.round}:${slot.position}`);
    keys.push(...(loserEdges.get(`${r}:${p}`) ?? []));
    return keys;
  };

  // **不戦勝行は `rules.bye` だけでなく後方互換の `winnerDecidedBy === "BYE"` でも
  // 透過する。** `isStartedMatch()` はこの2つを同じ「不戦勝」として扱うので、BFS の
  // 透過条件もそれに揃えないと、`rules.bye` を持たない旧データの不戦勝行で探索が
  // 止まり、その先にいる進行中の対戦を見落とす。
  const isBye = (m: { rules: unknown; winnerDecidedBy: string | null }) =>
    isByeRow(m.rules) || m.winnerDecidedBy === "BYE";

  for (const start of starts) {
    const seen = new Set<string>();
    const queue: string[] = [];
    const push = (key: string) => {
      if (seen.has(key)) return;
      seen.add(key);
      queue.push(key);
    };

    // 起点そのものは下流ではない。起点から出る辺だけを積む。
    for (const key of downstreamOf(start.round, start.position)) push(key);

    while (queue.length > 0) {
      const next = bySlot.get(queue.shift()!);
      if (!next) continue;

      if (isBye(next)) {
        for (const key of downstreamOf(next.round, next.bracketPosition)) push(key);
        continue;
      }
      if (
        isStartedMatch({
          status: next.status,
          winnerDecidedBy: next.winnerDecidedBy,
          isBye: false,
        })
      ) {
        return true;
      }
    }
  }

  return false;
}
