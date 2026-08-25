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
  if (Number.isNaN(utcMs)) return null;

  // Date.UTC は実在しない日時を黙って繰り上げる("2026-02-31" → 3/3、"25:00" → 翌日1時)。
  // 入力した成分がそのまま復元できることを確認して弾く。
  const probe = new Date(utcMs);
  if (
    probe.getUTCFullYear() !== Number(year) ||
    probe.getUTCMonth() !== Number(month) - 1 ||
    probe.getUTCDate() !== Number(day) ||
    probe.getUTCHours() !== Number(hour) ||
    probe.getUTCMinutes() !== Number(minute)
  ) {
    return null;
  }

  const date = new Date(utcMs - JST_OFFSET_MINUTES * 60_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

const JST_PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** JST の年月日時分秒を2桁ゼロ埋めで取り出す。ロケール依存の区切り文字を持ち込まない。 */
function jstParts(date: Date) {
  const parts = JST_PARTS_FORMATTER.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // en-CA の hour は 24 時を "24" で返すことがある(hour12: false の既知の挙動)。
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * 秒まで出す JST 表示("2026/08/25 23:41:38")。
 *
 * クライアントコンポーネントで `toLocaleString()` を使うと、サーバー(Railway は UTC)と
 * ブラウザ(JST)で違う文字列になり React のハイドレーションが不一致になる。
 * 表示時刻はタイムゾーンを固定してこの関数を通すこと。
 */
export function formatJstStamp(date: Date): string {
  const p = jstParts(date);
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// <input type="datetime-local"> の初期値用に JST の "YYYY-MM-DDTHH:mm" を作る。
export function toJstInputValue(date: Date): string {
  const p = jstParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * 開催日程の1区間を表示する。同じ日に収まるなら終わりは時刻だけにする。
 * 例: "2026/09/01 22:00 〜 23:00" / "2026/09/01 22:00 〜 2026/09/02 01:00"
 */
export function formatJstRange(start: Date, end: Date): string {
  const s = jstParts(start);
  const e = jstParts(end);
  const head = `${s.year}/${s.month}/${s.day} ${s.hour}:${s.minute}`;
  const sameDay = s.year === e.year && s.month === e.month && s.day === e.day;
  return sameDay
    ? `${head} 〜 ${e.hour}:${e.minute}`
    : `${head} 〜 ${e.year}/${e.month}/${e.day} ${e.hour}:${e.minute}`;
}
