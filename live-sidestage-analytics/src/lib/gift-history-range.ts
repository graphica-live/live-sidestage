// ギフト履歴(明細一覧)APIの参照期間クランプ。
//
// 明細(Gift)は受信後90日で削除される(gift-retention.ts)。ロールアップは日次・送信者単位の
// 集計なのでギフト単位の明細を復元できず、90日より前を指定できるままだと「エラーも出ないのに
// 0件」になる。**終端を基準に90日ぶんへ切り詰め、実際に参照した範囲をレスポンスの
// `dateRange` として返す**(黙って短くしただけだとクライアント側の表示と食い違う)。

import { GIFT_HISTORY_MAX_RANGE_DAYS } from "@/lib/range-limits";
import { shiftDayKey } from "@/lib/overlay/day-key";

const MS_PER_DAY = 86_400_000;

/** dayKey(YYYY-MM-DD、両端含む)の範囲を90日へ切り詰める。 */
export function clampGiftHistoryDayRange(range: { start: string; end: string }): {
  start: string;
  end: string;
  clamped: boolean;
} {
  const minStart = shiftDayKey(range.end, -(GIFT_HISTORY_MAX_RANGE_DAYS - 1));
  if (range.start >= minStart) return { ...range, clamped: false };
  return { start: minStart, end: range.end, clamped: true };
}

/** 時刻付き(startDatetime/endDatetime)の範囲を90日へ切り詰める。 */
export function clampGiftHistoryDatetimeRange(range: { start: Date; end: Date }): {
  start: Date;
  end: Date;
  clamped: boolean;
} {
  const minStart = new Date(range.end.getTime() - GIFT_HISTORY_MAX_RANGE_DAYS * MS_PER_DAY);
  if (range.start.getTime() >= minStart.getTime()) return { ...range, clamped: false };
  return { start: minStart, end: range.end, clamped: true };
}
