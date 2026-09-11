// 貢献ランキングsnapshotの構築とpush。**サーバー専用**(prismaを引く)。
//
// buildOverlaySnapshot(src/lib/overlay/contribution.server.ts)と同じ設計方針だが、
// あちらは「閾値到達者一覧」(OBS用途)、こちらは「全リスナーの合計ランキング」(mobile用途)で
// 集計対象が異なるため、queryGifts(gift-analytics.ts)をベースに別途構築する。

import { prisma } from "@/lib/prisma";
import { queryGifts, type GiftAnalyticsUser } from "@/lib/gift-analytics";
import { jstDateKey } from "@/lib/overlay/day-key";
import { emitChatRankingSnapshot } from "./chat-feed";

export type RankingSnapshotEntity = GiftAnalyticsUser;

export type RankingSnapshot = {
  /** pushで作るのは常に"today"。クライアントは選択中periodと不一致なら破棄する。 */
  period: string;
  dateRange: { start: string; end: string };
  /** サーバー確定順(totalDiamonds降順)。 */
  entities: RankingSnapshotEntity[];
  /** entities と同じ順の tiktokUid 配列。クライアント側の表示順はこれに従う。 */
  order: string[];
  total: { giftCount: number; totalDiamonds: number };
};

/** pushでbuildするランキングのperiod。REST(ranking route.ts)が対応する他periodはpush対象外
 * (クライアントは非一致のsnapshotを破棄し、REST resyncへフォールバックする)。 */
const RANKING_PUSH_PERIOD = "today";

/** route.ts(mobile/analytics/ranking)のsort規則と揃える(順位が食い違わないようにするため)。 */
function sortRankingEntities(users: GiftAnalyticsUser[]): GiftAnalyticsUser[] {
  return [...users].sort((a, b) => {
    if (a.totalDiamonds !== b.totalDiamonds) return b.totalDiamonds - a.totalDiamonds;
    if (a.giftCount !== b.giftCount) return b.giftCount - a.giftCount;
    const ah = a.tiktokHandle ?? "";
    const bh = b.tiktokHandle ?? "";
    return ah < bh ? -1 : ah > bh ? 1 : 0;
  });
}

/**
 * roomId単位の貢献ランキングsnapshotを構築する。**streamerIdではなくroomId基準**
 * (同じroomIdを複数Streamerが共有していても集計結果は1つ)。
 *
 * pushではperiod="today"のみを構築する。それ以外のperiodを見ているクライアントは
 * envelopeのperiod不一致を検知してREST resyncへフォールバックする(Batch01契約)。
 */
export async function buildRankingSnapshot(
  roomId: string,
  period: string = RANKING_PUSH_PERIOD
): Promise<RankingSnapshot | null> {
  if (period !== RANKING_PUSH_PERIOD) return null;

  const room = await prisma.tiktokRoom.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) return null;

  const today = jstDateKey();
  // viewerStreamerIdはqueryGifts内部(aggregateGiftUsers)では未使用(gift-analytics.tsのコメント参照)。
  // pushはviewer(閲覧端末)を持たないためroomIdをプレースホルダとして渡す。
  const { users, total } = await queryGifts(roomId, roomId, { dayKey: { gte: today, lte: today } }, null);
  const sorted = sortRankingEntities(users);

  return {
    period: RANKING_PUSH_PERIOD,
    dateRange: { start: today, end: today },
    entities: sorted,
    order: sorted.map((u) => u.tiktokUid),
    total,
  };
}

interface RankingThrottleEntry {
  timer: NodeJS.Timeout;
  /** このwindow中に追加されたfan-out先。1回のbuild結果を全員へ配る。 */
  streamerIds: Set<string>;
}

// overlay/emit.tsのemitThrottleと同じglobal経由パターン(Next.jsのモジュール再生成をまたいで
// 生存させるため)。**overlayのthrottle Mapを共用しない**(emit.tsのコメントにある既存の教訓と
// 同じ理由: 種類ごとに間引きが競合するのを避ける)。
const g = global as typeof globalThis & {
  __chatRankingThrottle?: Map<string, RankingThrottleEntry>;
};
if (!g.__chatRankingThrottle) g.__chatRankingThrottle = new Map();
const rankingThrottle = g.__chatRankingThrottle;

const RANKING_EMIT_THROTTLE_MS = 500;

/**
 * roomId単位でランキングsnapshotの構築とthrottle(500msトレーリング)を行い、
 * 購読中の各streamerIdの`chat:{streamerId}`ルームへfan-outする。
 *
 * **buildRankingSnapshotの呼び出しはthrottle windowごとに1回だけ**(design-review反映2
 * finding6)。同一roomIdを複数streamerIdが共有していても、DB再集計が購読者数倍にならない。
 *
 * versionはstreamerIdごとに払い出す(Batch03のREST側が`currentVersion("ranking", streamerId)`で
 * streamerId単位に読むため、cutover契約を合わせている。ビルドを1回に絞ることで「roomId単位で
 * 二重集計しない」というfinding6の実質的な要件は満たしつつ、REST/pushのversion名前空間を
 * streamerId単位に統一している — plannerの技術的判断)。
 *
 * ranking snapshotは「最新の全件像を毎回作り直す」設計のため、drop許容(このthrottle自体が
 * 間引く設計であることに加え、io未初期化時もemitChatRankingSnapshot側で単に何もしない)。
 */
export function scheduleRankingSnapshotEmit(roomId: string, streamerIds: string[]): void {
  if (streamerIds.length === 0) return;

  const existing = rankingThrottle.get(roomId);
  if (existing) {
    for (const id of streamerIds) existing.streamerIds.add(id);
    return;
  }

  const entry: RankingThrottleEntry = {
    streamerIds: new Set(streamerIds),
    timer: setTimeout(runThrottledEmit, RANKING_EMIT_THROTTLE_MS),
  };
  rankingThrottle.set(roomId, entry);

  async function runThrottledEmit() {
    rankingThrottle.delete(roomId);
    const targets = Array.from(entry.streamerIds);
    if (targets.length === 0) return;

    try {
      const snapshot = await buildRankingSnapshot(roomId);
      if (!snapshot) return;
      for (const streamerId of targets) {
        await emitChatRankingSnapshot(streamerId, snapshot).catch((err) =>
          console.error("[chat-ranking] emit error:", err)
        );
      }
    } catch (err) {
      console.error("[chat-ranking] build error:", err);
    }
  }
}

/** テスト専用。throttle状態がテスト間で持ち越されるとemit回数が合わなくなる。 */
export function __resetChatRankingThrottleForTest(): void {
  for (const entry of rankingThrottle.values()) clearTimeout(entry.timer);
  rankingThrottle.clear();
}
