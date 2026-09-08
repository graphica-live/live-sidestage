import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrls } from "@/lib/avatar-storage";
import { resolveTikTokUserDisplay } from "@/lib/tiktok-user";
import { escapeLikePattern } from "@/lib/mobile-analytics-query";
import {
  dayKeyOf,
  isWithinRawGiftWindow,
  resolveRollupReadCutoff,
  shiftDayKey,
} from "@/lib/gift-retention-window";

export function getDateRange(
  period: string,
  date: string
): { start: string; end: string } {
  const d = new Date(date + "T00:00:00Z");

  if (period === "week") {
    const day = d.getUTCDay();
    const daysToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() + daysToMon);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    return {
      start: mon.toISOString().slice(0, 10),
      end: sun.toISOString().slice(0, 10),
    };
  }

  if (period === "month") {
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const first = new Date(Date.UTC(year, month, 1));
    const last = new Date(Date.UTC(year, month + 1, 0));
    return {
      start: first.toISOString().slice(0, 10),
      end: last.toISOString().slice(0, 10),
    };
  }

  if (period === "year") {
    const year = d.getUTCFullYear();
    const first = new Date(Date.UTC(year, 0, 1));
    const last = new Date(Date.UTC(year, 11, 31));
    return {
      start: first.toISOString().slice(0, 10),
      end: last.toISOString().slice(0, 10),
    };
  }

  return { start: date, end: date };
}

export type GiftAnalyticsUser = {
  tiktokUid: string;
  /** TikTokUser 行が無い / ハンドル未観測なら null。 */
  tiktokHandle: string | null;
  nickname: string | null;
  profileImageUrl: string | null;
  giftCount: number;
  totalDiamonds: number;
  lastGiftAt: string;
};

/** Giftの集計に使う where。queryGifts と確定処理(battle-history-finalize.ts)で共有する。 */
export type GiftAggregateWhere = {
  roomId: string;
  id?: { notIn: string[] };
  tiktokUid?: { in: string[] };
  dayKey?: { gte: string; lte: string };
  receivedAt?: { gte: Date; lte: Date };
};

/** 集計の中間表現。Gift 側とロールアップ側をこの形へ揃えてから tiktokUid でマージする。 */
type Accumulated = {
  giftCount: number;
  totalDiamonds: number;
  lastGiftAt: Date | null;
};

function dayKeyLowerBound(where: GiftAggregateWhere): string | null {
  if (where.dayKey) return where.dayKey.gte;
  if (where.receivedAt) return dayKeyOf(where.receivedAt.gte);
  return null;
}

export function dayKeyUpperBound(where: GiftAggregateWhere): string | null {
  if (where.dayKey) return where.dayKey.lte;
  if (where.receivedAt) return dayKeyOf(where.receivedAt.lte);
  return null;
}

/**
 * 読み出しをどう分割するかの計画。
 *
 * `raw` は現行実装と1文字も変わらないクエリを投げる経路。**通常運用のリクエストは
 * ここで抜ける**(下限が80日前より新しければ AppSetting すら読まない)。
 */
export type SplitPlan =
  | { kind: "raw" }
  | { kind: "split"; cutoffDayKey: string; rollupLower: string | null; rollupUpper: string | null };

export async function planSplit(where: GiftAggregateWhere, now: Date): Promise<SplitPlan> {
  const lower = dayKeyLowerBound(where);
  if (isWithinRawGiftWindow(lower, now)) return { kind: "raw" };

  const cutoffDayKey = await resolveRollupReadCutoff(now);
  if (lower !== null && lower >= cutoffDayKey) return { kind: "raw" };

  const upper = dayKeyUpperBound(where);
  const rollupUpperFromCutoff = shiftDayKey(cutoffDayKey, -1);
  const rollupUpper =
    upper !== null && upper < rollupUpperFromCutoff ? upper : rollupUpperFromCutoff;

  return { kind: "split", cutoffDayKey, rollupLower: lower, rollupUpper };
}

