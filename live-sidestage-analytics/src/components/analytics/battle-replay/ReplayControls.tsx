"use client";

import { formatClock } from "./replay-format";
import { QUIET_SKIP_BOOST } from "./replay-select";

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
  quietSkip,
  quietSkipping,
  onToggle,
  onSeek,
  onSpeed,
  onScrubbing,
  onQuietSkip,
}: {
  elapsedMs: number;
  durationMs: number;
  playing: boolean;
  speed: number;
  /** スコアが動いた位置(0〜1)。 */
  tickRatios: number[];
  tickColors: string[];
  /** 無風区間の自動早送りが有効か。 */
  quietSkip: boolean;
  /** **いま無風区間を早送り中か。** 残り時間の点滅がこの状態の唯一の手がかりになる。 */
  quietSkipping: boolean;
  onToggle: () => void;
  onSeek: (ms: number) => void;
  onSpeed: (speed: number) => void;
  onScrubbing: (scrubbing: boolean) => void;
  onQuietSkip: (enabled: boolean) => void;
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
      <span
        // 残り時間。**経過時間の再掲ではない**(左のラベルが経過)。自動早送り中は
        // 「いま飛ばしている」ことがここでしか判らないので点滅させる。
        className={`flex-none font-mono text-[11px] tabular-nums ${
          quietSkipping ? "animate-pulse text-strong motion-reduce:animate-none" : "text-muted"
        }`}
        aria-label="残り時間"
      >
        -{formatClock(Math.max(0, durationMs - elapsedMs))}
      </span>
      <button
        type="button"
        onClick={() => onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)}
        aria-label="再生速度"
        className={`flex-none rounded-[6px] border px-[7px] py-[1px] font-mono text-[11px] ${
          // 自動早送り中は**実効倍率**を出す。無風区間は5〜10秒と短く、点滅だけだと
          // 早送りが効いているのか判らない。
          quietSkipping
            ? "animate-pulse border-brand text-brand motion-reduce:animate-none"
            : "border-border text-strong"
        }`}
      >
        {quietSkipping ? `${speed * QUIET_SKIP_BOOST}×` : `${speed}×`}
      </button>
      <button
        type="button"
        onClick={() => onQuietSkip(!quietSkip)}
        aria-label="自動早送り"
        aria-pressed={quietSkip}
        title="ギフトが途切れた区間を自動で早送りする（飛ばさずに速く流す）"
        className={`flex-none rounded-[6px] border px-[7px] py-[1px] font-mono text-[11px] ${
          quietSkip ? "border-brand bg-brand text-on-accent" : "border-border text-muted"
        }`}
      >
        ⏩Auto
      </button>
    </div>
  );
}
