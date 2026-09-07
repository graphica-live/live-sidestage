"use client";

import { formatClock } from "./replay-format";

/** 全員 0 のときは等分にする(幅 0 のセグメントが並ぶと色が消えるため)。 */
function widthsOf(scores: number[]): number[] {
  const total = scores.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return scores.map(() => 100 / Math.max(1, scores.length));
  return scores.map((v) => (v / total) * 100);
}

export function ReplayScoreBar({
  scores,
  colors,
  elapsedMs,
}: {
  /** anchor ごとの累積スコア(文字列。桁が大きいので BigInt 経由で数値化する)。 */
  scores: string[];
  colors: string[];
  elapsedMs: number;
}) {
  const numeric = scores.map((s) => {
    try {
      return Number(BigInt(s));
    } catch {
      return 0;
    }
  });
  const widths = widthsOf(numeric);
  return (
    <div className="replay-scorebar">
      {numeric.map((value, index) => (
        <div
          key={index}
          className={index === numeric.length - 1 ? "replay-seg replay-seg--right" : "replay-seg"}
          style={{ background: colors[index], width: `${widths[index]}%` }}
        >
          {value.toLocaleString("ja-JP")}
        </div>
      ))}
      <div className="replay-clock">{formatClock(elapsedMs)}</div>
    </div>
  );
}
