// イベント単位の advisory lock。集計と、結果を変える操作を直列化するために使う。
//
// 集計本体(aggregate.ts)と、集計をやり直させる側(reopen-aggregation.ts)の両方から
// 使うので、循環参照にならないよう独立したモジュールに置く。

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
