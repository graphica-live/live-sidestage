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

export type ReplayClockOptions = {
  now?: () => number;
  /** **再生位置ごとの追加倍率**。無風区間の自動早送りがこれを 1 以外にする。
   * 速度チップに出るのはユーザーが選んだ `speed` だけで、この倍率は表示に混ぜない。
   * 位置の関数にしてあるのは、時計の外から状態を押し込むと基準点の付け替えが
   * 呼び出し側の責任になり、再生位置が飛ぶ経路が増えるため。 */
  boostAt?: (elapsedMs: number) => number;
};

/** rAF を 30fps へ間引く。60fps で setState すると隠れた列まで巻き込んで重い。 */
const FRAME_INTERVAL_MS = 1000 / 30;

/** 再生開始時の既定速度。5分バトルを等倍で見るのは長すぎるため(ユーザー指示)。 */
export const DEFAULT_REPLAY_SPEED = 4;

/**
 * バトル終了(durationMs到達)後も、この猶予(**実時間**)だけ内部時計を進めてから止める。
 * カード表示(`REPLAY_BAR_LIFETIME_MS` = 4000ms)・大ギフト演出(`BIG_GIFT_DURATION_MS` = 3200ms)・
 * WIN 演出(実時間 900ms+650ms 固定)が elapsedMs の純関数として自然にフェードアウトできるように
 * するため(即座に止めると、終了間際に出た演出が最後の見た目のまま残り続ける)。
 * 猶予中も `elapsedMs` は durationMs を超えて増え続けるので、表示に使う側は
 * 必要に応じて durationMs へクランプすること。
 *
 * 停止判定では `speed` を掛けて elapsedMs 換算する(下記 tick 内)。**実時間**で一定にしないと、
 * 再生速度が上がるほど猶予の elapsedMs 換算値だけが伸びずに据え置かれ、WIN 演出のように
 * 「speed 倍の elapsedMs 尺を要する」演出が速い速度で完走前に打ち切られる。
 */
export const END_FADE_MS = 4200;

/**
 * 既定の時刻源は**モジュールスコープに置く**。引数の既定値としてその場で関数を作ると
 * レンダーのたびに別の関数になり、`now` に依存する rAF の effect が毎レンダー貼り直されて
 * 基準点が 0 に戻る(再生位置が進まなくなる)。
 */
const defaultNow = () => performance.now();
const noBoost = () => 1;

export function useReplayClock(durationMs: number, options: ReplayClockOptions = {}): ReplayClock {
  const now = options.now ?? defaultNow;
  const boostAt = options.boostAt ?? noBoost;

  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(DEFAULT_REPLAY_SPEED);

  // 再生位置の基準点。elapsedMs = (now() - anchorNow) * speed * appliedBoost + anchorElapsed
  const anchorNowRef = useRef(0);
  const anchorElapsedRef = useRef(0);
  const scrubbingRef = useRef(false);
  const lastPaintRef = useRef(0);
  // 基準点を張った時点で効いていた追加倍率。rAF の外から書き換えないこと。
  const appliedBoostRef = useRef(1);
  // boostAt は毎レンダー別関数になりうるので、rAF の effect の依存には入れない。
  const boostAtRef = useRef(boostAt);
  boostAtRef.current = boostAt;

  const rebase = useCallback(
    (elapsed: number) => {
      anchorNowRef.current = now();
      anchorElapsedRef.current = elapsed;
      appliedBoostRef.current = boostAtRef.current(elapsed);
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

      const next =
        (t - anchorNowRef.current) * speed * appliedBoostRef.current + anchorElapsedRef.current;

      // 追加倍率が変わる位置に来たら、**その位置で基準点を張り直してから**次のフレームへ渡す。
      // 張り直さないと、区間へ入る前の経過時間まで新しい倍率で再計算されて位置が飛ぶ。
      const wanted = boostAtRef.current(next);
      if (wanted !== appliedBoostRef.current) {
        anchorNowRef.current = t;
        anchorElapsedRef.current = next;
        appliedBoostRef.current = wanted;
      }

      // END_FADE_MS は実時間の猶予(WIN演出などが完走するまで再生を止めない)。
      // elapsedMs は speed 倍で進むので、実時間で一定にするには speed 倍して比較する。
      const fadeMs = END_FADE_MS * speed;
      if (next >= durationMs + fadeMs) {
        setElapsedMs(durationMs + fadeMs);
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
    appliedBoostRef.current = boostAtRef.current(elapsedMs);
  }, [playing, elapsedMs, now]);

  return { elapsedMs, playing, speed, play, pause, toggle, seek, setSpeed, setScrubbing };
}
