import crypto from "crypto";
import type { Server as SocketIOServer } from "socket.io";
import { prisma } from "@/lib/prisma";

export function jstDateKey(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// YYYY-MM-DD 文字列を起点にoffsetDays日シフトする(「今日」からの相対計算ではない点がjstDateKeyと異なる)。
export function shiftDayKey(dayKey: string, offsetDays: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

type OverlayDisplaySettings = {
  overlayDisplayReference: string;
  overlayDisplayDate: string | null;
};

export const OVERLAY_HEADING_BACKGROUNDS = ["clear", "crystal-blue", "sakura-pink", "black", "white"] as const;
export type OverlayHeadingBackground = (typeof OVERLAY_HEADING_BACKGROUNDS)[number];

// overlayDisplayReference が "fixed" なら固定された日付を、"today" なら常に現在のJST日付を返す。
// これにより「翌日ボタンで今日に追いつくと自動的に自動追従へ戻る」挙動を実現する。
export function resolveOverlayDayKey(streamer: OverlayDisplaySettings): string {
  if (streamer.overlayDisplayReference === "fixed") {
    return streamer.overlayDisplayDate || jstDateKey();
  }
  return jstDateKey();
}

export function inferOverlayDisplayReference(dayKey: string): "today" | "fixed" {
  return dayKey === jstDateKey() ? "today" : "fixed";
}

export async function resolveStreamerIdByOverlayToken(
  token: string | null | undefined
): Promise<string | null> {
  if (!token) return null;

  const streamer = await prisma.streamer.findUnique({
    where: { overlayToken: token },
    select: { id: true, verified: true },
  });

  if (!streamer?.verified) return null;

  return streamer.id;
}

export function generateOverlayToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export type OverlayContributor = {
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  totalDiamonds: number;
};

export type OverlaySnapshot = {
  dayKey: string;
  threshold: number;
  goalCount: number;
  visibleRows: number;
  nameMaxWidth: number;
  align: "left" | "right";
  headingBackground: OverlayHeadingBackground;
  qualifiedCount: number;
  contributors: OverlayContributor[];
};

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
      overlayDisplayReference: true,
      overlayDisplayDate: true,
      overlayThreshold: true,
      overlayGoalCount: true,
      overlayVisibleRows: true,
      overlayNameMaxWidth: true,
      overlayAlign: true,
      overlayHeadingBackground: true,
    },
  });

  if (!streamer) return null;

  const dayKey = resolveOverlayDayKey(streamer);

  // 「貢献しきい値到達順」で並べるため、集計済みの合計ではなくギフト1件ずつを時系列で
  // 積み上げ、各ユーザーが初めて閾値を超えた瞬間(receivedAt)を qualifiedAt として記録する。
  const gifts = await prisma.gift.findMany({
    where: { streamerId, dayKey },
    orderBy: { receivedAt: "asc" },
    select: {
      uniqueId: true,
      nickname: true,
      profileImageUrl: true,
      totalDiamonds: true,
      receivedAt: true,
    },
  });

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
    threshold: streamer.overlayThreshold,
    goalCount: streamer.overlayGoalCount,
    visibleRows: streamer.overlayVisibleRows,
    nameMaxWidth: streamer.overlayNameMaxWidth,
    align: streamer.overlayAlign === "right" ? "right" : "left",
    headingBackground: OVERLAY_HEADING_BACKGROUNDS.includes(
      streamer.overlayHeadingBackground as OverlayHeadingBackground
    )
      ? (streamer.overlayHeadingBackground as OverlayHeadingBackground)
      : "clear",
    qualifiedCount: contributors.length,
    contributors,
  };
}

// server.js が生成した socket.io サーバーへの参照。Next.jsのモジュール再生成をまたいで
// 生存させるため、tiktok-listener.ts の __tiktokListeners と同じ global 経由のパターンを使う。
const g = global as typeof globalThis & {
  __io?: SocketIOServer;
  __overlayEmitThrottle?: Map<string, { timer: NodeJS.Timeout; queued: boolean }>;
};
if (!g.__overlayEmitThrottle) g.__overlayEmitThrottle = new Map();
const emitThrottle = g.__overlayEmitThrottle;

const OVERLAY_EMIT_THROTTLE_MS = 500;

// streamerIdごとにtrailing throttle(500ms)してsnapshotをpushする。コンボギフト連打中は
// tiktok-listener.tsのsaveGift()がdelta>0のたびに呼ばれるため、間引かないと連打中に
// 1秒間へ何度もDB再集計とsocket送信が走ってしまう。
export async function emitOverlaySnapshot(streamerId: string): Promise<void> {
  const existing = emitThrottle.get(streamerId);
  if (existing) {
    existing.queued = true;
    return;
  }

  const entry: { timer: NodeJS.Timeout; queued: boolean } = {
    queued: false,
    timer: setTimeout(runThrottledEmit, OVERLAY_EMIT_THROTTLE_MS),
  };
  emitThrottle.set(streamerId, entry);

  async function runThrottledEmit() {
    try {
      const snapshot = await buildOverlaySnapshot(streamerId);
      if (snapshot) {
        g.__io?.to(`overlay:${streamerId}`).emit("overlay:contribution:snapshot", snapshot);
      }
    } catch (err) {
      console.error("[overlay] emit error:", err);
    } finally {
      if (entry.queued) {
        entry.queued = false;
        entry.timer = setTimeout(runThrottledEmit, OVERLAY_EMIT_THROTTLE_MS);
      } else {
        emitThrottle.delete(streamerId);
      }
    }
  }
}
