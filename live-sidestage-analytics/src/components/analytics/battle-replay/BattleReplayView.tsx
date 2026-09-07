"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BATTLE_REPLAY_VERSION,
  type BattleReplayPayload,
} from "@/lib/battle-replay-contract";
import { assignFactionColors, FALLBACK_COLOR } from "../battle-colors";
import { buildStageLayout } from "./replay-layout";
import { buildCards, contributorsAt } from "./replay-select";
import { ReplayContributorBoard } from "./ReplayContributorBoard";
import { ReplayControls } from "./ReplayControls";
import { ReplayStage } from "./ReplayStage";
import { useReplayClock } from "./useReplayClock";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: BattleReplayPayload };

/**
 * 再生画面。**時計 state はこのコンポーネントの内側に閉じる。**
 * モーダル側に置くと、隠している貢献者列まで 30Hz で再レンダーされる。
 */
export function BattleReplayView({
  replayUrl,
  onDurationMs,
}: {
  replayUrl: string;
  /** ヘッダの副題(尺)のために、読み込めたペイロードの長さを1回だけ親へ渡す。 */
  onDurationMs?: (durationMs: number) => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // 依存配列へ直接入れると、親が inline 関数を渡した瞬間に再 fetch が走る。
  const onDurationRef = useRef(onDurationMs);
  onDurationRef.current = onDurationMs;

  useEffect(() => {
    let aborted = false;
    setState({ status: "loading" });
    fetch(replayUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as BattleReplayPayload;
      })
      .then((payload) => {
        if (aborted) return;
        if (payload.version !== BATTLE_REPLAY_VERSION) {
          setState({ status: "error", message: "再生データの形式が更新されています。画面を再読み込みしてください。" });
          return;
        }
        setState({ status: "ready", payload });
        onDurationRef.current?.(payload.durationMs);
      })
      .catch(() => {
        if (aborted) return;
        setState({ status: "error", message: "再生データを読み込めませんでした。" });
      });
    return () => {
      aborted = true;
    };
  }, [replayUrl, attempt]);

  // **loading と error でもステージの高さを保つ。** 中身だけ差し替えないと、モーダルの
  // 高さが読み込みの前後で跳ね、下のコントロール・貢献者ボードが飛ぶ。
  if (state.status !== "ready") {
    return (
      <div className="replay-stage flex min-h-[320px] flex-col items-center justify-center gap-3 px-4 py-10 text-center text-sm">
        {state.status === "loading" ? (
          <>
            <div className="h-[26px] w-full max-w-[420px] animate-pulse rounded-[4px] bg-white/10" />
            <div className="h-[160px] w-full max-w-[420px] animate-pulse rounded-[6px] bg-white/[0.07]" />
            <span className="text-[11px] text-stage-muted">再生データを読み込み中…</span>
          </>
        ) : (
          <>
            <span className="text-stage-muted">{state.message}</span>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="rounded-[8px] border border-white/20 px-[10px] py-[3px] text-[12px] text-stage-text"
            >
              再試行
            </button>
          </>
        )}
      </div>
    );
  }
  return <ReplayPlayer payload={state.payload} />;
}

function ReplayPlayer({ payload }: { payload: BattleReplayPayload }) {
  const clock = useReplayClock(payload.durationMs);
  const cards = useMemo(() => buildCards(payload), [payload]);

  // 再生ボタンを押して入ってきた画面なので、開いた時点から動かす(もう一度押させない)
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    clock.play();
  }, [clock]);

  const layout = useMemo(() => buildStageLayout(payload), [payload]);

  const colorByAnchor = useMemo(() => {
    const byTeam = assignFactionColors(
      payload.teams.map((team) => ({
        index: team.index,
        isSelf: team.isSelf,
        score: team.officialScore,
      }))
    );
    return payload.teams.flatMap((team) =>
      team.participants.map(() => byTeam.get(team.index) ?? FALLBACK_COLOR)
    );
  }, [payload]);

  // スコア点はバトル1本で数千件あるので、そのまま刻むとトラックが塗り潰しになる。
  // 同じ位置(トラック幅の1.5%刻み)へ落ちる点は1本にまとめる。
  const ticks = useMemo(() => {
    if (payload.durationMs <= 0) return [];
    const seen = new Set<number>();
    const result: { ratio: number; anchorIndex: number }[] = [];
    for (const point of payload.scorePoints) {
      const ratio = Math.min(1, point.t / payload.durationMs);
      const slot = Math.round(ratio * 66);
      if (seen.has(slot)) continue;
      seen.add(slot);
      result.push({ ratio, anchorIndex: point.a });
    }
    return result;
  }, [payload]);
  const tickRatios = useMemo(() => ticks.map((tick) => tick.ratio), [ticks]);
  const tickColors = useMemo(
    () => ticks.map((tick) => colorByAnchor[tick.anchorIndex] ?? FALLBACK_COLOR),
    [ticks, colorByAnchor]
  );

  const contributors = contributorsAt(payload, cards, clock.elapsedMs);
  const opening = payload.segments.find((segment) => segment.kind === "opening");

  return (
    <div className="flex flex-col">
      <ReplayStage
        payload={payload}
        layout={layout}
        cards={cards}
        colorByAnchor={colorByAnchor}
        elapsedMs={clock.elapsedMs}
      />

      <div className="grid grid-cols-1 gap-px border-t border-row-border bg-row-border">
        <div className="flex flex-col gap-[7px] bg-panel px-[12px] py-[10px]">
          <h4 className="m-0 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            <span>この時点の貢献者</span>
            {/* 並びが右ほど上位であることを見出しの右端で明示する(row-reverse の補助) */}
            <span className="tracking-[0.04em]">上位 ➡</span>
          </h4>
          <ReplayContributorBoard
            contributors={contributors}
            senders={payload.senders}
            colorByAnchor={colorByAnchor}
          />
        </div>
      </div>

      <ReplayControls
        elapsedMs={clock.elapsedMs}
        durationMs={payload.durationMs}
        playing={clock.playing}
        speed={clock.speed}
        tickRatios={tickRatios}
        tickColors={tickColors}
        onToggle={clock.toggle}
        onSeek={clock.seek}
        onSpeed={clock.setSpeed}
        onScrubbing={clock.setScrubbing}
      />

      <div className="flex flex-wrap gap-[6px] border-t border-row-border px-[12px] py-[9px]">
        {payload.opponentGiftsMissing ? (
          <Chip warn>相手陣営のギフト明細は記録なし(片側のみ再生)</Chip>
        ) : null}
        {payload.truncated ? <Chip warn>ギフト件数が上限を超えたため後半を省略</Chip> : null}
        {opening?.confidence === "inferred" && opening.multiplier !== null ? (
          <Chip>初回ボーナス: ×{opening.multiplier}(推定)</Chip>
        ) : null}
        {!opening ? <Chip>初回ボーナス倍率: 記録なし</Chip> : null}
      </div>
    </div>
  );
}

function Chip({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <span
      className={`rounded-[999px] border px-[8px] py-[2px] text-[11px] ${
        warn ? "border-[#f0c68a] text-[#b45309]" : "border-border text-muted"
      }`}
    >
      {children}
    </span>
  );
}
