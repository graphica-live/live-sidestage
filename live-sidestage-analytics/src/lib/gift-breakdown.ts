// 送信者1人ぶんの「ギフト名別」内訳。貢献ランキング(ユーザー別コイン数)の行を展開したときに出す。
//
// **明細(Gift)が残っている期間でしか出せない。** 90日を超えた分は
// GiftDailyListenerStat(ユーザー×日の合計)へロールアップされていて、ギフト名別の粒度が
// もう無いため。読み出し境界の判定は gift-analytics.ts の planSplit()/narrowToRawWindow() を
// そのまま使い、ロールアップ側は「読まずに、読めなかったことを coverage で返す」。
// 呼び出し側(API/UI)はエラーではなく「内訳なし」として扱う。

import { prisma } from "@/lib/prisma";
import {
  dayKeyUpperBound,
  getDateRange,
  narrowToRawWindow,
  planSplit,
  type GiftAggregateWhere,
  type SplitPlan,
} from "@/lib/gift-analytics";

export type GiftBreakdownEntry = {
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  /** Gift.repeatCount の合計(= 実際に送られた個数)。 */
  repeatCount: number;
  /** Gift.diamondCount(1個あたりのコイン数)の合計。行単位の単価を足した値。 */
  diamondCount: number;
  /** Gift.totalDiamonds の合計(= 表示に使うコイン数)。 */
  totalDiamonds: number;
  lastReceivedAt: string;
};

export type GiftBreakdownCoverage = {
  /** 明細を1件でも読める期間だったか。false = ロールアップしか無く内訳を出せない。 */
  detailAvailable: boolean;
  /** 要求範囲のうち明細を読み始めた dayKey。要求下限より後なら範囲の一部しか見ていない。 */
  rawFrom: string | null;
  /** 要求範囲の一部しか明細が残っていない(= rawFrom より前が欠けている)。 */
  partial: boolean;
};

export type GiftBreakdownResult = {
  uniqueId: string;
  gifts: GiftBreakdownEntry[];
  total: { repeatCount: number; totalDiamonds: number };
  coverage: GiftBreakdownCoverage;
};

function emptyResult(uniqueId: string, coverage: GiftBreakdownCoverage): GiftBreakdownResult {
  return { uniqueId, gifts: [], total: { repeatCount: 0, totalDiamonds: 0 }, coverage };
}

/**
 * 明細をどこまで読めるかの判定。DBに触らない純関数なので単体テストできる。
 *
 * `rawWhere === null` は「要求範囲がまるごとロールアップ済み = 内訳を出せない」。
 * ロールアップ側は読まない(ギフト名別の粒度が無いため)。
 */
export function resolveBreakdownWindow(
  baseWhere: GiftAggregateWhere,
  plan: SplitPlan
): { rawWhere: GiftAggregateWhere | null; coverage: GiftBreakdownCoverage } {
  if (plan.kind === "raw") {
    return { rawWhere: baseWhere, coverage: { detailAvailable: true, rawFrom: null, partial: false } };
  }

  // narrowToRawWindow は receivedAt 指定のとき null を返さない(dayKey下限を足すだけ)ので、
  // 「範囲の終端すらカットオフより古い」= 明細が1件も残っていないケースを自前で弾く。
  const upper = dayKeyUpperBound(baseWhere);
  const wholeRangeIsRolledUp = upper !== null && upper < plan.cutoffDayKey;
  const rawWhere = wholeRangeIsRolledUp ? null : narrowToRawWindow(baseWhere, plan.cutoffDayKey);

  return {
    rawWhere,
    coverage: rawWhere
      ? { detailAvailable: true, rawFrom: plan.cutoffDayKey, partial: true }
      : { detailAvailable: false, rawFrom: null, partial: false },
  };
}

