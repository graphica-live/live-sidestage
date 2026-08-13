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
const ZOOM_MS = 700; // 縮小⇄復帰の遷移時間
const SHRUNK_HOLD_MS = 3000; // 縮小全体表示の静止時間

function formatDayLabel(dayKey: string): string {
  if (!dayKey) return "";
  const d = new Date(`${dayKey}T00:00:00+09:00`);
  return d.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
}

function formatCompactCoin(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return value.toLocaleString();
}

// 背景カードを敷かない代わりに、任意の映像の上でも文字を読めるよう濃いめの影を重ねる。
const TEXT_SHADOW = "0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.85), 0 0 16px rgba(0,0,0,0.6)";

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
          <div className="inline-flex items-center gap-3 mb-4">
            <span className="text-white font-bold text-lg" style={{ textShadow: TEXT_SHADOW }}>
              {formatDayLabel(snapshot.dayKey)}
            </span>
            <span className="text-brand font-extrabold text-lg" style={{ textShadow: TEXT_SHADOW }}>
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
        .overlay-scroll-indicator {
          position: absolute;
          left: -10px;
          top: 0;
          bottom: 0;
          width: 3px;
          border-radius: 2px;
          background: rgba(255, 255, 255, 0.22);
          transition: opacity 300ms ease;
        }
        .overlay-scroll-indicator-thumb {
          position: absolute;
          left: 0;
          width: 100%;
          border-radius: 2px;
          background: #fe2c55;
          transition: top ${SCROLL_MOVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
        }
      `}</style>
    </div>
  );
}

type ScrollPhase = "scrolling" | "shrinking" | "shrunk" | "expanding";

function ContributorList({
  contributors,
  visibleRows,
  nameMaxWidth,
}: {
  contributors: OverlayContributor[];
  visibleRows: number;
  nameMaxWidth: number;
}) {
  const total = contributors.length;
  const needsCycle = total > visibleRows;
  const maxIndex = Math.max(0, total - visibleRows);
  const viewportHeight = visibleRows * ROW_STEP_PX - ROW_GAP_PX;
  const fullContentHeight = total * ROW_STEP_PX - ROW_GAP_PX;
  const fitScale = needsCycle ? viewportHeight / fullContentHeight : 1;

  const [phase, setPhase] = useState<ScrollPhase>("scrolling");
  const [index, setIndex] = useState(0);

  // 件数や表示人数設定が変わったら状態をリセットする(範囲外indexを防ぐ)。
  useEffect(() => {
    setPhase("scrolling");
    setIndex(0);
  }, [total, visibleRows]);

  // scrolling: 上から下まで1行ずつ進める。末尾まで表示し終えたら少し停止してから縮小へ。
  useEffect(() => {
    if (!needsCycle || phase !== "scrolling") return;
    if (index >= maxIndex) {
      const t = setTimeout(() => setPhase("shrinking"), SCROLL_PAUSE_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, maxIndex)), SCROLL_PAUSE_MS);
    return () => clearTimeout(t);
  }, [phase, index, needsCycle, maxIndex]);

  // shrinking: ZOOM_MSかけて縮小しきったら shrunk へ。
  useEffect(() => {
    if (phase !== "shrinking") return;
    const t = setTimeout(() => setPhase("shrunk"), ZOOM_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // shrunk: 全体表示のまま少し静止してから expanding へ。
  useEffect(() => {
    if (phase !== "shrunk") return;
    const t = setTimeout(() => setPhase("expanding"), SHRUNK_HOLD_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // expanding: ZOOM_MSかけて等倍に戻りきったら、先頭からscrollingを再開。
  useEffect(() => {
    if (phase !== "expanding") return;
    const t = setTimeout(() => {
      setIndex(0);
      setPhase("scrolling");
    }, ZOOM_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (!needsCycle) {
    return (
      <div className="flex flex-col" style={{ gap: ROW_GAP_PX }}>
        {contributors.map((c) => (
          <ContributorRow key={c.uniqueId} contributor={c} nameMaxWidth={nameMaxWidth} />
        ))}
      </div>
    );
  }

  // 表示中コンテンツの「viewport上端に来ているコンテンツ上のY座標」(contentY)とズーム倍率(scale)から
  // transformを組み立てる。transform-originを上端に固定しているため、
  // translateY(-contentY*scale) scale(scale) と書くと、scaleを変えても常にcontentYの位置が
  // viewport上端に揃ったまま拡大縮小される(=スクロール終端の表示がそのまま縮小されて全体表示に繋がる)。
  // scrolling時のみ現在のindex位置、それ以外(shrinking/shrunk/expanding)は常に先頭(contentY=0)を狙う。
  // expandingを「scaleだけ1に戻る」動きにするため、indexがまだ末尾のままでもcontentYは0を維持する。
  const contentY = phase === "scrolling" ? index * ROW_STEP_PX : 0;
  const scale = phase === "shrinking" || phase === "shrunk" ? fitScale : 1;
  const transitionMs = phase === "shrinking" || phase === "expanding" ? ZOOM_MS : SCROLL_MOVE_MS;
  const showIndicator = phase === "scrolling";
  const thumbHeightPercent = (visibleRows / total) * 100;
  const thumbTopPercent = maxIndex > 0 ? (index / maxIndex) * (100 - thumbHeightPercent) : 0;

  return (
    <div className="relative" style={{ height: viewportHeight }}>
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="flex flex-col"
          style={{
            gap: ROW_GAP_PX,
            transformOrigin: "top center",
            transform: `translateY(${-contentY * scale}px) scale(${scale})`,
            transition: `transform ${transitionMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          }}
        >
          {contributors.map((c) => (
            <ContributorRow key={c.uniqueId} contributor={c} nameMaxWidth={nameMaxWidth} />
          ))}
        </div>
        <div className="overlay-fade-top" />
        <div className="overlay-fade-bottom" />
      </div>

      <div
        className="overlay-scroll-indicator"
        style={{ opacity: showIndicator ? 1 : 0 }}
      >
        <div
          className="overlay-scroll-indicator-thumb"
          style={{ height: `${thumbHeightPercent}%`, top: `${thumbTopPercent}%` }}
        />
      </div>
    </div>
  );
}

function ContributorRow({ contributor, nameMaxWidth }: { contributor: OverlayContributor; nameMaxWidth: number }) {
  return (
    <div className="overlay-row flex items-center gap-2 px-1 shrink-0" style={{ height: ROW_HEIGHT_PX }}>
      <ContributorAvatar src={contributor.profileImageUrl} alt={contributor.nickname} />
      <span
        className="text-white font-bold text-base overflow-hidden text-ellipsis whitespace-nowrap"
        style={{ textShadow: TEXT_SHADOW, maxWidth: nameMaxWidth }}
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
