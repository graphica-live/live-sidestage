import type { DbClient } from "./analytics-db";
import { acquireEventLock } from "./event-lock";

/**
 * 集計をやり直させる。
 *
 * 集計ワーカーは `finalizedAt IS NULL` のイベントしか処理しない(締切後の最終集計が
 * 済んだら止まる)。**確定した結果を後から変えたときは、これを消して再集計させる。**
 * 消し忘れると、主催者が勝敗を覆しても順位・ライフに反映されない。
 *
 * 対戦の追加・削除・勝敗の変更・無効化と**同じトランザクションで**呼ぶこと。
 *
 * 先に集計と同じ advisory lock を取る。取らないと次の競合で変更が握り潰される:
 * 集計が古いデータを読み終えたあとに主催者の変更がコミットされ、集計が最後に
 * `finalizedAt` を立てると、変更を反映しないまま二度と再集計されなくなる。
 * ロックを取れば、集計中なら待たされてから `finalizedAt` を消せるし、
 * 先に取れば集計側の `pg_try_advisory_xact_lock` が外れて次の周回に回る。
 */
/**
 * `reopenAggregation()` を含むトランザクションに渡すオプション。
 *
 * 集計中はロック待ちで止まるので、Prisma 既定の5秒では足りない。
 * 集計の SLO は1イベント10秒なので、その倍を上限に取る。
 */
export const MUTATION_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

export async function reopenAggregation(tx: DbClient, eventId: string): Promise<void> {
  // トランザクションの先頭ですでに取っていれば、これは待たされない。
  await acquireEventLock(tx, eventId);
  await tx.event.updateMany({
    where: { id: eventId, finalizedAt: { not: null } },
    data: { finalizedAt: null },
  });
}