export async function queryGiftBreakdown(
  roomId: string,
  uniqueId: string,
  where: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } },
  now: Date = new Date()
): Promise<GiftBreakdownResult> {
  const baseWhere: GiftAggregateWhere = { roomId, uniqueId: { in: [uniqueId] }, ...where };

  const { rawWhere, coverage } = resolveBreakdownWindow(baseWhere, await planSplit(baseWhere, now));

  if (!rawWhere) return emptyResult(uniqueId, coverage);

  const grouped = await prisma.gift.groupBy({
    by: ["giftId"],
    where: rawWhere,
    _sum: { repeatCount: true, diamondCount: true, totalDiamonds: true },
    _max: { receivedAt: true },
    orderBy: { _sum: { totalDiamonds: "desc" } },
  });

  if (grouped.length === 0) return emptyResult(uniqueId, coverage);

  const giftIds = grouped.map((g) => g.giftId);

  // 名前と画像は「期間内の最新の1行」から採る(giftPictureUrl は TikTok 側で差し替わりうる)。
  // aggregateGiftUsers() の nickname 補完と同じ二段構え。
  const latestRows = await prisma.gift.findMany({
    where: { ...rawWhere, giftId: { in: giftIds } },
    orderBy: { receivedAt: "desc" },
    distinct: ["giftId"],
    select: { giftId: true, giftName: true, giftPictureUrl: true },
  });
  const latestByGiftId = new Map(latestRows.map((r) => [r.giftId, r]));

  // 表示名は「TikTok公式の日本語名(labelJa)があればそれ、無ければ受信生データ(英語)」。
  // 一致キー(効果音・集計)には影響しない — ギフト履歴タブ(gift-history.ts)と同じ扱い。
  const catalogRows = await prisma.tiktokGiftCatalog.findMany({
    where: { giftId: { in: giftIds } },
    select: { giftId: true, labelJa: true },
  });
  const labelJaByGiftId = new Map(
    catalogRows.filter((c) => c.labelJa).map((c) => [c.giftId, c.labelJa as string])
  );

  const gifts: GiftBreakdownEntry[] = grouped.map((g) => {
    const latest = latestByGiftId.get(g.giftId);
    return {
      giftId: g.giftId,
      giftName: labelJaByGiftId.get(g.giftId) ?? latest?.giftName ?? String(g.giftId),
      giftPictureUrl: latest?.giftPictureUrl ?? null,
      repeatCount: g._sum.repeatCount ?? 0,
      diamondCount: g._sum.diamondCount ?? 0,
      totalDiamonds: g._sum.totalDiamonds ?? 0,
      lastReceivedAt: (g._max.receivedAt ?? new Date(0)).toISOString(),
    };
  });

  const total = gifts.reduce(
    (acc, g) => ({
      repeatCount: acc.repeatCount + g.repeatCount,
      totalDiamonds: acc.totalDiamonds + g.totalDiamonds,
    }),
    { repeatCount: 0, totalDiamonds: 0 }
  );

  return { uniqueId, gifts, total, coverage };
}

/**
 * 内訳APIの期間クエリを解釈する。両ルート(配信者向け / 管理者向け)で同じ規則を使う。
 *
 * - `startDatetime` と `endDatetime` は**両方そろっているときだけ**範囲指定として扱う。
 *   片方だけ渡されたときに黙って period/date へ落とすと、依頼した範囲と違う集計を
 *   「成功」として返してしまうので 400 にする。
 * - 解釈できない日時("2026-13-01" など)も 400。そのまま Prisma へ渡すと Invalid Date になり
 *   500 か静かに空の結果になる。
 */
export function parseBreakdownRange(
  searchParams: URLSearchParams
):
  | {
      ok: true;
      where: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } };
      dateRange: { start: string; end: string };
    }
  | { ok: false; error: string } {
  const startDatetime = searchParams.get("startDatetime");
  const endDatetime = searchParams.get("endDatetime");

  if (startDatetime || endDatetime) {
    if (!startDatetime || !endDatetime) {
      return { ok: false, error: "startDatetime and endDatetime must be given together" };
    }
    const gte = new Date(startDatetime);
    const lte = new Date(endDatetime);
    if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime())) {
      return { ok: false, error: "startDatetime / endDatetime is not a valid datetime" };
    }
    return { ok: true, where: { receivedAt: { gte, lte } }, dateRange: { start: startDatetime, end: endDatetime } };
  }

  const period = searchParams.get("period") ?? "day";
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const { start, end } = getDateRange(period, date);
  return { ok: true, where: { dayKey: { gte: start, lte: end } }, dateRange: { start, end } };
}
