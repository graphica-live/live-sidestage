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
  durationMs,
  transitionMs = 0,
  boosting = false,
}: {
  /** anchor ごとの累積スコア(文字列。桁が大きいので BigInt 経由で数値化する)。 */
  scores: string[];
  colors: string[];
  elapsedMs: number;
  /** バトルの尺。中央の時計は**残り時間のカウントダウン**(実バトル画面と同じ)。 */
  durationMs: number;
  /**
   * 幅が変わるときの補間時間。**再生速度で割った値を親が渡す**(4倍速や自動早送りで
   * 等速と同じ時間をかけると、伸びきる前に次のギフトが来て遅延に見えるため)。
   * シーク中は 0 を渡して即時反映にする。
   */
  transitionMs?: number;
  /** 自動早送り中。時計チップを点滅させて、時間が速く進んでいることを示す。 */
  boosting?: boolean;
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
          style={{
            background: colors[index],
            width: `${widths[index]}%`,
            transitionDuration: `${transitionMs}ms`,
          }}
        >
          {value.toLocaleString("ja-JP")}
        </div>
      ))}
      <div className={boosting ? "replay-clock replay-clock--boost" : "replay-clock"}>
        {formatClock(Math.max(0, durationMs - elapsedMs))}
      </div>
    </div>
  );
}
