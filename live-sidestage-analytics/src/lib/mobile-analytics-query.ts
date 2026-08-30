// mobile/analytics/* の4エンドポイント共通のクエリパラメータ検証。
// Web版(analytics/page.tsx)はブラウザ側で組み立てた値をそのまま投げてくる前提だが、
// モバイルAPIは外部からの直接呼び出しもあり得るため、ここで明示的にバリデーションする。

import { NextResponse } from "next/server";
import { MAX_RANGE_DAYS } from "@/lib/range-limits";

const PERIODS = ["day", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];

function isValidDateString(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  // "2026-02-30" のような存在しない日付をUTC epochへの変換ロールオーバーで弾く。
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(mo) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

export type PeriodQuery = { period: Period; date: string };

export function parsePeriodQuery(
  searchParams: URLSearchParams,
  defaultDate: string
): { ok: true; value: PeriodQuery } | { ok: false; response: NextResponse } {
  const periodRaw = searchParams.get("period") ?? "day";
  if (!(PERIODS as readonly string[]).includes(periodRaw)) {
    return { ok: false, response: NextResponse.json({ error: "period が不正です" }, { status: 400 }) };
  }

  const date = searchParams.get("date") ?? defaultDate;
  if (!isValidDateString(date)) {
    return { ok: false, response: NextResponse.json({ error: "date が不正です" }, { status: 400 }) };
  }

  return { ok: true, value: { period: periodRaw as Period, date } };
}

// "YYYY-MM-DDTHH:mm:ss(.sss)?(Z|±HH:MM)" を厳密に検証する。オフセット省略は許可しない
// (曖昧な"ローカル時刻"での解釈を避けるため、呼び出し側には常に明示的なUTC/オフセット付き
// 文字列を要求する)。
const ISO_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

// 月(1-12)の実日数。Date.UTC(year, month, 0) は「month(0始まり)月の0日目」= 前月の末日を返す
// ため、1始まりの月番号をそのまま渡すと欲しい月の末日が取れる(うるう年もDate.UTCが解決する)。
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// 正規表現でのフォーマット一致だけでなく、年月日・時刻・オフセットの各成分を実在範囲まで
// 検証する。"2026-02-30T00:00:00Z" のような存在しない日付はJSのDateが3月へ自動繰り上げて
// しまうため、isNaNチェックだけでは通ってしまう(agency/params.tsのisValidDayKeyと同じ考え方
// を時刻・オフセット成分まで拡張したもの)。
function isValidIsoDateTime(value: string): { valid: false } | { valid: true; date: Date } {
  const m = ISO_DATETIME_PATTERN.exec(value);
  if (!m) return { valid: false };
  const [, yStr, moStr, dStr, hStr, miStr, sStr, offset] = m;
  const year = Number(yStr);
  const month = Number(moStr);
  const day = Number(dStr);
  const hour = Number(hStr);
  const minute = Number(miStr);
  const second = Number(sStr);

  if (month < 1 || month > 12) return { valid: false };
  if (day < 1 || day > daysInMonth(year, month)) return { valid: false };
  if (hour > 23) return { valid: false };
  if (minute > 59) return { valid: false };
  if (second > 59) return { valid: false };

  if (offset !== "Z") {
    const om = /^[+-](\d{2}):(\d{2})$/.exec(offset);
    if (!om) return { valid: false };
    const [, ohStr, omiStr] = om;
    if (Number(omiStr) > 59) return { valid: false };
    const totalOffsetMinutes = Number(ohStr) * 60 + Number(omiStr);
    if (totalOffsetMinutes > 14 * 60) return { valid: false };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { valid: false };
  return { valid: true, date };
}

const MS_PER_DAY = 86_400_000;

export type RangeQuery =
  | { mode: "period"; period: Period; date: string }
  | { mode: "custom"; start: Date; end: Date };

// 開始・終了日時(startDatetime/endDatetime)による絞り込み。どちらも未指定なら既存の
// parsePeriodQuery に委譲する(完全後方互換)。片方だけの指定は拒否する。
export function parseRangeQuery(
  searchParams: URLSearchParams,
  defaultDate: string
): { ok: true; value: RangeQuery } | { ok: false; response: NextResponse } {
  const startRaw = searchParams.get("startDatetime");
  const endRaw = searchParams.get("endDatetime");

  if (startRaw === null && endRaw === null) {
    const periodResult = parsePeriodQuery(searchParams, defaultDate);
    if (!periodResult.ok) return periodResult;
    return { ok: true, value: { mode: "period", ...periodResult.value } };
  }

  if (startRaw === null || endRaw === null) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "startDatetimeとendDatetimeは両方指定してください" },
        { status: 400 }
      ),
    };
  }

  const startParsed = isValidIsoDateTime(startRaw);
  const endParsed = isValidIsoDateTime(endRaw);
  if (!startParsed.valid || !endParsed.valid) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "startDatetimeとendDatetimeはISO 8601形式(オフセット必須)の実在する日時で指定してください" },
        { status: 400 }
      ),
    };
  }

  const start = startParsed.date;
  const end = endParsed.date;

  // 等しい場合も拒否する。許すと receivedAt<=end のGift系では1件ヒットし得る一方、
  // startedAt<end のBattleは必ず0件になり、境界の非対称性がより表面化するため。
  if (start.getTime() >= end.getTime()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "startDatetimeはendDatetimeより前の日時で指定してください" },
        { status: 400 }
      ),
    };
  }

  const maxElapsedMs = MAX_RANGE_DAYS * MS_PER_DAY;
  if (end.getTime() - start.getTime() > maxElapsedMs) {
    return {
      ok: false,
      response: NextResponse.json({ error: `期間は最大${MAX_RANGE_DAYS}日までです` }, { status: 400 }),
    };
  }

  return { ok: true, value: { mode: "custom", start, end } };
}

export function parseLimit(
  searchParams: URLSearchParams,
  defaultValue: number,
  max: number
): { ok: true; value: number } | { ok: false; response: NextResponse } {
  const raw = searchParams.get("limit");
  if (raw === null) return { ok: true, value: defaultValue };

  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    return { ok: false, response: NextResponse.json({ error: "limit が不正です" }, { status: 400 }) };
  }
  return { ok: true, value: n };
}
