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
  tiktokUid: string;
  tiktokHandle: string | null;
  nickname: string | null;
  profileImageUrl: string | null;
  total: number;
  qualifiedAt: Date | null;
};

export async function buildOverlaySnapshot(streamerId: string): Promise<OverlaySnapshot | null> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: {
      roomId: true,
      overlayContributionSettings: true,
    },
  });

  if (!streamer || !streamer.roomId) return null;

  const settings = streamer.overlayContributionSettings;
  const displayReference = settings?.displayReference ?? "today";
  const displayDate = settings?.displayDate ?? null;
  const dayKey = resolveOverlayDayKey({ overlayDisplayReference: displayReference, overlayDisplayDate: displayDate });

  // 「貢献しきい値到達順」で並べるため、集計済みの合計ではなくギフト1件ずつを時系列で
  // 積み上げ、各ユーザーが初めて閾値を超えた瞬間(receivedAt)を qualifiedAt として記録する。
  // ギフトデータはTikTokアカウント(roomId)単位で共有される。表示設定はStreamer(閲覧者本人)から読む。
  const gifts = await fetchDayGifts(streamer.roomId, dayKey);

  const tallies = new Map<string, ContributorTally>();

  for (const gift of gifts) {
    // 合算キーは不変のtiktokUid(ハンドル改名で閾値到達判定が割れないため)。
    let tally = tallies.get(gift.tiktokUid);
    if (!tally) {
      tally = {
        tiktokUid: gift.tiktokUid,
        tiktokHandle: gift.tiktokHandle,
        nickname: gift.nickname,
        profileImageUrl: gift.profileImageUrl,
        total: 0,
        qualifiedAt: null,
      };
      tallies.set(gift.tiktokUid, tally);
    }
    tally.tiktokHandle = gift.tiktokHandle;
    tally.nickname = gift.nickname;
    tally.profileImageUrl = gift.profileImageUrl;
    tally.total += gift.totalDiamonds;
    const threshold = settings?.threshold ?? 1000;
    if (tally.qualifiedAt === null && tally.total >= threshold) {
      tally.qualifiedAt = gift.receivedAt;
    }
  }

  const contributors: OverlayContributor[] = Array.from(tallies.values())
    .filter((t): t is ContributorTally & { qualifiedAt: Date } => t.qualifiedAt !== null)
    .sort((a, b) => a.qualifiedAt.getTime() - b.qualifiedAt.getTime())
    .map((t) => ({
      tiktokUid: t.tiktokUid,
      tiktokHandle: t.tiktokHandle,
      nickname: t.nickname,
      profileImageUrl: t.profileImageUrl,
      totalDiamonds: t.total,
    }));

  return {
    dayKey,
    isToday: dayKey === jstDateKey(),
    threshold: settings?.threshold ?? 1000,
    goalCount: settings?.goalCount ?? 5,
    visibleRows: settings?.visibleRows ?? 5,
    nameMaxWidth: settings?.nameMaxWidth ?? 140,
    align: normalizeOverlayAlign(settings?.align ?? "left"),
    headingBackground: normalizeOverlayHeadingBackground(settings?.headingBackground ?? "clear"),
    displaySpeed: clampOverlayDisplaySpeed(settings?.displaySpeed ?? 3),
    qualifiedCount: contributors.length,
    contributors,
  };
}
