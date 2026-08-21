// イベントの日時はすべて JST(Asia/Tokyo)基準で扱う。
//
// 注意: サーバーのタイムゾーンに依存する `new Date("2026-09-01T20:00")` は使わない。
// Railway のコンテナは UTC なので、ブラウザで入力した「20:00」がそのまま UTC 20:00 として
// 保存され、9時間ずれる。入力のパースは必ず parseJstLocal を通すこと。

const JST_OFFSET_MINUTES = 9 * 60;

const JST_DISPLAY_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatJst(date: Date): string {
  return JST_DISPLAY_FORMATTER.format(date);
}

// <input type="datetime-local"> が返す "YYYY-MM-DDTHH:mm" を JST として解釈する。
export function parseJstLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;

  const [, year, month, day, hour, minute] = m;
  const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const date = new Date(utcMs - JST_OFFSET_MINUTES * 60_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

// <input type="datetime-local"> の初期値用に JST の "YYYY-MM-DDTHH:mm" を作る。
export function toJstInputValue(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // en-CA の hour は 24 時を "24" で返すことがある(hour12: false の既知の挙動)。
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}