/** 分割時に Gift 側へ渡す where(カットオフ以降だけを読ませる)。範囲が空なら null。 */
export function narrowToRawWindow(
  where: GiftAggregateWhere,
  cutoffDayKey: string
): GiftAggregateWhere | null {
  if (where.dayKey) {
    if (where.dayKey.lte < cutoffDayKey) return null;
    const gte = where.dayKey.gte > cutoffDayKey ? where.dayKey.gte : cutoffDayKey;
    return { ...where, dayKey: { gte, lte: where.dayKey.lte } };
  }
  // receivedAt(時刻精度)指定は dayKey の下限を足して丸める。カットオフより古い部分は
  // ロールアップ側が日単位で拾う。
  return { ...where, dayKey: { gte: cutoffDayKey, lte: "9999-12-31" } };
}

async function accumulateFromGifts(where: GiftAggregateWhere): Promise<Map<string, Accumulated>> {
  const grouped = await prisma.gift.groupBy({
    by: ["tiktokUid"],
    where,
    _sum: { repeatCount: true, totalDiamonds: true },
    _max: { receivedAt: true },
  });

  const result = new Map<string, Accumulated>();
  for (const g of grouped) {
    result.set(g.tiktokUid, {
      giftCount: g._sum?.repeatCount ?? 0,
      totalDiamonds: g._sum?.totalDiamonds ?? 0,
      lastGiftAt: g._max?.receivedAt ?? null,
    });
  }
  return result;
}

async function accumulateFromRollup(
  where: GiftAggregateWhere,
  plan: Extract<SplitPlan, { kind: "split" }>
): Promise<Map<string, Accumulated>> {
  const rollupWhere = {
    roomId: where.roomId,
    ...(where.tiktokUid ? { tiktokUid: where.tiktokUid } : {}),
    dayKey: {
      ...(plan.rollupLower !== null ? { gte: plan.rollupLower } : {}),
      lte: plan.rollupUpper ?? shiftDayKey(plan.cutoffDayKey, -1),
    },
  };

  const grouped = await prisma.giftDailyListenerStat.groupBy({
    by: ["tiktokUid"],
    where: rollupWhere,
    _sum: { giftCount: true, totalDiamonds: true },
    _max: { lastReceivedAt: true },
  });

  const result = new Map<string, Accumulated>();
  for (const g of grouped) {
    result.set(g.tiktokUid, {
      giftCount: g._sum?.giftCount ?? 0,
      totalDiamonds: g._sum?.totalDiamonds ?? 0,
      lastGiftAt: g._max?.lastReceivedAt ?? null,
    });
  }
  return result;
}

/**
 * 古い側(ロールアップ)へ新しい側(Gift)を重ねる。
 *
 * **突き合わせキーは tiktokUid**。ハンドルで突き合わせていた頃は、改名を跨いだ同一人物が
 * 明細側とロールアップ側で別人として二重計上されていた。
 */
function mergeAccumulated(
  older: Map<string, Accumulated>,
  newer: Map<string, Accumulated>
): Map<string, Accumulated> {
  const merged = new Map(older);
  for (const [tiktokUid, add] of newer) {
    const cur = merged.get(tiktokUid);
    if (!cur) {
      merged.set(tiktokUid, { ...add });
      continue;
    }
    merged.set(tiktokUid, {
      giftCount: cur.giftCount + add.giftCount,
      totalDiamonds: cur.totalDiamonds + add.totalDiamonds,
      lastGiftAt:
        add.lastGiftAt && (!cur.lastGiftAt || add.lastGiftAt > cur.lastGiftAt)
          ? add.lastGiftAt
          : cur.lastGiftAt,
    });
  }
  return merged;
}

