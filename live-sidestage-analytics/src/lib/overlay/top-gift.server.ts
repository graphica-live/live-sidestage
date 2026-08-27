// 本日最高ギフトオーバーレイのスナップショット構築。**サーバー専用**(prisma を引く)。
//
// **単価(diamondCount)比較であってtotalDiamonds(コンボ合計)ではない点が最重要。**
// desktop版のbuildTopGiftSnapshotと同じ基準(1回分の値の最大)を踏襲する。

import { prisma } from "@/lib/prisma";
import { jstDateKey } from "./day-key";
import { fetchDayGifts, type DayGift } from "./gift-day";
import { normalizeOverlayAppearance, OVERLAY_APPEARANCE_DEFAULT, type OverlayAppearance } from "./appearance";

export type TopGiftSnapshot = {
  dayKey: string;
  appearance: OverlayAppearance;
  title: string;
  senderDisplayMode: "latest" | "all";
  glowEnabled: boolean;
  topGift: {
    uniqueId: string;
    nickname: string;
    profileImageUrl: string | null;
    giftId: number;
    giftName: string;
    giftPictureUrl: string | null;
    giftValue: number; // 単価(diamondCount)
    receivedAt: string; // ISO
    senders: string[]; // 同額を送った全員のnickname。最新の送信が末尾に来る時系列順
    latestSender: string;
  } | null;
};

const DEFAULT_TITLE = "本日最高ギフト";

export async function buildTopGiftSnapshot(streamerId: string): Promise<TopGiftSnapshot | null> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: { roomId: true, overlayTopGiftSettings: true },
  });
  if (!streamer || !streamer.roomId) return null;

  const settings = streamer.overlayTopGiftSettings;
  const dayKey = jstDateKey();
  const gifts = await fetchDayGifts(streamer.roomId, dayKey);

  let top: DayGift | null = null;
  for (const g of gifts) {
    if (!top || g.diamondCount > top.diamondCount) top = g;
  }

  let topGift: TopGiftSnapshot["topGift"] = null;
  if (top) {
    // 最高額と同額(diamondCount一致、giftId一致優先)を送った全員を時系列で集める。
    // 重複uniqueIdは最新のみ残す(desktopのsplice挙動を踏襲)。
    const senders: string[] = [];
    for (const g of gifts) {
      if (g.diamondCount !== top.diamondCount) continue;
      if (top.giftId && g.giftId !== top.giftId) continue;
      const label = g.nickname || g.uniqueId;
      const idx = senders.indexOf(label);
      if (idx >= 0) senders.splice(idx, 1);
      senders.push(label);
    }

    topGift = {
      uniqueId: top.uniqueId,
      nickname: top.nickname,
      profileImageUrl: top.profileImageUrl,
      giftId: top.giftId,
      giftName: top.giftName,
      giftPictureUrl: top.giftPictureUrl,
      giftValue: top.diamondCount,
      receivedAt: top.receivedAt.toISOString(),
      senders,
      latestSender: senders[senders.length - 1] ?? (top.nickname || top.uniqueId),
    };
  }

  return {
    dayKey,
    appearance: normalizeOverlayAppearance(settings ?? { ...OVERLAY_APPEARANCE_DEFAULT }),
    title: settings?.title ?? DEFAULT_TITLE,
    senderDisplayMode: settings?.senderDisplayMode === "all" ? "all" : "latest",
    glowEnabled: settings?.glowEnabled ?? true,
    topGift,
  };
}
