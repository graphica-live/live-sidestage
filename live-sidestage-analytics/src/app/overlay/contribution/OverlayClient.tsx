"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { io, Socket } from "socket.io-client";

type OverlayContributor = {
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  totalDiamonds: number;
};

type OverlaySnapshot = {
  dayKey: string;
  threshold: number;
  goalCount: number;
  qualifiedCount: number;
  contributors: OverlayContributor[];
};

const POLL_FALLBACK_INTERVAL_MS = 30_000;

function formatDayLabel(dayKey: string): string {
  if (!dayKey) return "";
  const d = new Date(`${dayKey}T00:00:00+09:00`);
  return d.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
}

function formatCompactCoin(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return value.toLocaleString();
}

export default function OverlayClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const previewMode = searchParams.get("preview") === "1";
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (previewMode) {
      document.body.style.background =
        "radial-gradient(circle at top, rgba(30, 41, 59, 0.88) 0%, rgba(15, 23, 42, 0.94) 100%)";
      document.body.style.minHeight = "100vh";
    } else {
      document.body.style.background = "transparent";
    }
  }, [previewMode]);

  const fetchSnapshot = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/overlay/contribution?token=${encodeURIComponent(token)}`);
      if (res.ok) setSnapshot(await res.json());
    } catch {
      // 安全網pollingなので失敗時は次回に任せる
    }
  }, [token]);

  // 初回描画 + socket切断時に備えた安全網polling
  useEffect(() => {
    fetchSnapshot();
    const interval = setInterval(fetchSnapshot, POLL_FALLBACK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchSnapshot]);

  // ギフト受信の即時反映用socket.io接続
  useEffect(() => {
    if (!token) return;
    const socket = io({ query: { token } });
    socketRef.current = socket;
    socket.on("overlay:contribution:snapshot", (payload: OverlaySnapshot) => {
      setSnapshot(payload);
    });
    return () => {
      socket.disconnect();
    };
  }, [token]);

  if (!token) return null;

  return (
    <div className="p-6">
      {snapshot && (
        <>
          <div className="inline-flex items-center gap-3 rounded-full border border-brand/40 bg-black/40 px-5 py-2 mb-4 shadow-lg backdrop-blur-sm">
            <span className="text-white font-bold text-lg" style={{ textShadow: "0 2px 6px rgba(0,0,0,0.6)" }}>
              {formatDayLabel(snapshot.dayKey)}
            </span>
            <span className="text-brand font-extrabold text-lg" style={{ textShadow: "0 2px 6px rgba(0,0,0,0.6)" }}>
              {formatCompactCoin(snapshot.threshold)}貢献目標 {snapshot.qualifiedCount}/{snapshot.goalCount}人
            </span>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {snapshot.contributors.map((c) => (
              <div
                key={c.uniqueId}
                className="overlay-card flex items-center gap-2 rounded-full border border-white/20 bg-white/10 pl-1.5 pr-4 py-1.5 shadow-lg backdrop-blur-sm"
              >
                <ContributorAvatar src={c.profileImageUrl} alt={c.nickname} />
                <span
                  className="text-white font-bold text-base"
                  style={{ textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}
                >
                  {c.nickname}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <style>{`
        @keyframes overlayCardEnter {
          0% { opacity: 0; transform: translateX(-16px) scale(0.94); }
          60% { opacity: 1; }
          100% { opacity: 1; transform: translateX(0) scale(1); }
        }
        .overlay-card {
          animation: overlayCardEnter 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
      `}</style>
    </div>
  );
}

function ContributorAvatar({ src, alt }: { src: string | null; alt: string }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className="w-8 h-8 rounded-full object-cover shrink-0 border-2 border-white/80"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-surface border-2 border-white/80 flex items-center justify-center text-white text-xs font-bold shrink-0">
      {alt.charAt(0).toUpperCase()}
    </div>
  );
}
