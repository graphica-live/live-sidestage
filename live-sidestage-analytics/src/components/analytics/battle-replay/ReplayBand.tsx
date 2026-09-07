"use client";

import type { ReplaySegment } from "@/lib/battle-replay-contract";

/**
 * 画面下部の帯。残り秒数は `showCountdown`(区間の終了を実測できた場合のみ true)のときだけ出す。
 * 帯にしてよい区間かの判定は `isBandSegment`(`replay-select.ts`)。
 */
export function ReplayBand({ segment, elapsedMs }: { segment: ReplaySegment; elapsedMs: number }) {
  const remaining = Math.max(0, Math.ceil((segment.endMs - elapsedMs) / 1000));
  return (
    <div className="replay-band">
      <span>{segment.label}</span>
      {segment.showCountdown ? <span className="replay-cd">残り {remaining}秒</span> : null}
    </div>
  );
}
