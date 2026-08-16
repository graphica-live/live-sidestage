"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

interface ListenerState {
  status: "idle" | "connecting" | "connected" | "retrying" | "error";
  message: string;
  tiktokId: string;
}

type OverlayHeadingBackground = "clear" | "crystal-blue" | "sakura-pink" | "black" | "white";

interface OverlaySettings {
  overlayToken: string;
  displayDate: string;
  isToday: boolean;
  threshold: number;
  goalCount: number;
  visibleRows: number;
  nameMaxWidth: number;
  align: "left" | "right";
  headingBackground: OverlayHeadingBackground;
  displaySpeed: number;
}

const HEADING_BACKGROUND_LABELS: Record<OverlayHeadingBackground, string> = {
  clear: "クリア",
  "crystal-blue": "ブルー",
  "sakura-pink": "ピンク",
  black: "ブラック",
  white: "ホワイト",
};

const statusColor: Record<string, string> = {
  connected: "bg-green-500",
  connecting: "bg-yellow-500 animate-pulse",
  retrying: "bg-yellow-500 animate-pulse",
  idle: "bg-gray-500",
  error: "bg-red-500",
};

export default function DashboardHeader() {
  const [listener, setListener] = useState<ListenerState | null>(null);

  const [showOverlayPanel, setShowOverlayPanel] = useState(false);
  const [overlaySettings, setOverlaySettings] = useState<OverlaySettings | null>(null);
  const [overlaySettingsLoading, setOverlaySettingsLoading] = useState(false);
  const [overlayCopied, setOverlayCopied] = useState(false);
  const overlayPanelRef = useRef<HTMLDivElement>(null);
  const overlaySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function poll() {
      const res = await fetch("/api/listener/status");
      if (!res.ok) return;
      const d = await res.json();
      setListener(d.listener);
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!showOverlayPanel) return;
    function onMouseDown(e: MouseEvent) {
      if (overlayPanelRef.current && !overlayPanelRef.current.contains(e.target as Node)) {
        setShowOverlayPanel(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showOverlayPanel]);

  const fetchOverlaySettings = useCallback(async () => {
    setOverlaySettingsLoading(true);
    try {
      const res = await fetch("/api/streamer/overlay-settings");
      if (res.ok) setOverlaySettings(await res.json());
    } finally {
      setOverlaySettingsLoading(false);
    }
  }, []);

  const patchOverlaySettings = useCallback(
    async (body: {
      nav?: "prev" | "next" | "today";
      threshold?: number;
      goalCount?: number;
      visibleRows?: number;
      nameMaxWidth?: number;
      align?: "left" | "right";
      headingBackground?: OverlayHeadingBackground;
      displaySpeed?: number;
    }) => {
      const res = await fetch("/api/streamer/overlay-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) setOverlaySettings(await res.json());
    },
    []
  );

  function handleOverlayThresholdChange(value: number) {
    setOverlaySettings((prev) => (prev ? { ...prev, threshold: value } : prev));
    if (overlaySaveTimerRef.current) clearTimeout(overlaySaveTimerRef.current);
    overlaySaveTimerRef.current = setTimeout(() => patchOverlaySettings({ threshold: value }), 500);
  }

  function handleOverlayGoalCountChange(value: number) {
    setOverlaySettings((prev) => (prev ? { ...prev, goalCount: value } : prev));
    if (overlaySaveTimerRef.current) clearTimeout(overlaySaveTimerRef.current);
    overlaySaveTimerRef.current = setTimeout(() => patchOverlaySettings({ goalCount: value }), 500);
  }

  function handleOverlayVisibleRowsChange(value: number) {
    setOverlaySettings((prev) => (prev ? { ...prev, visibleRows: value } : prev));
    if (overlaySaveTimerRef.current) clearTimeout(overlaySaveTimerRef.current);
    overlaySaveTimerRef.current = setTimeout(() => patchOverlaySettings({ visibleRows: value }), 500);
  }

  function handleOverlayNameMaxWidthChange(value: number) {
    setOverlaySettings((prev) => (prev ? { ...prev, nameMaxWidth: value } : prev));
    if (overlaySaveTimerRef.current) clearTimeout(overlaySaveTimerRef.current);
    overlaySaveTimerRef.current = setTimeout(() => patchOverlaySettings({ nameMaxWidth: value }), 500);
  }

  function handleOverlayAlignChange(value: "left" | "right") {
    setOverlaySettings((prev) => (prev ? { ...prev, align: value } : prev));
    patchOverlaySettings({ align: value });
  }

  function handleOverlayHeadingBackgroundChange(value: OverlayHeadingBackground) {
    setOverlaySettings((prev) => (prev ? { ...prev, headingBackground: value } : prev));
    patchOverlaySettings({ headingBackground: value });
  }

  function handleOverlayDisplaySpeedChange(value: number) {
    setOverlaySettings((prev) => (prev ? { ...prev, displaySpeed: value } : prev));
    patchOverlaySettings({ displaySpeed: value });
  }

  const overlayUrl =
    overlaySettings && typeof window !== "undefined"
      ? `${window.location.origin}/overlay/contribution?token=${overlaySettings.overlayToken}`
      : "";

  return (
    <header className="border-b border-border bg-panel sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <Link href="/analytics" className="text-brand font-bold text-lg shrink-0 hover:opacity-80 transition-opacity">
          LiveAnalytics
        </Link>

        <div className="flex items-center gap-2 min-w-0">
          {listener && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400 min-w-0 truncate">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  statusColor[listener.status] ?? "bg-gray-500"
                }`}
              />
              <span className="hidden sm:inline truncate">
                @{listener.tiktokId} · {listener.message}
              </span>
            </span>
          )}
        </div>

        <div className="relative" ref={overlayPanelRef}>
          <button
            onClick={() => {
              const next = !showOverlayPanel;
              setShowOverlayPanel(next);
              if (next && !overlaySettings) fetchOverlaySettings();
            }}
            className="btn-ghost text-xs shrink-0"
          >
            🎯 オーバーレイ
          </button>
          {showOverlayPanel && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-panel border border-border rounded-xl p-4 shadow-xl w-80 space-y-3">
              {overlaySettingsLoading && !overlaySettings ? (
                <p className="text-xs text-gray-400">読み込み中...</p>
              ) : overlaySettings ? (
                <>
                  <p className="text-xs font-semibold text-gray-300 border-b border-border pb-1.5">
                    貢献リストオーバーレイ
                  </p>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => patchOverlaySettings({ nav: "prev" })}
                      className="btn-ghost text-xs px-2 py-1"
                    >
                      ‹ 前日
                    </button>
                    <span className="text-xs font-medium text-center flex-1">
                      {new Date(`${overlaySettings.displayDate}T00:00:00+09:00`).toLocaleDateString("ja-JP", {
                        month: "numeric",
                        day: "numeric",
                        weekday: "short",
                      })}
                    </span>
                    <button
                      onClick={() => patchOverlaySettings({ nav: "next" })}
                      disabled={overlaySettings.isToday}
                      className="btn-ghost text-xs px-2 py-1 disabled:opacity-30"
                    >
                      翌日 ›
                    </button>
                  </div>
                  {!overlaySettings.isToday && (
                    <button
                      onClick={() => patchOverlaySettings({ nav: "today" })}
                      className="text-xs text-brand hover:underline"
                    >
                      今日に戻す
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">何コイン以上で表示</label>
                      <input
                        type="number"
                        min={100}
                        step={100}
                        value={overlaySettings.threshold}
                        onChange={(e) => handleOverlayThresholdChange(Number(e.target.value))}
                        className="input-field text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">目標人数</label>
                      <input
                        type="number"
                        min={0}
                        value={overlaySettings.goalCount}
                        onChange={(e) => handleOverlayGoalCountChange(Number(e.target.value))}
                        className="input-field text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">スクロールなし一括表示人数</label>
                      <input
                        type="number"
                        min={1}
                        value={overlaySettings.visibleRows}
                        onChange={(e) => handleOverlayVisibleRowsChange(Number(e.target.value))}
                        className="input-field text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">名前の最大幅(px)</label>
                      <input
                        type="number"
                        min={40}
                        step={10}
                        value={overlaySettings.nameMaxWidth}
                        onChange={(e) => handleOverlayNameMaxWidthChange(Number(e.target.value))}
                        className="input-field text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 block mb-1">整列方向</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleOverlayAlignChange("left")}
                        className={`text-xs px-2 py-1.5 rounded-lg border ${
                          overlaySettings.align === "right"
                            ? "border-border text-gray-400 hover:text-white"
                            : "border-brand text-brand bg-brand/10"
                        }`}
                      >
                        左寄せ
                      </button>
                      <button
                        onClick={() => handleOverlayAlignChange("right")}
                        className={`text-xs px-2 py-1.5 rounded-lg border ${
                          overlaySettings.align === "right"
                            ? "border-brand text-brand bg-brand/10"
                            : "border-border text-gray-400 hover:text-white"
                        }`}
                      >
                        右寄せ
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 block mb-1">見出し背景</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(Object.keys(HEADING_BACKGROUND_LABELS) as OverlayHeadingBackground[]).map((bg) => (
                        <button
                          key={bg}
                          onClick={() => handleOverlayHeadingBackgroundChange(bg)}
                          className={`text-xs px-2 py-1.5 rounded-lg border ${
                            overlaySettings.headingBackground === bg
                              ? "border-brand text-brand bg-brand/10"
                              : "border-border text-gray-400 hover:text-white"
                          }`}
                        >
                          {HEADING_BACKGROUND_LABELS[bg]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-500">表示速度</label>
                      <span className="text-xs text-gray-400">{overlaySettings.displaySpeed}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={overlaySettings.displaySpeed}
                      onChange={(e) => handleOverlayDisplaySpeedChange(Number(e.target.value))}
                      className="w-full"
                      style={{ accentColor: "#fe2c55" }}
                    />
                    <div className="flex items-center justify-between text-[10px] text-gray-500 mt-0.5">
                      <span>遅い</span>
                      <span>速い</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Overlay URL</label>
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs font-mono text-white bg-black/40 px-2 py-1.5 rounded flex-1 truncate">
                        {overlayUrl}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(overlayUrl);
                          setOverlayCopied(true);
                          setTimeout(() => setOverlayCopied(false), 1500);
                        }}
                        className="btn-ghost text-xs shrink-0"
                        title="コピー"
                      >
                        {overlayCopied ? "✓" : "コピー"}
                      </button>
                    </div>
                    <a
                      href={`${overlayUrl}&preview=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand hover:underline mt-1 inline-block"
                    >
                      プレビューを開く
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-xs text-red-400">読み込みに失敗しました</p>
              )}
            </div>
          )}
        </div>

        <Link href="/setup" className="btn-ghost text-xs shrink-0">
          ⚙️ 設定
        </Link>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="btn-ghost text-xs shrink-0"
        >
          ログアウト
        </button>
      </div>
    </header>
  );
}
