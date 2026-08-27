// Like数一覧オーバーレイのスナップショット構築。**サーバー専用**(prisma を引く)。
// like-contributionと同じLikeTally(日次累計)を読むだけで、JS側での集計は不要
// (DBのORDER BYに任せる)。

import { prisma } from "@/lib/prisma";
import { jstDateKey } from "./day-key";
import { normalizeOverlayAppearance, OVERLAY_APPEARANCE_DEFAULT, type OverlayAppearance } from "./appearance";

export type TapListEntry = {
  rank: number;
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  tapCount: number;
};

export type TapListSnapshot = {
  dayKey: string;
  appearance: OverlayAppearance;
  bgStyle: "transparent" | "semi";
  rowGap: number;
  entries: TapListEntry[];
};

const DEFAULT_MAX_ENTRIES = 20;
const DEFAULT_ROW_GAP = 8;

export async function buildTapListSnapshot(streamerId: string): Promise<TapListSnapshot | null> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: { roomId: true, overlayTapListSettings: true },
  });
  if (!streamer || !streamer.roomId) return null;

  const settings = streamer.overlayTapListSettings;
  const maxEntries = settings?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const dayKey = jstDateKey();

  const rows = await prisma.likeTally.findMany({
    where: { roomId: streamer.roomId, dayKey, totalLikes: { gt: 0 } },
    orderBy: { totalLikes: "desc" },
    take: maxEntries,
    select: { uniqueId: true, nickname: true, profileImageUrl: true, totalLikes: true },
  });

  const entries: TapListEntry[] = rows.map((r, i) => ({
    rank: i + 1,
    uniqueId: r.uniqueId,
    nickname: r.nickname,
    profileImageUrl: r.profileImageUrl,
    tapCount: r.totalLikes,
  }));

  return {
    dayKey,
    appearance: normalizeOverlayAppearance(settings ?? { ...OVERLAY_APPEARANCE_DEFAULT }),
    bgStyle: settings?.bgStyle === "semi" ? "semi" : "transparent",
    rowGap: settings?.rowGap ?? DEFAULT_ROW_GAP,
    entries,
  };
}
