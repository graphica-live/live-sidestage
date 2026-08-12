"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  visibleRows: number;
  nameMaxWidth: number;
  qualifiedCount: number;
  contributors: OverlayContributor[];
};

const POLL_FALLBACK_INTERVAL_MS = 30_000;
const ROW_HEIGHT_PX = 44;
const ROW_GAP_PX = 8;
const ROW_STEP_PX = ROW_HEIGHT_PX + ROW_GAP_PX;
const SCROLL_PAUSE_MS = 2600; // 停止時間: 2〜3秒
const SCROLL_MOVE_MS = 400; // 移動時間: 0.3〜0.5秒

function formatDayLabel(dayKey: string): string {
  if (!dayKey) return "";
  const d = new Date(`${dayKey}T00:00:00+09:00`);
  return d.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
}

function formatCompactCoin(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return value.toLocaleString();
}

export default function ContributionOverlayPage() {
  // next/navigation の useSearchParams はSuspense境界が必須で、このアプリの環境では
  // Suspense+別クライアントコンポーネント構成にすると本番でも再現する原因不明の
  // "Element type is invalid" ランタイムエラーを引き起こしたため、
  // window.location.search を直接読む方式に切り替えて回避している。
  const [token, setToken] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [paramsReady, setParamsReady] = useState(false);
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setToken(sp.get("token") || "");
    setPreviewMode(sp.get("preview") === "1");
    setParamsReady(true);
  }, []);

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
    if (!token) return;
    fetchSnapshot();
    const interval = setInterval(fetchSnapshot, POLL_FALLBACK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token, fetchSnapshot]);

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

  if (!paramsReady || !token) return null;

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

          <ContributorList
            contributors={snapshot.contributors}
            visibleRows={snapshot.visibleRows}
            nameMaxWidth={snapshot.nameMaxWidth}
          />
        </>
      )}

      <style>{`
        @keyframes overlayRowEnter {
          0% { opacity: 0; transform: translateX(-16px) scale(0.94); }
          60% { opacity: 1; }
          100% { opacity: 1; transform: translateX(0) scale(1); }
        }
        .overlay-row {
          animation: overlayRowEnter 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .overlay-fade-top,
        .overlay-fade-bottom {
          position: absolute;
          left: 0;
          right: 0;
          height: 20px;
          pointer-events: none;
          z-index: 2;
        }
        .overlay-fade-top {
          top: 0;
          background: linear-gradient(to bottom, rgba(0, 0, 0, 0.5), transparent);
        }
        .overlay-fade-bottom {
          bottom: 0;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.5), transparent);
        }
      `}</style>
    </div>
  );
}

function ContributorList({
  contributors,
  visibleRows,
  nameMaxWidth,
}: {
  contributors: OverlayContributor[];
  visibleRows: number;
  nameMaxWidth: number;
}) {
  const needsScroll = contributors.length > visibleRows;
  const [index, setIndex] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);

  // 表示件数や表示人数設定が変わったらループ状態をリセットする(範囲外indexを防ぐ)。
  useEffect(() => {
    setIndex(0);
    setTransitionEnabled(true);
  }, [contributors.length, visibleRows]);

  // 1人分移動 → 2〜3秒停止 → 次の1人へ、を一方向で繰り返す。
  useEffect(() => {
    if (!needsScroll) return;
    const id = setInterval(() => setIndex((i) => i + 1), SCROLL_PAUSE_MS);
    return () => clearInterval(id);
  }, [needsScroll]);

  // 複製した2周目の先頭(=1周目の先頭と同じ見た目)まで移動し終えたら、移動アニメーション完了
  // 直後にtransitionを切って瞬時に先頭へ戻す。逆走せず自然に循環して見える。
  useEffect(() => {
    if (!needsScroll || index !== contributors.length) return;
    const t = setTimeout(() => {
      setTransitionEnabled(false);
      setIndex(0);
    }, SCROLL_MOVE_MS);
    return () => clearTimeout(t);
  }, [index, needsScroll, contributors.length]);

  useEffect(() => {
    if (transitionEnabled) return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setTransitionEnabled(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [transitionEnabled]);

  if (!needsScroll) {
    return (
      <div className="flex flex-col" style={{ gap: ROW_GAP_PX }}>
        {contributors.map((c) => (
          <ContributorRow key={c.uniqueId} contributor={c} nameMaxWidth={nameMaxWidth} />
        ))}
      </div>
    );
  }

  const displayList = contributors.concat(contributors);

  return (
    <div
      className="relative overflow-hidden"
      style={{ height: visibleRows * ROW_STEP_PX - ROW_GAP_PX }}
    >
      <div
        className="flex flex-col"
        style={{
          gap: ROW_GAP_PX,
          transform: `translateY(-${index * ROW_STEP_PX}px)`,
          transition: transitionEnabled ? `transform ${SCROLL_MOVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : "none",
        }}
      >
        {displayList.map((c, i) => (
          <ContributorRow key={`${c.uniqueId}-${i}`} contributor={c} nameMaxWidth={nameMaxWidth} />
        ))}
      </div>
      <div className="overlay-fade-top" />
      <div className="overlay-fade-bottom" />
    </div>
  );
}

function ContributorRow({ contributor, nameMaxWidth }: { contributor: OverlayContributor; nameMaxWidth: number }) {
  return (
    <div
      className="overlay-row flex items-center gap-2 rounded-full border border-white/20 bg-white/10 pl-1.5 pr-4 py-1.5 shadow-lg backdrop-blur-sm shrink-0"
      style={{ height: ROW_HEIGHT_PX }}
    >
      <ContributorAvatar src={contributor.profileImageUrl} alt={contributor.nickname} />
      <span
        className="text-white font-bold text-base overflow-hidden text-ellipsis whitespace-nowrap"
        style={{ textShadow: "0 1px 4px rgba(0,0,0,0.8)", maxWidth: nameMaxWidth }}
      >
        {contributor.nickname}
      </span>
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
