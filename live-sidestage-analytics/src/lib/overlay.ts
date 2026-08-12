import crypto from "crypto";
import type { Server as SocketIOServer } from "socket.io";
import { prisma } from "@/lib/prisma";
import { queryGifts, type GiftAnalyticsUser } from "@/lib/gift-analytics";

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

export type OverlayContributor = Pick<
  GiftAnalyticsUser,
  "uniqueId" | "nickname" | "profileImageUrl" | "totalDiamonds"
>;

export type OverlaySnapshot = {
  dayKey: string;
  threshold: number;
  goalCount: number;
  qualifiedCount: number;
  contributors: OverlayContributor[];
};

export async function buildOverlaySnapshot(streamerId: string): Promise<OverlaySnapshot | null> {
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: {
      overlayDisplayReference: true,
      overlayDisplayDate: true,
      overlayThreshold: true,
      overlayGoalCount: true,
    },
  });

  if (!streamer) return null;

  const dayKey = resolveOverlayDayKey(streamer);
  const { users } = await queryGifts(streamerId, { dayKey: { gte: dayKey, lte: dayKey } });

  const contributors: OverlayContributor[] = users
    .filter((u) => u.totalDiamonds >= streamer.overlayThreshold)
    .sort((a, b) => b.totalDiamonds - a.totalDiamonds)
    .map((u) => ({
      uniqueId: u.uniqueId,
      nickname: u.nickname,
      profileImageUrl: u.profileImageUrl,
      totalDiamonds: u.totalDiamonds,
    }));

  return {
    dayKey,
    threshold: streamer.overlayThreshold,
    goalCount: streamer.overlayGoalCount,
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
