// mobile/analytics/* の4エンドポイント共通のクエリパラメータ検証。
// Web版(analytics/page.tsx)はブラウザ側で組み立てた値をそのまま投げてくる前提だが、
// モバイルAPIは外部からの直接呼び出しもあり得るため、ここで明示的にバリデーションする。

import { NextResponse } from "next/server";

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
