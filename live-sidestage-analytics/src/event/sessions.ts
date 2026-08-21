// 開催日程(EventSession)の解決と検証。すべて純粋関数にしてテストで固定する。
//
// 1つのイベントは複数の日程に分かれうる(例: 1日目 22:00-23:00 予選 /
// 2日目 22:00-23:00 決勝)。**集計するのは日程の中だけで、日程の隙間は入らない。**
//
// `Event.startAt` / `endAt` は全日程を覆う外枠で、ここで計算した min/max を書き戻す。
// 期間を読む側は必ず `resolveEventWindows()` を通すこと — この機能より前に作られた
// イベントは日程を持たないので、外枠を1日程とみなすフォールバックがここにある。

import { parseJstLocal } from "./datetime";

/** 1イベントに設定できる日程の数。集計クエリが日程数に比例するので上限を課す。 */
export const MAX_EVENT_SESSIONS = 20;

/** 日程名の長さ。"準々決勝" 程度が入れば足りる。 */
export const MAX_SESSION_NAME_LENGTH = 40;

/**
 * 最初の日程の開始から最後の日程の終了までの上限(日)。
 * 無制限にすると集計対象と room 監視期限が青天井になる。
 */
export const MAX_EVENT_DAYS = 90;

export type EventWindow = { start: Date; end: Date; name: string | null };

export type SessionInput = { startAt: Date; endAt: Date; name?: string | null };
export type NormalizedSession = { startAt: Date; endAt: Date; name: string | null };

export type SessionValidation =
  | { ok: true; value: NormalizedSession[]; startAt: Date; endAt: Date }
  | { ok: false; errors: string[] };

/**
 * 集計・表示に使う日程の一覧を返す。**startAt 昇順**。
 *
 * 日程が1件も無いイベント(この機能より前に作られたもの)は、外枠 `[startAt, endAt)` を
 * 1日程として扱う。**期間を読む経路は必ずこれを通すこと。**
 */
export function resolveEventWindows(event: {
  startAt: Date;
  endAt: Date;
  sessions?: { startAt: Date; endAt: Date; name?: string | null }[] | null;
}): EventWindow[] {
  const sessions = event.sessions ?? [];
  if (sessions.length === 0) {
    return [{ start: event.startAt, end: event.endAt, name: null }];
  }
  return [...sessions]
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((s) => ({ start: s.startAt, end: s.endAt, name: s.name ?? null }));
}

/**
 * 入力された日程を検証して正規化する。startAt 昇順に並べ替えて返す。
 *
 * - 1件以上 `MAX_EVENT_SESSIONS` 件以下
 * - 各日程は `startAt < endAt`
 * - **日程どうしが重ならない**(重なると同じギフトを二重に数える)。
 *   終わりと次の始まりが同時刻なのは許す(半開区間なので重複しない)
 * - 全体の長さが `MAX_EVENT_DAYS` 以内
 */
