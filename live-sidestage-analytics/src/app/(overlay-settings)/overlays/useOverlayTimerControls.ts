"use client";

import { useCallback, useState } from "react";

const ENDPOINT = "/api/streamer/overlay-timer";

export type TimerRuntime = { running: boolean; endsAt: number | null; remainingMs: number };

export function useOverlayTimerControls() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data?.error ?? `操作に失敗しました (${res.status})`);
        return null;
      }
      setError(null);
      return (await res.json()) as { runtime: TimerRuntime };
    } catch {
      setError("操作に失敗しました。通信を確認してください。");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    busy,
    error,
    start: () => call({ action: "start" }),
    pause: () => call({ action: "pause" }),
    reset: () => call({ action: "reset" }),
    adjust: (deltaMinutes: number) => call({ action: "adjust", deltaMinutes }),
    testEndSound: () => call({ action: "test-end-sound" }),
    testCountdownSound: () => call({ action: "test-countdown-sound" }),
  };
}
