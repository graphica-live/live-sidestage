// TikTok接続の区間ログ(RoomConnectionInterval)の記録と、それを使った
// バトル確定処理向けの捕捉率(captureStatus/captureCoverage)算出。
//
// 書き込み側(open/close/heartbeat)はWorkerプロセス(tiktok-listener.ts)から、
// 同一roomIdについて呼び出し順が保証された状態(createWriteQueueで直列化)で呼ばれる前提。
// このモジュール自身はDB操作の冪等性だけを担保する(呼び出し順序の保証はしない)。

import { prisma } from "@/lib/prisma";

/**
 * lastHeartbeatAtがこの時間以上更新されていない開いたまま(endedAt: null)の区間は、
 * Worker crash等で終了イベントを記録できなかったとみなし、lastHeartbeatAt時点で
 * 打ち切られたものとして扱う。
 */
const HEARTBEAT_STALE_MS = 90_000;

/** 5分バトルで無視できる程度(6秒)の欠落までは"complete"として扱う。 */
const COMPLETE_COVERAGE_THRESHOLD = 0.98;

export type CaptureStatus = "complete" | "partial" | "unavailable";

/**
 * 新しい接続区間を開始する。idは呼び出し側(tiktok-listener.ts)が生成して渡す
 * (DBのデフォルト生成を待つと、その間に接続が切れた場合にidをどの行に書き戻すべきか
 * 決められなくなるため。詳細はtiktok-listener.tsのopen/close呼び出し箇所のコメント参照)。
 *
 * `startedAt`も呼び出し側の実イベント発生時刻を渡してもらう(このモジュール内で
 * `new Date()`を取ると、roomId単位に直列化されたキューの実行待ちで遅延した分だけ
 * 区間境界が実際のイベント時刻より後ろへずれ、captureCoverageを誤差させるため)。
 */
export async function openConnectionInterval(id: string, roomId: string, startedAt: Date): Promise<void> {
  try {
    await prisma.roomConnectionInterval.create({
      data: { id, roomId, startedAt },
    });
  } catch (err) {
    console.error("[room-connection-log] openConnectionInterval failed", { id, roomId, err });
  }
}

/**
 * 接続区間を終了する。`updateMany({ where: { id, endedAt: null } })`にすることで、
 * 既に終了済み(2重呼び出し)の行を再度書き換えない(冪等)。
 */
export async function closeConnectionInterval(
  id: string,
  disconnectReason: string | null,
  endedAt: Date
): Promise<void> {
  try {
    await prisma.roomConnectionInterval.updateMany({
      where: { id, endedAt: null },
      data: { endedAt, disconnectReason },
    });
  } catch (err) {
    console.error("[room-connection-log] closeConnectionInterval failed", { id, err });
  }
}

/**
 * 生存確認(30秒heartbeat)を反映する。`endedAt: null`の行だけを対象にすることで、
 * 既に終了済みの行のlastHeartbeatAtを誤って更新しない(冪等)。
 */
export async function touchConnectionIntervalHeartbeat(id: string, at: Date): Promise<void> {
  try {
    await prisma.roomConnectionInterval.updateMany({
      where: { id, endedAt: null },
      data: { lastHeartbeatAt: at },
    });
  } catch (err) {
    console.error("[room-connection-log] touchConnectionIntervalHeartbeat failed", { id, err });
  }
}

export type ConnectionIntervalRow = {
  startedAt: Date;
  endedAt: Date | null;
  lastHeartbeatAt: Date;
};

/**
 * 接続区間群を[windowStart, windowEnd]へ重ね、被覆率を算出する純関数(DBアクセスなし)。
 *
 * endedAtがnull(接続中、またはWorker crashで終了イベントを記録できなかった)の行は、
 * lastHeartbeatAtがHEARTBEAT_STALE_MS以上更新停止していればその時刻で打ち切ったとみなし、
 * そうでなければ(まだ生きている)windowEndまで継続しているとみなす。
 */
export function coverageFromIntervals(
  rows: ConnectionIntervalRow[],
  windowStart: Date,
  windowEnd: Date,
  now: Date
): { status: CaptureStatus; coverage: number } {
  const windowMs = windowEnd.getTime() - windowStart.getTime();
  if (windowMs <= 0) return { status: "unavailable", coverage: 0 };

  const segments = rows
    .map((row) => {
      const effectiveEndMs = row.endedAt
        ? row.endedAt.getTime()
        : now.getTime() - row.lastHeartbeatAt.getTime() > HEARTBEAT_STALE_MS
          ? row.lastHeartbeatAt.getTime()
          : windowEnd.getTime();
      const start = Math.max(row.startedAt.getTime(), windowStart.getTime());
      const end = Math.min(effectiveEndMs, windowEnd.getTime());
      return end > start ? ([start, end] as const) : null;
    })
    .filter((s): s is readonly [number, number] => s !== null)
    .sort((a, b) => a[0] - b[0]);

  let coveredMs = 0;
  let mergedStart = -Infinity;
  let mergedEnd = -Infinity;
  for (const [start, end] of segments) {
    if (start > mergedEnd) {
      if (mergedEnd > mergedStart) coveredMs += mergedEnd - mergedStart;
      mergedStart = start;
      mergedEnd = end;
    } else if (end > mergedEnd) {
      mergedEnd = end;
    }
  }
  if (mergedEnd > mergedStart) coveredMs += mergedEnd - mergedStart;

  const coverage = Math.min(1, coveredMs / windowMs);
  const status: CaptureStatus =
    coveredMs <= 0 ? "unavailable" : coverage >= COMPLETE_COVERAGE_THRESHOLD ? "complete" : "partial";
  return { status, coverage };
}

/** roomIdの接続区間をDBから読み、windowに対する捕捉率を算出する。 */
export async function computeCaptureCoverage(
  roomId: string,
  windowStart: Date,
  windowEnd: Date,
  now: Date
): Promise<{ status: CaptureStatus; coverage: number }> {
  const rows = await prisma.roomConnectionInterval.findMany({
    where: {
      roomId,
      startedAt: { lt: windowEnd },
      OR: [{ endedAt: { gte: windowStart } }, { endedAt: null }],
    },
    select: { startedAt: true, endedAt: true, lastHeartbeatAt: true },
  });
  return coverageFromIntervals(rows, windowStart, windowEnd, now);
}
