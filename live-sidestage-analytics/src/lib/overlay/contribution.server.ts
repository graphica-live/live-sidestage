// 貢献リストオーバーレイのスナップショット構築。**サーバー専用**(prisma を引く)。
// クライアントからは import しないこと。型と定数は contracts.ts 側にある。

import { prisma } from "@/lib/prisma";
import {
  clampOverlayDisplaySpeed,
  normalizeOverlayAlign,
  normalizeOverlayHeadingBackground,
  type OverlayContributor,
  type OverlaySnapshot,
} from "./contracts";
import { jstDateKey, resolveOverlayDayKey } from "./day-key";
import { fetchDayGifts } from "./gift-day";

type ContributorTally = {
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  total: number;
  qualifiedAt: Date | null;
};

export async function buildOverlaySnapshot(streamerId: string): Promise<OverlaySnapshot | null> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: {
      roomId: true,
      overlayDisplayReference: true,
      overlayDisplayDate: true,
      overlayThreshold: true,
      overlayGoalCount: true,
      overlayVisibleRows: true,
      overlayNameMaxWidth: true,
      overlayAlign: true,
      overlayHeadingBackground: true,
      overlayDisplaySpeed: true,
    },
  });

  if (!streamer || !streamer.roomId) return null;

  const dayKey = resolveOverlayDayKey(streamer);

  // 「貢献しきい値到達順」で並べるため、集計済みの合計ではなくギフト1件ずつを時系列で
  // 積み上げ、各ユーザーが初めて閾値を超えた瞬間(receivedAt)を qualifiedAt として記録する。
  // ギフトデータはTikTokアカウント(roomId)単位で共有される。表示設定はStreamer(閲覧者本人)から読む。
  const gifts = await fetchDayGifts(streamer.roomId, dayKey);

  const tallies = new Map<string, ContributorTally>();

  for (const gift of gifts) {
    let tally = tallies.get(gift.uniqueId);
    if (!tally) {
      tally = {
        uniqueId: gift.uniqueId,
        nickname: gift.nickname,
        profileImageUrl: gift.profileImageUrl,
        total: 0,
        qualifiedAt: null,
      };
      tallies.set(gift.uniqueId, tally);
    }
    tally.nickname = gift.nickname;
    tally.profileImageUrl = gift.profileImageUrl;
    tally.total += gift.totalDiamonds;
    if (tally.qualifiedAt === null && tally.total >= streamer.overlayThreshold) {
      tally.qualifiedAt = gift.receivedAt;
    }
  }

  const contributors: OverlayContributor[] = Array.from(tallies.values())
    .filter((t): t is ContributorTally & { qualifiedAt: Date } => t.qualifiedAt !== null)
    .sort((a, b) => a.qualifiedAt.getTime() - b.qualifiedAt.getTime())
    .map((t) => ({
      uniqueId: t.uniqueId,
      nickname: t.nickname,
      profileImageUrl: t.profileImageUrl,
      totalDiamonds: t.total,
    }));

  return {
    dayKey,
    isToday: dayKey === jstDateKey(),
    threshold: streamer.overlayThreshold,
    goalCount: streamer.overlayGoalCount,
    visibleRows: streamer.overlayVisibleRows,
    nameMaxWidth: streamer.overlayNameMaxWidth,
    align: normalizeOverlayAlign(streamer.overlayAlign),
    headingBackground: normalizeOverlayHeadingBackground(streamer.overlayHeadingBackground),
    displaySpeed: clampOverlayDisplaySpeed(streamer.overlayDisplaySpeed),
    qualifiedCount: contributors.length,
    contributors,
  };
}