export function normalizeSessionInputs(raw: SessionInput[]): SessionValidation {
  const errors: string[] = [];

  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, errors: ["開催日程を1つ以上入力してください。"] };
  }
  if (raw.length > MAX_EVENT_SESSIONS) {
    return { ok: false, errors: [`開催日程は${MAX_EVENT_SESSIONS}件までです。`] };
  }

  const sessions: NormalizedSession[] = [];
  for (const [index, entry] of raw.entries()) {
    const label = `${index + 1}つ目の日程`;
    const startAt = entry?.startAt;
    const endAt = entry?.endAt;

    if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
      errors.push(`${label}の開始日時の指定が不正です。`);
      continue;
    }
    if (!(endAt instanceof Date) || Number.isNaN(endAt.getTime())) {
      errors.push(`${label}の終了日時の指定が不正です。`);
      continue;
    }
    if (startAt >= endAt) {
      errors.push(`${label}は終了日時を開始日時より後にしてください。`);
      continue;
    }

    const name = (entry.name ?? "").trim();
    if (name.length > MAX_SESSION_NAME_LENGTH) {
      errors.push(`${label}の名前は${MAX_SESSION_NAME_LENGTH}文字以内で入力してください。`);
      continue;
    }

    sessions.push({ startAt, endAt, name: name || null });
  }

  if (errors.length > 0) return { ok: false, errors };

  sessions.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  for (let i = 1; i < sessions.length; i++) {
    if (sessions[i].startAt < sessions[i - 1].endAt) {
      errors.push("開催日程が重なっています。時間帯が重ならないようにしてください。");
      break;
    }
  }

  const startAt = sessions[0].startAt;
  const endAt = sessions.reduce(
    (max, s) => (s.endAt > max ? s.endAt : max),
    sessions[0].endAt
  );
  const days = (endAt.getTime() - startAt.getTime()) / 86_400_000;
  if (days > MAX_EVENT_DAYS) {
    errors.push(`最初の日程から最後の日程までは${MAX_EVENT_DAYS}日以内にしてください。`);
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value: sessions, startAt, endAt };
}

/**
 * リクエスト body の日程を `SessionInput[]` に直す。
 *
 * 日時は必ず `parseJstLocal()` を通す(サーバーのタイムゾーンに依存させない)。
 * `id` / `eventId` のようなクライアントが決めてよくない値は読まない。
 */
export function parseSessionRequest(
  raw: unknown
): { ok: true; value: SessionInput[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ["開催日程の指定が不正です。"] };
  }

  const errors: string[] = [];
  const value: SessionInput[] = [];

  for (const [index, entry] of raw.entries()) {
    const label = `${index + 1}つ目の日程`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${label}の指定が不正です。`);
      continue;
    }

    const row = entry as Record<string, unknown>;
    const startAt = typeof row.startAt === "string" ? parseJstLocal(row.startAt) : null;
    const endAt = typeof row.endAt === "string" ? parseJstLocal(row.endAt) : null;
    if (!startAt || !endAt) {
      errors.push(`${label}の開始日時と終了日時を入力してください。`);
      continue;
    }
    if (row.name != null && typeof row.name !== "string") {
      errors.push(`${label}の名前の指定が不正です。`);
      continue;
    }

    value.push({ startAt, endAt, name: typeof row.name === "string" ? row.name : null });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}

export type Span = { start: Date; end: Date };

/** `[start, end)` を完全に含む日程。どの日程にも収まらなければ null。 */
export function windowContaining(
  windows: EventWindow[],
  start: Date,
  end: Date
): EventWindow | null {
  return windows.find((w) => start >= w.start && end <= w.end) ?? null;
}

/**
 * `[start, end)` と日程の交差部分。日程をまたぐ区間は複数に割れる。
 *
 * 検知したバトルは日程の終わりをまたぐことがある(22:59 開始 → 23:04 終了)。
 * 対戦の勝敗も日程の中のギフトだけで決めるので、集計前にこれで切る。
 */
export function intersectWindows(span: Span, windows: EventWindow[]): Span[] {
  const out: Span[] = [];
  for (const w of windows) {
    const start = span.start > w.start ? span.start : w.start;
    const end = span.end < w.end ? span.end : w.end;
    if (start < end) out.push({ start, end });
  }
  return out;
}

/**
 * 日程を前後に `graceMs` 広げ、重なったものをつないで返す。
 *
 * バトルの取り込み範囲に使う。外枠1本で引くと、日程が疎に散っているイベント
 * (90日に週1など)で隙間のバトルまで毎回引いてしまう。
 */
export function expandAndMergeWindows(windows: EventWindow[], graceMs: number): Span[] {
  const expanded = windows
    .map((w) => ({
      start: new Date(w.start.getTime() - graceMs),
      end: new Date(w.end.getTime() + graceMs),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Span[] = [];
  for (const span of expanded) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      if (span.end > last.end) last.end = span.end;
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}
