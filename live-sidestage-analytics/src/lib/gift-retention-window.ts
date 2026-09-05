// ギフト明細(Gift)の90日retentionと、日次ロールアップ(GiftDailyListenerStat)を
// 読み書きする側で共有する境界計算。
//
// 依存は prisma と day-key だけに保つ(gift-analytics.ts / agency/summary.ts /
// gift-retention.ts の3方向から読まれる)。

import { prisma } from "@/lib/prisma";
import { jstDateKey, shiftDayKey } from "@/lib/overlay/day-key";

/** 明細の保持日数。`dayKey < jstDateKey(-90)` の Gift が削除対象。 */
export const GIFT_RETENTION_DAYS = 90;

/**
 * 読み出し側がロールアップへ切り替える日数。
 *
 * **「当日/当日より前」で分けない。** ロールアップは日次バッチ後にしか揃わないので、
 * 日付が変わってから cron が走るまでの間「昨日」がどちらのテーブルにも完全な形で無くなり、
 * 週次・月次ランキングからその日の貢献が丸ごと落ちる。保持カットオフ(90日)より十分手前の
 * 固定日数で切ることで、day/week/month・monthly-contributors・overlay・mobileランキングは
 * 通常運用時に**現行と完全に同じクエリ**のまま(挙動変更ゼロ)になる。
 */
export const GIFT_ROLLUP_READ_CUTOFF_DAYS = 80;

/** ロールアップ済みの上限 dayKey。この日までは GiftDailyListenerStat が完全。 */
export const ROLLUP_WATERMARK_KEY = "gift_rollup_watermark_daykey";

/**
 * 削除を実行済みの上限 dayKey。この日以前の Gift は(イベント保護ぶんを除き)もう無い。
 *
 * ロールアップの再計算対象をこの日より後に限定するために要る。単純に `watermark-2日` から
 * 再upsertすると、既に一部行が削除済みの日・イベント保護で一部だけ残った日を過少値で
 * 上書きしてしまう。
 */
export const RETENTION_DELETED_THROUGH_KEY = "gift_retention_deleted_through_daykey";

/** どの実 dayKey よりも小さい番兵。「ロールアップがまだ1日も無い」を表す。 */
export const MIN_DAY_KEY = "0000-00-00";

/** Date を JST の dayKey へ落とす(Gift.dayKey と同じ規則)。 */
export function dayKeyOf(date: Date): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export async function readDayKeySetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  const value = row?.value?.trim();
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * 読み出しの分割境界。**この dayKey 以降は Gift、より前は GiftDailyListenerStat を読む。**
 *
 * `min(80日前, watermark + 1日)` にしてあるのは、cronが10日超停滞したときに
 * 「80日境界とwatermarkの間＝ロールアップ未生成だがまだGiftは残っている」空白が生じるため。
 * この空白をロールアップ側で読むと欠落するので、境界を watermark 側へ引き戻して Gift を読ませる。
 *
 * watermark が未設定(バックフィル前)なら常に Gift だけを読む。
 */
export async function resolveRollupReadCutoff(now: Date = new Date()): Promise<string> {
  const byRetention = shiftDayKey(dayKeyOf(now), -GIFT_ROLLUP_READ_CUTOFF_DAYS);
  const watermark = await readDayKeySetting(ROLLUP_WATERMARK_KEY);
  if (!watermark) return MIN_DAY_KEY;
  const byWatermark = shiftDayKey(watermark, 1);
  return byWatermark < byRetention ? byWatermark : byRetention;
}

/**
 * 分割境界より新しい範囲しか要求していないかを、**DBを読まずに**判定する。
 *
 * カットオフは常に `80日前` 以下なので、範囲の下限が 80日前 以上ならロールアップは要らない。
 * 通常運用のほぼ全てのリクエスト(day/week/month/当月MVP)がここで抜ける。
 */
export function isWithinRawGiftWindow(lowerDayKey: string | null, now: Date = new Date()): boolean {
  if (lowerDayKey === null) return false;
  return lowerDayKey >= shiftDayKey(dayKeyOf(now), -GIFT_ROLLUP_READ_CUTOFF_DAYS);
}

export { jstDateKey, shiftDayKey };
