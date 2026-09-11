// ギフト履歴一覧の取得クエリ。ルートハンドラから分離してテスト可能にしている。

import { prisma } from "@/lib/prisma";
import { escapeLikePattern } from "@/lib/mobile-analytics-query";
import { resolveTikTokUserDisplay } from "@/lib/tiktok-user";
import { resolveAvatarUrls } from "@/lib/avatar-storage";

export type GiftHistoryEvent = {
  id: string;
  /** 同一性キー。表示用の tiktokHandle / nickname は TikTokUser から順引きした現在値。 */
  tiktokUid: string;
  tiktokHandle: string | null;
  nickname: string | null;
  profileImageUrl: string | null;
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  repeatCount: number;
  totalDiamonds: number;
  receivedAt: string;
};

/** Gift行のうち、表示イベントへ変換するのに必要な列だけ。 */
type GiftHistoryRow = {
  id: string;
  tiktokUid: string;
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  repeatCount: number;
  totalDiamonds: number;
  receivedAt: Date;
};

const GIFT_HISTORY_ROW_SELECT = {
  id: true,
  tiktokUid: true,
  giftId: true,
  giftName: true,
  giftPictureUrl: true,
  repeatCount: true,
  totalDiamonds: true,
  receivedAt: true,
} as const;

/**
 * Gift行をGiftHistoryEventへ変換する。REST(queryGiftHistory)とpush
 * (realtime-sync/dispatch.tsのapplyGiftHistorySyncTrigger)の両方で共用する。
 *
 * 表示名は「TikTok公式の日本語名(labelJa)があればそれ、無ければ受信生データ(英語)」。
 * 一致キー(効果音・集計)には影響しない — ここは表示専用の差し替え。
 * 表示名とアイコンは tiktokUid から読み出し時に順引きする(Gift に列が無い)。
 */
async function decorateGiftHistoryRows(rows: GiftHistoryRow[]): Promise<GiftHistoryEvent[]> {
  if (rows.length === 0) return [];

  const giftIds = [...new Set(rows.map((r) => r.giftId))];
  const catalogRows = giftIds.length
    ? await prisma.tiktokGiftCatalog.findMany({
        where: { giftId: { in: giftIds } },
        select: { giftId: true, labelJa: true },
      })
    : [];
  const labelJaByGiftId = new Map(
    catalogRows.filter((c) => c.labelJa).map((c) => [c.giftId, c.labelJa as string])
  );

  const tiktokUids = [...new Set(rows.map((r) => r.tiktokUid))];
  const [display, avatars] = await Promise.all([
    resolveTikTokUserDisplay(tiktokUids),
    resolveAvatarUrls(tiktokUids),
  ]);

  return rows.map(({ receivedAt, giftName, ...base }) => ({
    ...base,
    tiktokHandle: display.get(base.tiktokUid)?.tiktokHandle ?? null,
    nickname: display.get(base.tiktokUid)?.nickname ?? null,
    profileImageUrl: avatars.get(base.tiktokUid) ?? null,
    giftName: labelJaByGiftId.get(base.giftId) ?? giftName,
    receivedAt: receivedAt.toISOString(),
  }));
}

/**
 * Gift.id 1件から GiftHistoryEvent を組み立てる。**push専用の入口**
 * (realtime-sync/dispatch.tsのapplyGiftHistorySyncTriggerから呼ぶ)。
 * 該当行が既に無い(削除済み・保持期間超過)場合は null を返す — 呼び出し側は
 * 「送るべきイベントが無かった」as正常系として扱ってよい。
 */
export async function buildGiftHistoryEventById(giftId: string): Promise<GiftHistoryEvent | null> {
  const row = await prisma.gift.findUnique({
    where: { id: giftId },
    select: GIFT_HISTORY_ROW_SELECT,
  });
  if (!row) return null;
  const [event] = await decorateGiftHistoryRows([row]);
  return event ?? null;
}

// listenerQuery: tiktokHandle / nickname の部分一致(大小文字無視)で絞り込む。省略時は全件。
export async function queryGiftHistory(
  roomId: string,
  where: { dayKey?: { gte: string; lte: string }; receivedAt?: { gte: Date; lte: Date } },
  limit: number,
  listenerQuery?: string | null
): Promise<{ events: GiftHistoryEvent[]; total: { count: number; diamonds: number }; hasMore: boolean }> {
  // Gift は表示用の列を持たないので、名前での絞り込みは TikTokUser 側を先に引いて
  // tiktokUid の集合へ落とす。**room + 期間で先に絞ってから当てる**(グローバルな
  // TikTokUser を素で部分一致させると IN のバインドパラメータ上限に触れる)。
  let tiktokUidFilter: { in: string[] } | undefined;
  if (listenerQuery) {
    const pattern = `%${escapeLikePattern(listenerQuery)}%`;
    const matched = await prisma.$queryRaw<{ tiktokUid: string }[]>`
      SELECT DISTINCT g."tiktokUid"
        FROM public.gifts g
        JOIN public.tiktok_users u ON u."tiktokUid" = g."tiktokUid"
       WHERE g."roomId" = ${roomId}
         AND (u."tiktokHandle" ILIKE ${pattern} ESCAPE '\\' OR u.nickname ILIKE ${pattern} ESCAPE '\\')
    `;
    if (matched.length === 0) {
      return { events: [], total: { count: 0, diamonds: 0 }, hasMore: false };
    }
    tiktokUidFilter = { in: matched.map((r) => r.tiktokUid) };
  }

  const fullWhere = {
    roomId,
    ...(tiktokUidFilter ? { tiktokUid: tiktokUidFilter } : {}),
    ...where,
  };

  // limit+1件取ることで、取得後にスライスするだけでhasMoreを判定できる(追加のcountクエリ不要)。
  const rows = await prisma.gift.findMany({
    where: fullWhere,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: GIFT_HISTORY_ROW_SELECT,
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const events = await decorateGiftHistoryRows(pageRows);

  const total = events.reduce(
    (acc, e) => ({ count: acc.count + e.repeatCount, diamonds: acc.diamonds + e.totalDiamonds }),
    { count: 0, diamonds: 0 }
  );

  return { events, total, hasMore };
}
