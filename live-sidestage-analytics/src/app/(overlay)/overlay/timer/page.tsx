"use client";

import { useEffect, useRef, useState } from "react";
import type { TimerSnapshot } from "@/lib/overlay/timer.server";
import type { TimerEvent } from "@/lib/overlay/emit";
import { useOverlayParams } from "../../_hooks/useOverlayParams";
import { useOverlayChannel } from "../../_hooks/useOverlayChannel";
import { findSoundPreset } from "@/lib/overlay/sound-presets";

// OBS ブラウザソース用。URL は `/overlay/timer?token=<overlayToken>`。
//
// サーバーはsetTimeoutを持たない(overlay/timer.server.tsのコメント参照)。
// クライアントがperformance.now()基準でサーバー時刻との差を較正し、毎フレーム
// ローカルでremainingMsを再計算する。終了検知もここで行い、endsAtが変わるまで
// 二重に鳴らさないようuseRefで既発火フラグを持つ。

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function TimerOverlayPage() {
  const { token, ready, previewMode } = useOverlayParams();
  const { snapshot, events, dequeueEvent } = useOverlayChannel<TimerSnapshot, TimerEvent>(
    "timer",
    token,
    "overlay:timer:event"
  );

  const [remainingMs, setRemainingMs] = useState(0);
  const calibrationRef = useRef({ serverNow: 0, perfNow: 0 });
  const endedKeyRef = useRef<string | null>(null);
  const countdownFiredRef = useRef<string | null>(null);
  const [banner, setBanner] = useState<{ text: string; key: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    calibrationRef.current = { serverNow: snapshot.serverNow, perfNow: performance.now() };
  }, [snapshot?.serverNow]);

  const playSound = (key: string | null, volume: number) => {
    if (previewMode || !key) return;
    const preset = findSoundPreset(key);
    if (!preset) return;
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = preset.url;
    audioRef.current.volume = Math.min(1, Math.max(0, volume / 100));
    void audioRef.current.play().catch(() => {});
  };

  useEffect(() => {
    let raf: number;
    const tick = () => {
      if (snapshot) {
        if (snapshot.runtime.running && snapshot.runtime.endsAt !== null) {
          const elapsedSincePush = performance.now() - calibrationRef.current.perfNow;
          const estimatedNow = calibrationRef.current.serverNow + elapsedSincePush;
          const next = Math.max(0, snapshot.runtime.endsAt - estimatedNow);
          setRemainingMs(next);

          const endedKey = `${snapshot.runtime.endsAt}`;
          if (next <= 0 && endedKeyRef.current !== endedKey) {
            endedKeyRef.current = endedKey;
            playSound(snapshot.settings.endSoundKey, snapshot.settings.endSoundVolume);
          }

          const thresholdMs = snapshot.settings.countdownSoundThresholdSeconds * 1000;
          if (
            snapshot.settings.countdownSoundEnabled &&
            next > 0 &&
            next <= thresholdMs &&
            countdownFiredRef.current !== endedKey
          ) {
            countdownFiredRef.current = endedKey;
            playSound(snapshot.settings.countdownSoundKey, snapshot.settings.countdownSoundVolume);
          }
        } else {
          setRemainingMs(snapshot.runtime.remainingMs);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  useEffect(() => {
    if (events.length === 0) return;
    const event = events[0];
    dequeueEvent();
    if (event.type === "adjust") {
      const sign = event.deltaMinutes > 0 ? "+" : "";
      setBanner({ text: `${sign}${event.deltaMinutes}分`, key: Date.now() });
    } else if (event.type === "capped") {
      setBanner({ text: "上限に到達しました", key: Date.now() });
    } else if (event.type === "blocked") {
      setBanner({ text: "下限に到達しました", key: Date.now() });
    } else if (event.type === "test-sound" && snapshot) {
      if (event.target === "end") playSound(snapshot.settings.endSoundKey, snapshot.settings.endSoundVolume);
      else playSound(snapshot.settings.countdownSoundKey, snapshot.settings.countdownSoundVolume);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, dequeueEvent]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 2000);
    return () => clearTimeout(t);
  }, [banner]);

  if (!ready || !token) return null;

  const flash = Boolean(
    snapshot?.runtime.running &&
      remainingMs > 0 &&
      remainingMs <= snapshot.settings.countdownSoundThresholdSeconds * 1000
  );

  return (
    <div className="p-6">
      {snapshot && (
        <div className="inline-flex flex-col items-center gap-1">
          {snapshot.settings.headingText && (
            <span className="text-sm font-bold text-white/70">{snapshot.settings.headingText}</span>
          )}
          <span
            className="text-6xl font-extrabold tabular-nums transition-colors"
            style={{ color: flash ? "#ef4444" : "white" }}
          >
            {formatRemaining(remainingMs)}
          </span>
          {banner && (
            <span className="mt-1 text-lg font-bold text-yellow-300 animate-[fadeIn_0.15s_ease-out]">{banner.text}</span>
          )}
        </div>
      )}
    </div>
  );
}
