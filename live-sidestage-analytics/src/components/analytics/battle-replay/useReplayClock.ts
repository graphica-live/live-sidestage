"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 再生の時計。**描画は elapsedMs の純関数**で、累積状態を持たない。
 * これが一時停止・シーク・速度変更・後方シークをすべてタダにする唯一の設計判断で、
 * タブ非表示で rAF が止まっても `now()` 基準なので復帰時に正しい位置へジャンプする。
 *
 * `now` を注入できるのはテストのため(既定は `performance.now()`)。
 */
export type ReplayClock = {
  elapsedMs: number;
  playing: boolean;
  speed: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (ms: number) => void;
  setSpeed: (speed: number) => void;
  /** シーク操作中は clock からの反映を止める(controlled range の綱引き防止)。 */
  setScrubbing: (scrubbing: boolean) => void;
};

/** rAF を 30fps へ間引く。60fps で setState すると隠れた列まで巻き込んで重い。 */
const FRAME_INTERVAL_MS = 1000 / 30;

/**
 * 既定の時刻源は**モジュールスコープに置く**。引数の既定値としてその場で関数を作ると
 * レンダーのたびに別の関数になり、`now` に依存する rAF の effect が毎レンダー貼り直されて
 * 基準点が 0 に戻る(再生位置が進まなくなる)。
 */
const defaultNow = () => performance.now();

export function useReplayClock(durationMs: number, now: () => number = defaultNow): ReplayClock {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);

  // 再生位置の基準点。elapsedMs = (now() - anchorNow) * speed + anchorElapsed
  const anchorNowRef = useRef(0);
  const anchorElapsedRef = useRef(0);
  const scrubbingRef = useRef(false);
  const lastPaintRef = useRef(0);

  const rebase = useCallback(
    (elapsed: number) => {
      anchorNowRef.current = now();
      anchorElapsedRef.current = elapsed;
    },
    [now]
  );

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.min(durationMs, Math.max(0, ms));
      rebase(clamped);
      setElapsedMs(clamped);
    },
    [durationMs, rebase]
  );

  const play = useCallback(() => {
    setElapsedMs((current) => {
      // 末尾で押されたら頭から。位置を基準点へ写してから再生状態に入る。
      const next = current >= durationMs ? 0 : current;
      rebase(next);
      return next;
    });
    setPlaying(true);
  }, [durationMs, rebase]);

  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  const setSpeed = useCallback(
    (next: number) => {
      // 速度を変える瞬間に現在位置を基準点へ写さないと、再生位置が飛ぶ。
      setElapsedMs((current) => {
        rebase(current);
        return current;
      });
      setSpeedState(next);
    },
    [rebase]
  );

  const setScrubbing = useCallback(
    (scrubbing: boolean) => {
      scrubbingRef.current = scrubbing;
      if (!scrubbing) {
        setElapsedMs((current) => {
          rebase(current);
          return current;
        });
      }
    },
    [rebase]
  );

  useEffect(() => {
    if (!playing) return;
    rebase(anchorElapsedRef.current);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = now();
      // 60Hz の rAF は 16.7ms 刻みなので、閾値ちょうどで比べると 33.3ms のフレームも落ちて
      // 実効 20fps になる。半フレーム分の余裕を引いて 30fps を取り切る
      if (t - lastPaintRef.current < FRAME_INTERVAL_MS - 8) return;
      lastPaintRef.current = t;
      if (scrubbingRef.current) return;
      const next = (t - anchorNowRef.current) * speed + anchorElapsedRef.current;
      if (next >= durationMs) {
        setElapsedMs(durationMs);
        setPlaying(false);
        return;
      }
      setElapsedMs(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // rebase は playing 切替時にのみ呼びたい(依存に elapsedMs を入れると毎フレーム貼り直す)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, durationMs, now]);

  // 一時停止したら、その瞬間の位置を基準点へ写す(次の play で飛ばないように)
  useEffect(() => {
    if (playing) return;
    anchorElapsedRef.current = elapsedMs;
    anchorNowRef.current = now();
  }, [playing, elapsedMs, now]);

  return { elapsedMs, playing, speed, play, pause, toggle, seek, setSpeed, setScrubbing };
}