/**
 * 送信者ごとのギフト集計。**groupBy(合計)→ 期間内の最新行から nickname/profileImageUrl を補完**、
 * という二段階を1箇所にまとめたもの。groupBy 単独では nickname が取れず、素朴に findMany すると
 * 全件を持ってくることになるため、この形が正本。
 *
 * **明細(Gift)と日次ロールアップ(GiftDailyListenerStat)の切り替えもここで吸収する。**
 * 呼び出し元はどちらを読んだか知らない(シグネチャ・返り値の形は不変)。境界は
 * `gift-retention-window.ts` の `resolveRollupReadCutoff()`。80日以内しか要求していない
 * リクエスト(=通常運用のほぼ全て)は現行と同じクエリのままになる。
 *
 * 制約: `id: { notIn }`(バトル確定処理のギフト除外)はロールアップ側では表現できない。
 * 呼び出しているのはバトル窓(常に直近)の集計だけなので実害はないが、80日超の範囲で
 * この条件を使うと除外が効かない。
 *
 * `viewerStreamerId` に依存しない。バトル履歴の確定処理は閲覧者非依存で集計する必要があるので、
 * viewerStreamerIdを引数で外せる形にしてある。
 *
 * `resolveAvatars: false` を渡すと自前ストレージの署名付きURL解決(S3 presign)を省く。
 * 確定処理は署名付きURLを保存しない(24時間で失効する)ため、その分の往復を避ける。
 */
export async function aggregateGiftUsers(
  where: GiftAggregateWhere,
  options: { resolveAvatars?: boolean; now?: Date } = {}
): Promise<{ users: GiftAnalyticsUser[]; total: { giftCount: number; totalDiamonds: number } }> {
  const { resolveAvatars = true, now = new Date() } = options;

  const plan = await planSplit(where, now);

  let accumulated: Map<string, Accumulated>;
  if (plan.kind === "raw") {
    accumulated = await accumulateFromGifts(where);
  } else {
    const rawWhere = narrowToRawWindow(where, plan.cutoffDayKey);
    const [rolled, raw] = await Promise.all([
      accumulateFromRollup(where, plan),
      rawWhere ? accumulateFromGifts(rawWhere) : Promise.resolve(new Map<string, Accumulated>()),
    ]);
    accumulated = mergeAccumulated(rolled, raw);
  }

  if (accumulated.size === 0) return { users: [], total: { giftCount: 0, totalDiamonds: 0 } };

  const tiktokUids = [...accumulated.keys()];
  // 表示名は生観測行ではなく TikTokUser から読み取り時に解決する(改名前のハンドルを焼き付けない)。
  // アバターも自前ストレージの署名付きURLだけを使う(TikTokの生URLは数十時間で失効するため保存しない)。
  const [display, cachedAvatarUrls] = await Promise.all([
    resolveTikTokUserDisplay(tiktokUids),
    resolveAvatars ? resolveAvatarUrls(tiktokUids) : Promise.resolve(new Map<string, string>()),
  ]);

  const users = tiktokUids.map((tiktokUid) => {
    const acc = accumulated.get(tiktokUid)!;
    const d = display.get(tiktokUid);
    return {
      tiktokUid,
      tiktokHandle: d?.tiktokHandle ?? null,
      nickname: d?.nickname ?? null,
      profileImageUrl: cachedAvatarUrls.get(tiktokUid) ?? null,
      giftCount: acc.giftCount,
      totalDiamonds: acc.totalDiamonds,
      lastGiftAt: (acc.lastGiftAt ?? new Date()).toISOString(),
    };
  });

  const total = users.reduce(
    (acc, u) => ({ giftCount: acc.giftCount + u.giftCount, totalDiamonds: acc.totalDiamonds + u.totalDiamonds }),
    { giftCount: 0, totalDiamonds: 0 }
  );

  return { users, total };
}

type MatchedUid = { tiktokUid: string };

/**
 * 明細(gifts)側の名前一致。room + 期間で先に絞ってから tiktok_users へ JOIN する。
 * `@@index([tiktokHandle])` は b-tree なので `ILIKE '%...%'` には効かない — 性能はこの先絞りで担保する。
 */
async function matchRawGiftSenders(where: GiftAggregateWhere, like: string): Promise<MatchedUid[]> {
  const conditions: Prisma.Sql[] = [Prisma.sql`g."roomId" = ${where.roomId}`];
  if (where.dayKey) {
    conditions.push(Prisma.sql`g."dayKey" >= ${where.dayKey.gte} AND g."dayKey" <= ${where.dayKey.lte}`);
  }
  if (where.receivedAt) {
    conditions.push(
      Prisma.sql`g."receivedAt" >= ${where.receivedAt.gte} AND g."receivedAt" <= ${where.receivedAt.lte}`
    );
  }
  if (where.id) {
    conditions.push(Prisma.sql`g."id" <> ALL(${where.id.notIn})`);
  }
  return prisma.$queryRaw<MatchedUid[]>`
    SELECT DISTINCT g."tiktokUid"
      FROM public.gifts g
      JOIN public.tiktok_users u ON u."tiktokUid" = g."tiktokUid"
     WHERE ${Prisma.join(conditions, " AND ")}
       AND (u."tiktokHandle" ILIKE ${like} OR u.nickname ILIKE ${like})
  `;
}

