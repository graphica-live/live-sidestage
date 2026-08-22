// イベント単位の advisory lock。集計と、結果を変える操作を直列化するために使う。
//
// 集計本体(aggregate.ts)と、集計をやり直させる側(reopen-aggregation.ts)の両方から
// 使うので、循環参照にならないよう独立したモジュールに置く。

import type { DbClient } from "./analytics-db";

/**
 * イベントIDから advisory lock のキーを作る(FNV-1a 64bit)。
 *
 * Postgres の bigint は符号付きなので範囲へ落とす。ハッシュが衝突しても、
 * 別イベントの集計が一巡待たされるだけで結果は壊れない。
 */
export function advisoryLockKey(eventId: string): bigint {
  const MASK = (1n << 64n) - 1n;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < eventId.length; i++) {
    hash = ((hash ^ BigInt(eventId.charCodeAt(i))) * 0x100000001b3n) & MASK;
  }
  return hash >= 1n << 63n ? hash - (1n << 64n) : hash;
}

/**
 * イベントのロックを取る(取れるまで待つ)。トランザクション終了で自動的に解放される。
 *
 * **イベントの状態を読んで検証し、それに基づいて書き込む操作は、トランザクションの
 * 先頭でこれを呼ぶこと。** 読んだ後にロックを取ると、その間に開催日程が変わっても
 * 古い日程で通した検証結果がそのままコミットされてしまう
 * (対戦枠が日程の外に取り残される)。
 *
 * 同じトランザクションで二重に取っても待たされない(`reopenAggregation` は
 * 末尾でもう一度取るが no-op になる)。
 */
export async function acquireEventLock(tx: DbClient, eventId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(eventId)}::bigint)`;
}
