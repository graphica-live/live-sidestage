// 貢献コイン数一覧オーバーレイのスナップショット構築。**サーバー専用**(prisma を引く)。

import { prisma } from "@/lib/prisma";
import { jstDateKey } from "./day-key";
import { fetchDayGifts } from "./gift-day";
import { normalizeOverlayAppearance, OVERLAY_APPEARANCE_DEFAULT, type OverlayAppearance } from "./appearance";

export type CoinListEntry = {
  rank: number;
  tiktokUid: string;
  tiktokHandle: string | null;
  nickname: string | null;
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

  // 合算キーは不変のtiktokUid。ハンドル改名で当日の累計が割れないのが要点。
  const totals = new Map<
    string,
    { tiktokHandle: string | null; nickname: string | null; image: string | null; total: number }
  >();
  for (const g of gifts) {
    const t = totals.get(g.tiktokUid) ?? {
      tiktokHandle: g.tiktokHandle,
      nickname: g.nickname,
      image: g.profileImageUrl,
      total: 0,
    };
    t.tiktokHandle = g.tiktokHandle;
    t.nickname = g.nickname;
    t.image = g.profileImageUrl;
    t.total += g.totalDiamonds;
    totals.set(g.tiktokUid, t);
  }

  const entries: CoinListEntry[] = Array.from(totals.entries())
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => (sortOrder === "asc" ? a[1].total - b[1].total : b[1].total - a[1].total))
    .slice(0, maxEntries)
    .map(([tiktokUid, v], i) => ({
      rank: i + 1,
      tiktokUid,
      tiktokHandle: v.tiktokHandle,
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