/** ロールアップ(gift_daily_listener_stats)側の名前一致。dayKey 範囲で先に絞る。 */
async function matchRollupSenders(
  roomId: string,
  lower: string | null,
  upper: string,
  like: string
): Promise<MatchedUid[]> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`s."roomId" = ${roomId}`,
    Prisma.sql`s."dayKey" <= ${upper}`,
  ];
  if (lower !== null) conditions.push(Prisma.sql`s."dayKey" >= ${lower}`);
  return prisma.$queryRaw<MatchedUid[]>`
    SELECT DISTINCT s."tiktokUid"
      FROM public.gift_daily_listener_stats s
      JOIN public.tiktok_users u ON u."tiktokUid" = s."tiktokUid"
     WHERE ${Prisma.join(conditions, " AND ")}
       AND (u."tiktokHandle" ILIKE ${like} OR u.nickname ILIKE ${like})
  `;
}

// roomId: 集計対象のTikTokアカウント(TiktokRoom)。データは同じroomIdを持つ全登録者で共有される。
// listenerQuery: リスナー名(tiktokHandle/nicknameの部分一致)による絞り込み。指定時は「一致する
// tiktokHandleの集合」を先に求め、その集合に対して(listenerQuery条件を外した)通常の集計を行う
// 2段階クエリにする。表示名条件をgroupByのwhereへ直接混ぜると、対象ユーザーが期間中に
// TikTok側の表示名を変えていた場合、一致した行だけが集計され合計コイン数が過少になるため。
export async function queryGifts(
  roomId: string,
  viewerStreamerId: string,
  where: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } },
  listenerQuery?: string | null
): Promise<{ users: GiftAnalyticsUser[]; total: { giftCount: number; totalDiamonds: number } }> {
  const baseWhere: GiftAggregateWhere = {
    roomId,
    ...where,
  };

  let fullWhere: GiftAggregateWhere = baseWhere;
  if (listenerQuery) {
    // 表示名は TikTokUser 側にしか無いので JOIN する。**Prisma の nested filter は使えない**
    // (Gift → TikTokUser のリレーションを張っていないため)。
    //
    // **TikTokUser を先に部分一致検索して in で絞る形にはしない。** TikTokUser は room スコープを
    // 持たないグローバル表なので、短い検索語では全プラットフォームのユーザーがマッチし、
    // バインドパラメータ上限(32,767)に触れる。room + 期間で先に絞ってから JOIN するのが要点。
    const like = `%${escapeLikePattern(listenerQuery)}%`;

    const plan = await planSplit(baseWhere, new Date());
    const rawWhere = plan.kind === "raw" ? baseWhere : narrowToRawWindow(baseWhere, plan.cutoffDayKey);

    // 80日を超える範囲では、Giftが既に消えているリスナーを名前で引けない。
    // 同じ条件をロールアップ側(GiftDailyListenerStat)にも当てて union する。
    const [rawMatches, rollupMatches] = await Promise.all([
      rawWhere ? matchRawGiftSenders(rawWhere, like) : Promise.resolve([] as MatchedUid[]),
      plan.kind === "split"
        ? matchRollupSenders(
            roomId,
            plan.rollupLower,
            plan.rollupUpper ?? plan.cutoffDayKey,
            like
          )
        : Promise.resolve([] as MatchedUid[]),
    ]);

    const matched = [...new Set([...rawMatches, ...rollupMatches].map((u) => u.tiktokUid))];
    if (matched.length === 0) return { users: [], total: { giftCount: 0, totalDiamonds: 0 } };
    fullWhere = { ...baseWhere, tiktokUid: { in: matched } };
  }

  return aggregateGiftUsers(fullWhere);
}
