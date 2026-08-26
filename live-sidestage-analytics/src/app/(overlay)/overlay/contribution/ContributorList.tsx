"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { OverlayContributor } from "@/lib/overlay/contracts";
import OverlayAvatar from "../../_components/OverlayAvatar";
import { TEXT_SHADOW } from "./theme";

const ROW_HEIGHT_PX = 44;
const ROW_GAP_PX = 8;
const ROW_STEP_PX = ROW_HEIGHT_PX + ROW_GAP_PX;
const SCROLL_MOVE_MS = 400; // 移動時間: 0.3〜0.5秒
const ZOOM_MS = 700; // 縮小⇄復帰の遷移時間
const DEFAULT_DISPLAY_SPEED = 3;

// 表示速度設定(1=遅い〜5=速い)ごとの待機時間。3が既存デフォルト値と一致する。
const SCROLL_PAUSE_MS_BY_SPEED: Record<number, number> = {
  1: 4400,
  2: 3500,
  3: 2600, // 停止時間: 2〜3秒(既存デフォルト)
  4: 1700,
  5: 800,
};
const SHRUNK_HOLD_MS_BY_SPEED: Record<number, number> = {
  1: 5000,
  2: 4000,
  3: 3000, // 縮小全体表示の静止時間(既存デフォルト)
  4: 2000,
  5: 1000,
};

type ScrollPhase = "scrolling" | "shrinking" | "shrunk" | "expanding";

export default function ContributorList({
  contributors,
  visibleRows,
  nameMaxWidth,
  align,
  displaySpeed,
}: {
  contributors: OverlayContributor[];
  visibleRows: number;
  nameMaxWidth: number;
  align: "left" | "right";
  displaySpeed: number;
}) {
  const total = contributors.length;
  const needsCycle = total > visibleRows;
  const maxIndex = Math.max(0, total - visibleRows);
  const viewportHeight = visibleRows * ROW_STEP_PX - ROW_GAP_PX;
  const fullContentHeight = total * ROW_STEP_PX - ROW_GAP_PX;
  const fitScale = needsCycle ? viewportHeight / fullContentHeight : 1;
  const scrollPauseMs = SCROLL_PAUSE_MS_BY_SPEED[displaySpeed] ?? SCROLL_PAUSE_MS_BY_SPEED[DEFAULT_DISPLAY_SPEED];
  const shrunkHoldMs = SHRUNK_HOLD_MS_BY_SPEED[displaySpeed] ?? SHRUNK_HOLD_MS_BY_SPEED[DEFAULT_DISPLAY_SPEED];

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
      const t = setTimeout(() => setPhase("shrinking"), scrollPauseMs);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, maxIndex)), scrollPauseMs);
    return () => clearTimeout(t);
  }, [phase, index, needsCycle, maxIndex, scrollPauseMs]);

  // shrinking: ZOOM_MSかけて縮小しきったら shrunk へ。
  useEffect(() => {
    if (phase !== "shrinking") return;
    const t = setTimeout(() => setPhase("shrunk"), ZOOM_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // shrunk: 全体表示のまま少し静止してから expanding へ。
  useEffect(() => {
    if (phase !== "shrunk") return;
    const t = setTimeout(() => setPhase("expanding"), shrunkHoldMs);
    return () => clearTimeout(t);
  }, [phase, shrunkHoldMs]);

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
          <ContributorRow key={c.uniqueId} contributor={c} nameMaxWidth={nameMaxWidth} align={align} />
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

  // 縦方向の色味(background)は変えず、横幅だけ名前の最大幅で打ち切る。
  // ただしハードカットだと不自然なので、幅の終端側だけmaskでフェードアウトさせて自然に消す。
  const horizontalFadeMask = `linear-gradient(${
    align === "right" ? "to left" : "to right"
  }, black 0%, black 40%, transparent 100%)`;
  const fadeSideStyle: CSSProperties = {
    width: nameMaxWidth,
    [align === "right" ? "right" : "left"]: 0,
    WebkitMaskImage: horizontalFadeMask,
    maskImage: horizontalFadeMask,
  };

  return (
    <div className="relative" style={{ height: viewportHeight }}>
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="flex flex-col"
          style={{
            gap: ROW_GAP_PX,
            transformOrigin: align === "right" ? "top right" : "top left",
            transform: `translateY(${-contentY * scale}px) scale(${scale})`,
            transition: `transform ${transitionMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          }}
        >
          {contributors.map((c) => (
            <ContributorRow key={c.uniqueId} contributor={c} nameMaxWidth={nameMaxWidth} align={align} />
          ))}
        </div>
        <div className="overlay-fade-top" style={fadeSideStyle} />
        <div className="overlay-fade-bottom" style={fadeSideStyle} />
      </div>

      <div
        className="overlay-scroll-indicator"
        style={{ opacity: showIndicator ? 1 : 0, [align === "right" ? "right" : "left"]: -10 }}
      >
        <div
          className="overlay-scroll-indicator-thumb"
          style={{
            height: `${thumbHeightPercent}%`,
            top: `${thumbTopPercent}%`,
            transition: `top ${SCROLL_MOVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          }}
        />
      </div>
    </div>
  );
}

function ContributorRow({
  contributor,
  nameMaxWidth,
  align,
}: {
  contributor: OverlayContributor;
  nameMaxWidth: number;
  align: "left" | "right";
}) {
  return (
    <div
      className={`overlay-row flex items-center gap-2 px-1 shrink-0${align === "right" ? " overlay-row-right" : ""}`}
      style={{ height: ROW_HEIGHT_PX, flexDirection: align === "right" ? "row-reverse" : "row" }}
    >
      <OverlayAvatar src={contributor.profileImageUrl} alt={contributor.nickname} />
      <span
        className="text-white font-bold text-base overflow-hidden text-ellipsis whitespace-nowrap"
        style={{
          textShadow: TEXT_SHADOW,
          maxWidth: nameMaxWidth,
          textAlign: align === "right" ? "right" : "left",
        }}
      >
        {contributor.nickname}
      </span>
    </div>
  );
}
