// 貢献コイン数一覧オーバーレイのスナップショット構築。**サーバー専用**(prisma を引く)。

import { prisma } from "@/lib/prisma";
import { jstDateKey } from "./day-key";
import { fetchDayGifts } from "./gift-day";
import { normalizeOverlayAppearance, OVERLAY_APPEARANCE_DEFAULT, type OverlayAppearance } from "./appearance";

export type CoinListEntry = {
  rank: number;
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  coinCount: number;
};

export type CoinListSnapshot = {
  dayKey: string;
  appearance: OverlayAppearance;
  bgStyle: "transparent" | "semi";
  sortOrder: "asc" | "desc";
  rowGap: number;
  entries: CoinListEntry[];
};

const DEFAULT_MAX_ENTRIES = 20;
const DEFAULT_ROW_GAP = 8;

export async function buildCoinListSnapshot(streamerId: string): Promise<CoinListSnapshot | null> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: { roomId: true, overlayCoinListSettings: true },
  });
  if (!streamer || !streamer.roomId) return null;

  const settings = streamer.overlayCoinListSettings;
  const sortOrder: "asc" | "desc" = settings?.sortOrder === "asc" ? "asc" : "desc";
  const maxEntries = settings?.maxEntries ?? DEFAULT_MAX_ENTRIES;

  // 移植範囲は当日固定(desktop版のcoin-listに日付ナビは無い)。
  const dayKey = jstDateKey();
  const gifts = await fetchDayGifts(streamer.roomId, dayKey);

  const totals = new Map<string, { nickname: string; image: string | null; total: number }>();
  for (const g of gifts) {
    const t = totals.get(g.uniqueId) ?? { nickname: g.nickname, image: g.profileImageUrl, total: 0 };
    t.nickname = g.nickname;
    t.image = g.profileImageUrl;
    t.total += g.totalDiamonds;
    totals.set(g.uniqueId, t);
  }

  const entries: CoinListEntry[] = Array.from(totals.entries())
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => (sortOrder === "asc" ? a[1].total - b[1].total : b[1].total - a[1].total))
    .slice(0, maxEntries)
    .map(([uniqueId, v], i) => ({
      rank: i + 1,
      uniqueId,
      nickname: v.nickname,
      profileImageUrl: v.image,
      coinCount: v.total,
    }));

  return {
    dayKey,
    appearance: normalizeOverlayAppearance(settings ?? { ...OVERLAY_APPEARANCE_DEFAULT }),
    bgStyle: settings?.bgStyle === "semi" ? "semi" : "transparent",
    sortOrder,
    rowGap: settings?.rowGap ?? DEFAULT_ROW_GAP,
    entries,
  };
}
