// 貢献ランキング(期間集計)の公開シェアリンク。BattleHistory方式(既存行にトークン列を生やす)と
// 違い「特定のレコード」ではなく「期間の定義」(period+date、またはcustom range)を指すため、
// 専用モデル ContributionShareToken を1テーブルだけで扱う。
//
// **公開payloadの安全境界はこのファイルが最後の砦。** queryGifts が返す GiftAnalyticsUser を
// そのまま返さず、公開用の型へマップし直す。verified は所有者向けの「未検証データ」表示制御
// であり第三者の閲覧に意味が無いため除外するが、tiktokUid/tiktokHandle は
// 所有者向けランキング(RankingRow)と同じくプロフィールリンク・ギフト内訳アコーディオンの
// キーとして必要なため公開する(ユーザー指示: 2026-09-11)。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDateRange, queryGifts } from "@/lib/gift-analytics";
import { queryGiftBreakdown, type GiftBreakdownResult } from "@/lib/gift-breakdown";
import { resolveTikTokUserDisplay } from "@/lib/tiktok-user";
import { resolveAvatarUrls } from "@/lib/avatar-storage";
import { generateShareToken } from "@/lib/share-token";
import { MAX_RANGE_DAYS } from "@/lib/range-limits";
import { GIFT_RETENTION_DAYS } from "@/lib/gift-retention-window";

const MS_PER_DAY = 86_400_000;

const VALID_PERIODS = ["day", "week", "month", "year", "custom"] as const;
type SharePeriod = (typeof VALID_PERIODS)[number];

/**
 * `buildRangeKey` に渡す正規化済み入力。期間定義そのものを表す(custom時は date=null、
 * それ以外は startDatetime/endDatetime=null)。
 */
export type ShareRangeInput =
  | { period: Exclude<SharePeriod, "custom">; date: string; startDatetime: null; endDatetime: null }
  | { period: "custom"; date: null; startDatetime: string; endDatetime: string };

/** "YYYY-MM-DD" が実在する暦日かを検証する(mobile-analytics-query.ts の isValidDateString と同じ考え方)。 */
function isValidDateOnly(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(mo) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

/** ISO 8601 の日時文字列だけを受け付ける(日付のみの文字列は拒否。曖昧な解釈を避けるため "T" を必須にする)。 */
function parseIsoDatetime(value: string): Date | null {
  if (!value.includes("T")) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export type ShareValidationResult =
  | { ok: true; value: ShareRangeInput }
  | { ok: false; error: string };

/**
 * 3つの発行route(自配信者用・admin用・mobile用)が共通で使う入力検証。
 * POSTボディの `period` は列挙値のみ許可し、`custom` 時は `startDatetime`/`endDatetime` が
 * 有効なISO日時かつ `start <= end`(等しい場合も拒否)であること、および経過期間・過去への
 * 遡り幅がともに `MAX_RANGE_DAYS`(366日)以内であることを検証する。不正入力は呼び出し側で400に変換する。
 */
export function validateShareRequestBody(body: unknown): ShareValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "リクエストボディが不正です" };
  }
  const raw = body as Record<string, unknown>;
  const period = raw.period;
  if (typeof period !== "string" || !(VALID_PERIODS as readonly string[]).includes(period)) {
    return { ok: false, error: "period が不正です" };
  }
  const typedPeriod = period as SharePeriod;

  if (typedPeriod === "custom") {
    const startRaw = raw.startDatetime;
    const endRaw = raw.endDatetime;
    if (typeof startRaw !== "string" || typeof endRaw !== "string") {
      return { ok: false, error: "startDatetimeとendDatetimeを指定してください" };
    }
    const start = parseIsoDatetime(startRaw);
    const end = parseIsoDatetime(endRaw);
    if (!start || !end) {
      return {
        ok: false,
        error: "startDatetimeとendDatetimeはISO 8601形式の実在する日時で指定してください",
      };
    }
    if (start.getTime() >= end.getTime()) {
      return { ok: false, error: "startDatetimeはendDatetimeより前の日時で指定してください" };
    }
    const maxElapsedMs = MAX_RANGE_DAYS * MS_PER_DAY;
    if (end.getTime() - start.getTime() > maxElapsedMs) {
      return { ok: false, error: `期間は最大${MAX_RANGE_DAYS}日までです` };
    }
    const oldestAllowedMs = Date.now() - maxElapsedMs;
    if (start.getTime() < oldestAllowedMs) {
      return { ok: false, error: "指定できるのは過去1年分までです" };
    }
    return {
      ok: true,
      value: { period: "custom", date: null, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
    };
  }

  const date = raw.date;
  if (typeof date !== "string" || !isValidDateOnly(date)) {
    return { ok: false, error: "date が不正です" };
  }
  return { ok: true, value: { period: typedPeriod, date, startDatetime: null, endDatetime: null } };
}

