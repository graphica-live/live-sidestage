// Like貢献通知オーバーレイのスナップショット構築。**サーバー専用**(prisma を引く)。
//
// 通知本体(誰が何タップ目に到達したか)はsnapshotではなくad-hoc event(emit.tsの
// emitLikeMilestone)で個別配信する。ここが返すのは表示設定のみ。

import { prisma } from "@/lib/prisma";
import { normalizeOverlayAppearance, OVERLAY_APPEARANCE_DEFAULT, type OverlayAppearance } from "./appearance";

export type LikeContributionSettings = {
  interval: number;
  soundVolume: number;
  soundKey: string | null;
};

export type LikeContributionSnapshot = {
  appearance: OverlayAppearance;
  title: string;
  interval: number;
  soundVolume: number;
  balloonDesignKey: string;
  countFontSize: number;
  nameFontSize: number;
};

const DEFAULT_TITLE = "Likeありがとう！";
const DEFAULT_INTERVAL = 50;
const DEFAULT_SOUND_VOLUME = 100;
const DEFAULT_BALLOON_DESIGN_KEY = "dark-glass";
const DEFAULT_COUNT_FONT_SIZE = 42;
const DEFAULT_NAME_FONT_SIZE = 34;

export async function loadLikeContributionSettings(streamerId: string) {
  return prisma.overlayLikeContributionSettings.findUnique({ where: { streamerId } });
}

export async function buildLikeContributionSnapshot(streamerId: string): Promise<LikeContributionSnapshot | null> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: { roomId: true, overlayLikeContributionSettings: true },
  });
  if (!streamer || !streamer.roomId) return null;

  const settings = streamer.overlayLikeContributionSettings;
  return {
    appearance: normalizeOverlayAppearance(settings ?? { ...OVERLAY_APPEARANCE_DEFAULT }),
    title: settings?.title ?? DEFAULT_TITLE,
    interval: settings?.interval ?? DEFAULT_INTERVAL,
    soundVolume: settings?.soundVolume ?? DEFAULT_SOUND_VOLUME,
    balloonDesignKey: settings?.balloonDesignKey ?? DEFAULT_BALLOON_DESIGN_KEY,
    countFontSize: settings?.countFontSize ?? DEFAULT_COUNT_FONT_SIZE,
    nameFontSize: settings?.nameFontSize ?? DEFAULT_NAME_FONT_SIZE,
  };
}
