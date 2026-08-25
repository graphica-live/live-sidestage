import type { DbClient } from "./analytics-db";
import { nextSlot } from "./bracket";
import { isByeRow, isStartedMatch } from "./match-status";

/**
 * この枠の下流(次のラウンド以降)がすでに始まっているか。
 *
 * 結果を動かす操作(`[matchId]` の confirm / draw / void / reopen)と、組み合わせの
 * 入れ替え(`bracket-swap-apply.ts`)の**両方**がこれを使う。進行中の対戦の出場者が
 * 途中で入れ替わると、集計対象が変わって結果が壊れるため。
 *
 * 不戦勝行は自動通過にすぎないので、それ自体が FINISHED でも「進行が始まった」とは
 * 数えない。透過してさらに下流を見る(段階的不戦勝方式は不戦勝行が複数ラウンドに
 * わたることがある)。ラウンド数で有界なので無限ループにはならない。
 *
 * **最初に見つけた非不戦勝の下流で判定を打ち切る**(その先は見ない)。下流が未着手なのに
 * さらにその下流だけが手動確定済み、という順序逆転があると素通りするが、そのときは
 * `advanceBracket` が該当の枠を `blocked` にして書き換えを拒む。既存の `[matchId]` 操作と
 * 同じ挙動をそのまま共有している。
 */
export async function downstreamStarted(
  tx: DbClient,
  eventId: string,
  round: number,
  position: number
): Promise<boolean> {
  const agg = await tx.eventMatch.aggregate({
    where: { eventId },
    _max: { round: true },
  });
  const roundCount = agg._max.round ?? round;

  let cur = { round, position };
  for (let hop = 0; hop < roundCount; hop++) {
    const slot = nextSlot(cur.round, cur.position, roundCount);
    if (!slot) return false;

    const next = await tx.eventMatch.findFirst({
      where: { eventId, round: slot.round, bracketPosition: slot.position },
      select: { status: true, winnerDecidedBy: true, rules: true },
    });
    if (!next) return false;

    const nextIsBye = isByeRow(next.rules);
    if (nextIsBye) {
      cur = { round: slot.round, position: slot.position };
      continue;
    }
    return isStartedMatch({
      status: next.status,
      winnerDecidedBy: next.winnerDecidedBy,
      isBye: nextIsBye,
    });
  }
  return false;
}
