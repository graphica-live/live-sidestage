import { normalizeTiktokId } from "@/lib/tiktok-room";

// 1リクエストで集計できる期間の上限。年間実績を1回で取れるよう366日(うるう年ぶん)にしてある。
// Giftは @@index([roomId, dayKey]) に乗るが、無制限の期間を許すと監視対象ぶんの
// フルスキャンを誘発するため上限自体は残す。
// 呼び出し頻度の制限(レート制限)は未実装なので、この上限が1リクエストあたりの負荷の唯一の歯止め。
export const MAX_RANGE_DAYS = 366;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

// TikTokのユーザー名として成立する形だけを受け付ける(英数字・アンダースコア・ドット、2〜24文字)。
// normalizeTiktokId()はtrim/@除去/小文字化しかしないため、"@"だけ・URL・空白入りの文字列でも
// TiktokRoomが作られてしまう。そうした部屋はWorkerが永久に再接続を試み続けるので、
// 監視対象の追加時点で弾く。
const TIKTOK_ID_PATTERN = /^[a-z0-9._]{2,24}$/;

export function isValidNormalizedTiktokId(normalized: string): boolean {
  return TIKTOK_ID_PATTERN.test(normalized);
}

// "YYYY-MM-DD" を厳密に検証する。パターン一致だけだと 2026-02-31 のような
// 存在しない日付が通ってしまうため、Dateへ変換して元の文字列に戻るかまで確認する。
function isValidDayKey(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

function daysBetweenInclusive(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

export type DateRange = { from: string; to: string };

export function parseDateRange(
  rawFrom: string | null,
  rawTo: string | null
): ParseResult<DateRange> {
  const from = rawFrom?.trim() ?? "";
  const to = rawTo?.trim() ?? "";

  if (!from || !to) {
    return { ok: false, error: "fromとtoは必須です(YYYY-MM-DD形式)。" };
  }
  if (!isValidDayKey(from) || !isValidDayKey(to)) {
    return { ok: false, error: "fromとtoはYYYY-MM-DD形式の実在する日付で指定してください。" };
  }
  if (from > to) {
    return { ok: false, error: "fromはto以前の日付で指定してください。" };
  }

  const days = daysBetweenInclusive(from, to);
  if (days > MAX_RANGE_DAYS) {
    return { ok: false, error: `期間は最大${MAX_RANGE_DAYS}日までです(指定: ${days}日)。` };
  }

  return { ok: true, value: { from, to } };
}

// カンマ区切りのtiktokIdsを正規化して重複を除く。
//
// パラメータ自体が無い場合だけ「全監視対象」を意味するnullを返す。`tiktokIds=` のように
// 明示されていて中身が空のときは400にする — 呼び出し側の変数が空だっただけのつもりが
// 全監視対象の取得にすり替わる(スコープの意図しない拡大)のを防ぐため。
export function parseTiktokIdsParam(raw: string | null): ParseResult<string[] | null> {
  if (raw === null) return { ok: true, value: null };

  // 不正な形のIDもここでは落とさない。監視対象は追加時に検証済みなので必ずマッチせず、
  // selectWatchedRooms() が unknownTiktokIds に入れて呼び出し元へ知らせる。
  const normalized = raw
    .split(",")
    .map((v) => normalizeTiktokId(v))
    .filter((v) => v.length > 0);

  if (normalized.length === 0) {
    return {
      ok: false,
      error: "tiktokIdsが空です。全監視対象を集計する場合はパラメータ自体を省略してください。",
    };
  }

  return { ok: true, value: Array.from(new Set(normalized)) };
}

export type WatchedRoom = { roomId: string; normalizedTiktokId: string };

export type TiktokIdSelection<T extends WatchedRoom> = {
  selected: T[];
  unknownTiktokIds: string[];
};

// リクエストされたtiktokIdsを、その事務所の監視対象だけに絞り込む。
// 監視対象に無いIDは unknownTiktokIds として隔離し、他事務所のデータは決して返さない。
// requested が null(未指定)なら監視対象全件を返す。
export function selectWatchedRooms<T extends WatchedRoom>(
  watched: T[],
  requested: string[] | null
): TiktokIdSelection<T> {
  if (requested === null) {
    return { selected: watched, unknownTiktokIds: [] };
  }

  const byTiktokId = new Map(watched.map((w) => [w.normalizedTiktokId, w]));
  const selected: T[] = [];
  const unknownTiktokIds: string[] = [];

  for (const id of requested) {
    const hit = byTiktokId.get(id);
    if (hit) selected.push(hit);
    else unknownTiktokIds.push(id);
  }

  return { selected, unknownTiktokIds };
}
