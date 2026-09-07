"use client";

import { formatClock } from "./replay-format";

const SPEEDS = [1, 2, 4];

/**
 * 再生コントロール。**トラックは見た目を comp どおりの自前描画にし、操作は
 * その上へ重ねた透明な `<input type="range">` が受ける**(キーボード操作と
 * スクリーンリーダーを自前実装で失わないため)。
 *
 * `onScrubbing` は pointerdown〜pointerup の間だけ true。これを時計へ渡さないと、
 * clock からの反映と controlled value が綱引きしてつまみが戻る。
 */
export function ReplayControls({
  elapsedMs,
  durationMs,
  playing,
  speed,
  tickRatios,
  tickColors,
  onToggle,
  onSeek,
  onSpeed,
  onScrubbing,
}: {
  elapsedMs: number;
  durationMs: number;
  playing: boolean;
  speed: number;
  /** スコアが動いた位置(0〜1)。 */
  tickRatios: number[];
  tickColors: string[];
  onToggle: () => void;
  onSeek: (ms: number) => void;
  onSpeed: (speed: number) => void;
  onScrubbing: (scrubbing: boolean) => void;
}) {
  const ratio = durationMs > 0 ? Math.min(1, Math.max(0, elapsedMs / durationMs)) : 0;
  const percent = `${ratio * 100}%`;

  return (
    <div className="flex items-center gap-[10px] border-t border-row-border bg-panel px-[12px] py-[9px]">
      <button
        type="button"
        onClick={onToggle}
        aria-label={playing ? "一時停止" : "再生"}
        className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-brand text-[12px] text-on-accent"
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button
        type="button"
        onClick={() => onSeek(0)}
        aria-label="先頭へ"
        className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full border border-border bg-transparent text-[11px] text-muted"
      >
        ⇤
      </button>
      <span className="flex-none font-mono text-[11px] tabular-nums text-muted">
        {formatClock(elapsedMs)}
      </span>
      <div className="replay-track bg-border">
        <div className="replay-track-fill bg-brand" style={{ width: percent }} />
        {tickRatios.map((tick, index) => (
          <span
            key={index}
            className="replay-track-tick"
            style={{ left: `${tick * 100}%`, background: tickColors[index] }}
          />
        ))}
        <div className="replay-track-knob bg-brand" style={{ left: percent }} />
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(durationMs))}
          step={100}
          value={Math.round(elapsedMs)}
          aria-label="再生位置"
          onChange={(event) => onSeek(Number(event.target.value))}
          onPointerDown={() => onScrubbing(true)}
          onPointerUp={() => onScrubbing(false)}
          onPointerCancel={() => onScrubbing(false)}
          // pointer capture が外れる経路でも必ず解除する。取り残すと playing のまま
          // 時計だけ止まり、「再生中なのに進まない」状態になる
          onLostPointerCapture={() => onScrubbing(false)}
          onBlur={() => onScrubbing(false)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <span className="flex-none font-mono text-[11px] tabular-nums text-muted">
        {formatClock(durationMs)}
      </span>
      <button
        type="button"
        onClick={() => onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)}
        aria-label="再生速度"
        className="flex-none rounded-[6px] border border-border px-[7px] py-[1px] font-mono text-[11px] text-strong"
      >
        {speed}×
      </button>
    </div>
  );
}
