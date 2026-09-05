// ギフト履歴一覧の取得クエリ。ルートハンドラから分離してテスト可能にしている。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { escapeLikePattern } from "@/lib/mobile-analytics-query";

export type GiftHistoryEvent = {
  id: string;
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  repeatCount: number;
  totalDiamonds: number;
  receivedAt: string;
};

// listenerQuery: uniqueId / nickname の部分一致(大小文字無視)で絞り込む。省略時は全件。
export async function queryGiftHistory(
  roomId: string,
  where: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } },
  limit: number,
  listenerQuery?: string | null
): Promise<{ events: GiftHistoryEvent[]; total: { count: number; diamonds: number }; hasMore: boolean }> {
  // イベント単位の一覧なので、そのイベント自身のuniqueId/nicknameが一致するかで素直に
  // フィルタしてよい(queryGiftsのような表示名変更による過少集計問題はここには当てはまらない
  // — 各行は「受信当時の記録」をそのまま出す一覧のため)。
  const fullWhere = {
    roomId,
    ...(listenerQuery
      ? {
          OR: [
            { uniqueId: { contains: escapeLikePattern(listenerQuery), mode: Prisma.QueryMode.insensitive } },
            { nickname: { contains: escapeLikePattern(listenerQuery), mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
    ...where,
  };

  // limit+1件取ることで、取得後にスライスするだけでhasMoreを判定できる(追加のcountクエリ不要)。
  const rows = await prisma.gift.findMany({
    where: fullWhere,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      uniqueId: true,
      nickname: true,
      profileImageUrl: true,
      giftId: true,
      giftName: true,
      giftPictureUrl: true,
      repeatCount: true,
      totalDiamonds: true,
      receivedAt: true,
    },
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  // 表示名は「TikTok公式の日本語名(labelJa)があればそれ、無ければ受信生データ(英語)」。
  // 一致キー(効果音・集計)には影響しない — ここは表示専用の差し替え。
  const giftIds = [...new Set(pageRows.map((r) => r.giftId))];
  const catalogRows = giftIds.length
    ? await prisma.tiktokGiftCatalog.findMany({
        where: { giftId: { in: giftIds } },
        select: { giftId: true, labelJa: true },
      })
    : [];
  const labelJaByGiftId = new Map(
    catalogRows.filter((c) => c.labelJa).map((c) => [c.giftId, c.labelJa as string])
  );

  const events = pageRows.map(({ receivedAt, giftName, ...base }) => ({
    ...base,
    giftName: labelJaByGiftId.get(base.giftId) ?? giftName,
    receivedAt: receivedAt.toISOString(),
  }));

  const total = events.reduce(
    (acc, e) => ({ count: acc.count + e.repeatCount, diamonds: acc.diamonds + e.totalDiamonds }),
    { count: 0, diamonds: 0 }
  );

  return { events, total, hasMore };
}
