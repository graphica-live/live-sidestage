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

/**
 * 接続が欠けていた区間で失われた公式スコアが、この割合・この絶対値の両方を下回るなら
 * 「実データは欠けていない」とみなして"complete"へ格上げする(refineCaptureByScore)。
 *
 * 相手roomはバトル開始検知後にオンデマンド接続するため窓頭を8〜11秒必ず取り逃すが、
 * 本番実測(2026-09-06)ではその区間のスコア増分は最終スコアの0.03〜0.4%(絶対値3〜9)で、
 * ギフト明細の取りこぼしは1件も無かった。時間被覆率だけで判定すると、この構造的な遅れが
 * すべて"partial"(UI表示「一部」)になり、実データが欠けていないのに欠損を示唆してしまう。
 *
 * 絶対値と割合のANDにしているのは、最終スコアが極小のバトル(合計10程度)で割合条件だけだと
 * +3が30%になって格上げされず、逆に高スコアのバトルで絶対値条件だけだと実際の取りこぼし99を
 * 見逃すため。
 */
const NEGLIGIBLE_MISSED_SCORE_RATIO = 0.01;
const NEGLIGIBLE_MISSED_SCORE_ABS = 100;

export type CaptureStatus = "complete" | "partial" | "unavailable";

/** 接続が無かった区間(窓頭・区間の合間・窓尾)。 */
export type CaptureGap = { startMs: number; endMs: number };

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
): { status: CaptureStatus; coverage: number; gaps: CaptureGap[] } {
  const windowMs = windowEnd.getTime() - windowStart.getTime();
  if (windowMs <= 0) return { status: "unavailable", coverage: 0, gaps: [] };

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

  const merged: [number, number][] = [];
  for (const [start, end] of segments) {
    const last = merged[merged.length - 1];
    if (!last || start > last[1]) merged.push([start, end]);
    else if (end > last[1]) last[1] = end;
  }

  let coveredMs = 0;
  for (const [start, end] of merged) coveredMs += end - start;

  const gaps: CaptureGap[] = [];
  let cursor = windowStart.getTime();
  for (const [start, end] of merged) {
    if (start > cursor) gaps.push({ startMs: cursor, endMs: start });
    cursor = end;
  }
  if (cursor < windowEnd.getTime()) gaps.push({ startMs: cursor, endMs: windowEnd.getTime() });

  const coverage = Math.min(1, coveredMs / windowMs);
  const status: CaptureStatus =
    coveredMs <= 0 ? "unavailable" : coverage >= COMPLETE_COVERAGE_THRESHOLD ? "complete" : "partial";
  return { status, coverage, gaps };
}

/**
 * 接続の欠落区間で実際に失われた公式スコアを見積もり、無視できる量なら"complete"へ格上げする。
 *
 * `scorePoints`は`TiktokBattleArmiesSnapshot`(TikTokが配信する公式スコアの時系列)のうち、
 * そのバトル・その参加者(tiktokUid)ぶんを`occurredAt`昇順で渡す。**このスナップショットは
 * 全陣営分が自roomの受信だけで届く**ので、相手roomへ接続していない区間のスコアも分かる。
 *
 * 窓頭のgapは「gap以前の既知スコアが無い」状態になるが、バトル開始時のスコアは0なので0起点で
 * よい(本番実測でwindowStartより前のスナップショットは1件も存在せず、各バトルの初回観測値も
 * 最大33=誤差レベル。再戦でスコアが持ち越される形式は確認されていない)。仮に持ち越しが起きても
 * 過大評価(=partialのまま)側へ倒れるので、欠損を見逃す方向へは壊れない。
 *
 * 判定に必要なスナップショットが無い場合は`base`をそのまま返す(`missedScore: null`)。
 * **格上げのみで格下げはしない** — coverageが高いのにスコアが大きく欠けているケースは
 * スナップショット側の欠測とも区別できないため、既存の判定を尊重する。
 */
export function refineCaptureByScore(
  base: { status: CaptureStatus; coverage: number; gaps: CaptureGap[] },
  scorePoints: { atMs: number; score: number }[],
  finalScore: number | null
): { status: CaptureStatus; coverage: number; missedScore: number | null } {
  const rest = { coverage: base.coverage };
  if (base.status === "complete" || base.gaps.length === 0) {
    return { ...rest, status: base.status, missedScore: 0 };
  }
  if (base.status === "unavailable" || scorePoints.length === 0) {
    return { ...rest, status: base.status, missedScore: null };
  }

  const points = [...scorePoints].sort((a, b) => a.atMs - b.atMs);
  let missedScore = 0;
  for (const gap of base.gaps) {
    const before = points.filter((p) => p.atMs <= gap.startMs).pop();
    const after = points.find((p) => p.atMs >= gap.endMs);
    const startScore = before?.score ?? 0;
    // gap終了後の観測が無いのは窓尾のgap。バトル最終スコアを終端として使う。
    const endScore = after?.score ?? finalScore;
    if (endScore === null) return { ...rest, status: base.status, missedScore: null };
    missedScore += Math.max(0, endScore - startScore);
  }

  const negligible =
    missedScore === 0 ||
    (missedScore < NEGLIGIBLE_MISSED_SCORE_ABS &&
      finalScore !== null &&
      finalScore > 0 &&
      missedScore / finalScore < NEGLIGIBLE_MISSED_SCORE_RATIO);

  return { ...rest, status: negligible ? "complete" : base.status, missedScore };
}

/** roomIdの接続区間をDBから読み、windowに対する捕捉率を算出する。 */
export async function computeCaptureCoverage(
  roomId: string,
  windowStart: Date,
  windowEnd: Date,
  now: Date
): Promise<{ status: CaptureStatus; coverage: number; gaps: CaptureGap[] }> {
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
