// 集計の締切だけを持つ最小モジュール。
//
// `aggregate.ts` は Prisma・スコアリング・ライフ計算まで引き込む重いモジュールなので、
// `reopen-aggregation.ts`(主催者ミューテーションの全経路が import する)からは
// この定数だけを切り出して読む。`aggregate.ts` は後方互換のため再exportする。

/**
 * イベント終了後もこの時間だけ集計を続ける(終了間際のギフトの取りこぼし対策)。
 *
 * **同時にこれが「結果を訂正できる期限」でもある。** 締切を過ぎて最終集計が済むと
 * `Event.finalizedAt` が立ち、`reopenAggregation()` はもう受け付けない
 * (`reopen-aggregation.ts` の締切ガード)。ギフト明細は90日で削除される
 * (gift-retention.ts)ので、未確定イベントの期間だけを削除から保護すれば足りる、
 * という保証がこの一方向性から来ている。
 */
export const AGGREGATE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** 締切。これを過ぎてからの集計が最終集計になる。 */
export function aggregationDeadline(endAt: Date): Date {
  return new Date(endAt.getTime() + AGGREGATE_GRACE_MS);
}
