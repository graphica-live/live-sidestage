import type { DbClient } from "./analytics-db";
import { acquireEventLock } from "./event-lock";
import { AGGREGATE_GRACE_MS } from "./aggregate-deadline";

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

/**
 * トランザクションがロック待ちで打ち切られたか(Prisma の `P2028`)。
 *
 * 集計は最大120秒のトランザクション(`aggregate.ts`)で同じ advisory lock を握るので、
 * その最中に主催者が結果を触ると上の30秒では待ちきれないことがある。
 * **500 にせず 503 で「あとでやり直す」と返すため**に判別する。
 *
 * `lock_timeout` は入れていない — 全マッチ操作の挙動が変わるうえ、待たされること自体は
 * 正しい(集計と直列化されている)。ここで変えるのは失敗の伝え方だけ。
 */
export function isTransactionTimeout(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "P2028") return true;
  const message = (err as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /transaction (already closed|api error)|unable to start a transaction/i.test(message)
  );
}

/**
 * 「終了から1週間(`AGGREGATE_GRACE_MS`)を過ぎたので、もう結果を訂正できない」。
 *
 * **呼び出し元のトランザクション全体をロールバックさせるために例外にしてある**
 * (no-op にすると、対戦の追加・VOID などのミューテーションだけが成功して順位に
 * 反映されない不整合が残る)。API 層は 409 として主催者へ返すこと。
 */
export const AGGREGATION_DEADLINE_PASSED_CODE = "AGGREGATION_DEADLINE_PASSED";

export const AGGREGATION_DEADLINE_PASSED_MESSAGE =
  "イベント終了から1週間を過ぎたため、結果は確定済みで変更できません。";

export class AggregationDeadlinePassedError extends Error {
  readonly code = AGGREGATION_DEADLINE_PASSED_CODE;

  constructor(message = AGGREGATION_DEADLINE_PASSED_MESSAGE) {
    super(message);
    this.name = "AggregationDeadlinePassedError";
  }
}

export function isAggregationDeadlinePassed(err: unknown): err is AggregationDeadlinePassedError {
  return err instanceof AggregationDeadlinePassedError;
}

/**
 * 締切を過ぎているか。`endAt + AGGREGATE_GRACE_MS` が期限。
 */
export function isPastAggregationDeadline(endAt: Date, now: Date): boolean {
  return now.getTime() > endAt.getTime() + AGGREGATE_GRACE_MS;
}

export async function reopenAggregation(
  tx: DbClient,
  eventId: string,
  options: { now?: Date } = {}
): Promise<void> {
  // トランザクションの先頭ですでに取っていれば、これは待たされない。
  await acquireEventLock(tx, eventId);

  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { endAt: true, finalizedAt: true },
  });
  // 存在しないイベントは従来どおり no-op(呼び出し元が 404 を返す)。
  if (!event) return;

  // **まだ確定していないなら締切を見ない。** 戻すべき `finalizedAt` が無い以上
  // 「確定済みの結果を覆す」操作ではなく、締切前後で意味が変わらない。
  // ここを見ないと、締切を過ぎた未確定イベント(集計が一度も成功していない等)への
  // 通常のミューテーションまで巻き添えで失敗する。
  if (event.finalizedAt === null) return;

  // 締切超過後は `finalizedAt` を戻さない。ギフト明細は90日で削除される
  // (gift-retention.ts)ので、確定済みイベントの再集計は元データを欠いたまま
  // 走ることになり、静かに順位が壊れる。訂正はサポート対象外(設計判断)。
  if (isPastAggregationDeadline(event.endAt, options.now ?? new Date())) {
    throw new AggregationDeadlinePassedError();
  }

  await tx.event.updateMany({
    where: { id: eventId, finalizedAt: { not: null } },
    data: { finalizedAt: null },
  });
}