/**
 * 期間定義の冪等キーを作るpure関数。UTCのISO 8601(ミリ秒まで、`Z`終端)に正規化してから
 * 文字列化する。mobile側 `contribution_tab.dart` の `_rangeSignature()`、web側
 * `AnalyticsView.tsx` の `rangeKey` メモと同じ考え方(ただし正規化自体はサーバー側のこの1箇所のみ)。
 */
export function buildRangeKey(
  period: string,
  date: string | null,
  startDatetime: string | Date | null,
  endDatetime: string | Date | null
): string {
  if (period === "custom") {
    if (startDatetime === null || endDatetime === null) {
      throw new Error("custom period requires startDatetime and endDatetime");
    }
    const start = typeof startDatetime === "string" ? new Date(startDatetime) : startDatetime;
    const end = typeof endDatetime === "string" ? new Date(endDatetime) : endDatetime;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("invalid startDatetime/endDatetime");
    }
    return `custom|${start.toISOString()}|${end.toISOString()}`;
  }

  if (date === null) throw new Error("non-custom period requires date");
  const normalized = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(normalized.getTime())) throw new Error("invalid date");
  return `${period}|${normalized.toISOString().slice(0, 10)}`;
}

/**
 * トークンを遅延発行する。既に同一room×同一rangeKeyのトークンがあれば再利用する
 * (`ensureShareToken`/`ensureOverlayToken` と同じ「未発行のときだけ書く」形)。
 * 競合(2重POST)は一意制約違反(P2002)を再`findFirst`で吸収する。
 */
export async function ensureContributionShareToken(
  roomId: string,
  input: ShareRangeInput
): Promise<string> {
  const rangeKey = buildRangeKey(input.period, input.date, input.startDatetime, input.endDatetime);

  const existing = await prisma.contributionShareToken.findFirst({
    where: { roomId, rangeKey },
    select: { token: true },
  });
  if (existing !== null) return existing.token;

  const token = generateShareToken();
  try {
    const created = await prisma.contributionShareToken.create({
      data: {
        roomId,
        token,
        period: input.period,
        date: input.date,
        startDatetime: input.startDatetime ? new Date(input.startDatetime) : null,
        endDatetime: input.endDatetime ? new Date(input.endDatetime) : null,
        rangeKey,
      },
      select: { token: true },
    });
    return created.token;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const reread = await prisma.contributionShareToken.findFirst({
        where: { roomId, rangeKey },
        select: { token: true },
      });
      if (reread !== null) return reread.token;
    }
    throw err;
  }
}

/** 公開ページに載せる貢献者1人分。verifiedは含まない(所有者向け表示制御のため無意味)。 */
export type PublicContributionUser = {
  tiktokUid: string;
  tiktokHandle: string | null;
  nickname: string | null;
  profileImageUrl: string | null;
  giftCount: number;
  totalDiamonds: number;
  lastGiftAt: string;
};

export type PublicContributionPayload = {
  period: string;
  date: string | null;
  startDatetime: string | null;
  endDatetime: string | null;
  dateRange: { start: string; end: string };
  users: PublicContributionUser[];
  total: { giftCount: number; totalDiamonds: number };
  /** 誰の集計かを示すための配信者情報。tiktokHandle/tiktokUidは含めない。 */
  streamer: { nickname: string | null; profileImageUrl: string | null };
};

export type ContributionRankingQueryResult =
  | { ok: true; payload: PublicContributionPayload }
  | { ok: false };

export type ResolvedContributionShareRange = {
  roomId: string;
  period: string;
  date: string | null;
  startDatetime: Date | null;
  endDatetime: Date | null;
  where: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } };
  dateRange: { start: string; end: string };
};

/**
 * トークンから「どのroomの、どの期間を集計するか」を解決する。ランキング本体
 * (`queryContributionRankingByShareToken`)と公開版ギフト内訳(`queryContributionBreakdownByShareToken`)
 * の両方が同じ期間解決ロジックを必要とするため共通化している。
 */
