import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrls } from "@/lib/avatar-storage";
import { escapeLikePattern } from "@/lib/mobile-analytics-query";

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
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  giftCount: number;
  totalDiamonds: number;
  lastGiftAt: string;
};

/** viewerStreamerIdが「非表示」にしたギフト(GiftEdit.hidden)のIDを返す。非表示は閲覧者本人のview以外には一切影響しない。 */
export async function resolveHiddenGiftIds(roomId: string, viewerStreamerId: string): Promise<string[]> {
  const hiddenEdits = await prisma.giftEdit.findMany({
    where: { streamerId: viewerStreamerId, hidden: true, gift: { roomId } },
    select: { giftId: true },
  });
  return hiddenEdits.map((e) => e.giftId);
}

/** Giftの集計に使う where。queryGifts と確定処理(battle-history-finalize.ts)で共有する。 */
export type GiftAggregateWhere = {
  roomId: string;
  id?: { notIn: string[] };
  uniqueId?: { in: string[] };
  dayKey?: { gte: string; lte: string };
  receivedAt?: { gte: Date; lte: Date };
};

/**
 * 送信者ごとのギフト集計。**groupBy(合計)→ 期間内の最新行から nickname/profileImageUrl を補完**、
 * という二段階を1箇所にまとめたもの。groupBy 単独では nickname が取れず、素朴に findMany すると
 * 全件を持ってくることになるため、この形が正本。
 *
 * `viewerStreamerId` に依存しない(非表示ギフトの除外は呼び出し側が `where.id.notIn` で渡す)。
 * バトル履歴の確定処理は閲覧者非依存で集計する必要があるので、除外を引数で外せる形にしてある。
 *
 * `resolveAvatars: false` を渡すと自前ストレージの署名付きURL解決(S3 presign)を省く。
 * 確定処理は署名付きURLを保存しない(24時間で失効する)ため、その分の往復を避ける。
 */
export async function aggregateGiftUsers(
  where: GiftAggregateWhere,
  options: { resolveAvatars?: boolean } = {}
): Promise<{ users: GiftAnalyticsUser[]; total: { giftCount: number; totalDiamonds: number } }> {
  const { resolveAvatars = true } = options;

  const grouped = await prisma.gift.groupBy({
    by: ["uniqueId"],
    where,
    _sum: { repeatCount: true, totalDiamonds: true },
    _max: { receivedAt: true },
  });

  if (grouped.length === 0) return { users: [], total: { giftCount: 0, totalDiamonds: 0 } };

  const profiles = await prisma.gift.findMany({
    where: { ...where, uniqueId: { in: grouped.map((g) => g.uniqueId) } },
    orderBy: { receivedAt: "desc" },
    distinct: ["uniqueId"],
    select: { uniqueId: true, nickname: true, profileImageUrl: true },
  });

  const profileMap = new Map(profiles.map((p) => [p.uniqueId, p]));
  // TikTokの署名付きprofileImageUrlは数十時間で失効する。自前ストレージにキャッシュ済みなら
  // 恒久URLへ差し替える(未ヒットは従来どおり生のTikTok URLへフォールバック)。
  const cachedAvatarUrls = resolveAvatars
    ? await resolveAvatarUrls("gift_sender", grouped.map((g) => g.uniqueId))
    : new Map<string, string>();

  const users = grouped.map((g) => {
    const profile = profileMap.get(g.uniqueId);
    return {
      uniqueId: g.uniqueId,
      nickname: profile?.nickname ?? g.uniqueId,
      profileImageUrl: cachedAvatarUrls.get(g.uniqueId) ?? profile?.profileImageUrl ?? null,
      giftCount: g._sum.repeatCount ?? 0,
      totalDiamonds: g._sum.totalDiamonds ?? 0,
      lastGiftAt: (g._max.receivedAt ?? new Date()).toISOString(),
    };
  });

  const total = users.reduce(
    (acc, u) => ({ giftCount: acc.giftCount + u.giftCount, totalDiamonds: acc.totalDiamonds + u.totalDiamonds }),
    { giftCount: 0, totalDiamonds: 0 }
  );

  return { users, total };
}

// roomId: 集計対象のTikTokアカウント(TiktokRoom)。データは同じroomIdを持つ全登録者で共有される。
// viewerStreamerId: 閲覧者本人が「非表示」にしたギフト(GiftEdit.hidden)を除外するために使う。
// listenerQuery: リスナー名(uniqueId/nicknameの部分一致)による絞り込み。指定時は「一致する
// uniqueIdの集合」を先に求め、その集合に対して(listenerQuery条件を外した)通常の集計を行う
// 2段階クエリにする。表示名条件をgroupByのwhereへ直接混ぜると、対象ユーザーが期間中に
// TikTok側の表示名を変えていた場合、一致した行だけが集計され合計コイン数が過少になるため。
export async function queryGifts(
  roomId: string,
  viewerStreamerId: string,
  where: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } },
  listenerQuery?: string | null
): Promise<{ users: GiftAnalyticsUser[]; total: { giftCount: number; totalDiamonds: number } }> {
  const hiddenIds = await resolveHiddenGiftIds(roomId, viewerStreamerId);

  const baseWhere: GiftAggregateWhere = {
    roomId,
    ...(hiddenIds.length > 0 ? { id: { notIn: hiddenIds } } : {}),
    ...where,
  };

  let fullWhere: GiftAggregateWhere = baseWhere;
  if (listenerQuery) {
    const pattern = escapeLikePattern(listenerQuery);
    const matchingUsers = await prisma.gift.findMany({
      where: {
        ...baseWhere,
        OR: [
          { uniqueId: { contains: pattern, mode: Prisma.QueryMode.insensitive } },
          { nickname: { contains: pattern, mode: Prisma.QueryMode.insensitive } },
        ],
      },
      select: { uniqueId: true },
      distinct: ["uniqueId"],
    });
    if (matchingUsers.length === 0) return { users: [], total: { giftCount: 0, totalDiamonds: 0 } };
    fullWhere = { ...baseWhere, uniqueId: { in: matchingUsers.map((u) => u.uniqueId) } };
  }

  return aggregateGiftUsers(fullWhere);
}