export async function resolveContributionShareRange(
  token: string
): Promise<{ ok: true; value: ResolvedContributionShareRange } | { ok: false }> {
  const row = await prisma.contributionShareToken.findUnique({
    where: { token },
    select: { roomId: true, period: true, date: true, startDatetime: true, endDatetime: true },
  });
  if (row === null) return { ok: false };

  let where: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } };
  let dateRange: { start: string; end: string };

  if (row.period === "custom") {
    if (row.startDatetime === null || row.endDatetime === null) return { ok: false };
    // 保持期間(90日)より古い部分は queryGifts が日次ロールアップ(dayKey粒度)へ切り替えるため、
    // 時刻指定のままだと日境界外のデータまで拾ってしまう。古い側の境界だけUTC日境界へ丸めて渡す
    // (dateRangeの表示上の期間は元の指定値のまま。実集計だけ日単位に広がることを許容する)。
    const retentionCutoffMs = Date.now() - GIFT_RETENTION_DAYS * MS_PER_DAY;
    const queryStart =
      row.startDatetime.getTime() < retentionCutoffMs
        ? new Date(`${row.startDatetime.toISOString().slice(0, 10)}T00:00:00.000Z`)
        : row.startDatetime;
    const queryEnd =
      row.endDatetime.getTime() < retentionCutoffMs
        ? new Date(`${row.endDatetime.toISOString().slice(0, 10)}T23:59:59.999Z`)
        : row.endDatetime;
    where = { receivedAt: { gte: queryStart, lte: queryEnd } };
    dateRange = { start: row.startDatetime.toISOString(), end: row.endDatetime.toISOString() };
  } else {
    if (row.date === null) return { ok: false };
    const { start, end } = getDateRange(row.period, row.date);
    where = { dayKey: { gte: start, lte: end } };
    dateRange = { start, end };
  }

  return {
    ok: true,
    value: { roomId: row.roomId, period: row.period, date: row.date, startDatetime: row.startDatetime, endDatetime: row.endDatetime, where, dateRange },
  };
}

/**
 * シェアリンク向け。**トークンだけが鍵**なのでセッションを見ない。
 * `queryGifts` が返す `GiftAnalyticsUser` を素通しせず、公開用フィールドだけへマップし直す。
 */
export async function queryContributionRankingByShareToken(
  token: string
): Promise<ContributionRankingQueryResult> {
  const resolved = await resolveContributionShareRange(token);
  if (!resolved.ok) return { ok: false };
  const row = resolved.value;

  // 第2引数(viewerStreamerId)は既存admin routeと同じくroomIdをダミーとして渡す。
  // 現状queryGifts内では未使用だが、将来意味を持たされた場合に公開経路が権限制御を
  // 迂回するリスクがあるため、ここで注意を残しておく。
  const { users, total } = await queryGifts(row.roomId, row.roomId, row.where);

  const room = await prisma.tiktokRoom.findUnique({
    where: { id: row.roomId },
    select: { hostTiktokUid: true },
  });

  let streamerNickname: string | null = null;
  let streamerProfileImageUrl: string | null = null;
  if (room !== null) {
    const [display, avatarUrls] = await Promise.all([
      resolveTikTokUserDisplay([room.hostTiktokUid]),
      resolveAvatarUrls([room.hostTiktokUid]),
    ]);
    streamerNickname = display.get(room.hostTiktokUid)?.nickname ?? null;
    streamerProfileImageUrl = avatarUrls.get(room.hostTiktokUid) ?? null;
  }

  // **verifiedは公開payloadから除外する。** それ以外(tiktokUid/tiktokHandle含む)は
  // 所有者向けランキングと同じ情報を公開する。GiftAnalyticsUserをそのまま返さず、
  // 明示的に型を絞ったオブジェクトへマップし直す。
  const users_: PublicContributionUser[] = users.map((u) => ({
    tiktokUid: u.tiktokUid,
    tiktokHandle: u.tiktokHandle,
    nickname: u.nickname,
    profileImageUrl: u.profileImageUrl,
    giftCount: u.giftCount,
    totalDiamonds: u.totalDiamonds,
    lastGiftAt: u.lastGiftAt,
  }));

  return {
    ok: true,
    payload: {
      period: row.period,
      date: row.date,
      startDatetime: row.startDatetime ? row.startDatetime.toISOString() : null,
      endDatetime: row.endDatetime ? row.endDatetime.toISOString() : null,
      dateRange: row.dateRange,
      users: users_,
      total,
      streamer: { nickname: streamerNickname, profileImageUrl: streamerProfileImageUrl },
    },
  };
}

/**
 * 公開ページのギフト内訳アコーディオン向け。所有者向け `/api/analytics/gifts/breakdown` と
 * 同じ `queryGiftBreakdown` を使い、roomId/期間はトークンから解決する
 * (`resolveContributionShareRange` を共有)。中身は giftId 別の集計のみで、
 * 個人を特定する追加情報は含まない。
 */
export async function queryContributionBreakdownByShareToken(
  token: string,
  tiktokUid: string
): Promise<{ ok: true; value: GiftBreakdownResult } | { ok: false }> {
  const resolved = await resolveContributionShareRange(token);
  if (!resolved.ok) return { ok: false };
  const value = await queryGiftBreakdown(resolved.value.roomId, tiktokUid, resolved.value.where);
  return { ok: true, value };
}
