"use client";

import { useEffect, useRef, useState } from "react";
import { MATCH_STATUS_CLASSES, MATCH_STATUS_LABELS } from "@/event/labels";
import type { MatchRow } from "./MatchManager";

// 管理画面のトーナメント表(表モード)。公開ページの BracketTree.tsx と
// **配置関係(決勝を中央に置いた再帰ツリー・接続線の引き方)を揃えている**
// — 幾何の成立条件(カード高さがすべて同じであること)も含めて同じ制約を持つ。
//
// 公開側との違いは2つだけ:
//   1. 閲覧専用データ(BracketMatchDto)ではなく管理用の MatchRow を使う
//   2. カードは操作ボタンを持たない代わりにクリックできる
//      (承認・勝者確定などの操作は呼び出し元がモーダルで開く MatchCard に任せる)
//
// 幾何を変えるときは src/event/CLAUDE.md の「公開トーナメント表の幾何を壊さない」を読むこと。
//
// スマホ幅では表全体がはみ出るため、初期表示は画面幅に収まる縮小率(fitZoom)で
// 描画し、+/-/全体表示ボタンでユーザーが任意にズームできるようにする。
// transform: scale() は要素の占有スペースを変えないので、スペーサー div の
// width/height を縮小後のサイズに明示して overflow-auto のスクロール領域を合わせている。

const CARD_W = "w-40 sm:w-44";
const CONN_W = "w-5";
const CARD_H = "h-24";

const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.15;

type MatchIndex = Map<string, MatchRow>;

function key(round: number, position: number): string {
  return `${round}:${position}`;
}

export function AdminBracketTree({
  matches,
  onSelect,
}: {
  matches: MatchRow[];
  onSelect: (matchId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [treeSize, setTreeSize] = useState({ width: 0, height: 0 });
  const [fitZoom, setFitZoom] = useState(1);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    const tree = treeRef.current;
    if (!container || !tree) return;

    function fit() {
      const width = tree!.scrollWidth;
      const height = tree!.scrollHeight;
      if (width === 0 || height === 0) return;
      setTreeSize({ width, height });
      const next = Math.min(1, container!.clientWidth / width);
      setFitZoom(next);
      setZoom(next);
    }

    fit();
    // container(overflow-auto)自体を observe すると、ズームでスペーサー div の
    // 高さが変わるたびに container の content box も追従して変化し、それを
    // ResizeObserver が「リサイズされた」と誤検知して zoom を fitZoom へ戻してしまう。
    // 画面幅の変化(回転・リサイズ)だけを見ればよいので window の resize で足りる。
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [matches]);

  if (matches.length === 0) return null;

  const roundCount = Math.max(...matches.map((m) => m.round));
  const index: MatchIndex = new Map(matches.map((m) => [key(m.round, m.position), m]));
  const hasWings = roundCount >= 2;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-1 text-xs text-gray-400">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(fitZoom, Number((z - ZOOM_STEP).toFixed(2))))}
          disabled={zoom <= fitZoom}
          className="rounded-full px-2 py-1.5 hover:bg-white/10 disabled:opacity-30"
          aria-label="縮小"
        >
          −
        </button>
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Number((z + ZOOM_STEP).toFixed(2))))}
          disabled={zoom >= MAX_ZOOM}
          className="rounded-full px-2 py-1.5 hover:bg-white/10 disabled:opacity-30"
          aria-label="拡大"
        >
          ＋
        </button>
        {zoom !== fitZoom && (
          <button
            type="button"
            onClick={() => setZoom(fitZoom)}
            className="ml-1 rounded-full px-2 py-1.5 hover:bg-white/10"
          >
            全体表示
          </button>
        )}
      </div>

      <div ref={containerRef} className="overflow-auto pb-2">
        <div style={{ width: treeSize.width * zoom, height: treeSize.height * zoom }}>
          <div
            ref={treeRef}
            style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: "max-content" }}
          >
            <RoundHeadings roundCount={roundCount} index={index} hasWings={hasWings} />

            <div className="flex items-center pt-2">
              {hasWings && (
                <MatchNode
                  round={roundCount - 1}
                  position={0}
                  mirror={false}
                  index={index}
                  onSelect={onSelect}
                />
              )}
              {hasWings && <StraightConnector />}

              <div className={`${CARD_W} shrink-0`}>
                <MatchCardOrEmpty match={index.get(key(roundCount, 0))} mirror={false} onSelect={onSelect} />
              </div>

              {hasWings && <StraightConnector />}
              {hasWings && (
                <MatchNode
                  round={roundCount - 1}
                  position={1}
                  mirror
                  index={index}
                  onSelect={onSelect}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoundHeadings({
  roundCount,
  index,
  hasWings,
}: {
  roundCount: number;
  index: MatchIndex;
  hasWings: boolean;
}) {
  const label = (round: number) => index.get(key(round, 0))?.roundLabel ?? `${round}回戦`;
  const wings = Array.from({ length: roundCount - 1 }, (_, i) => i + 1);

  return (
    <div className="flex items-end">
      {hasWings &&
        wings.map((round) => (
          <div key={`l${round}`} className="flex">
            <div className={`${CARD_W} shrink-0 text-center text-xs text-gray-500`}>
              {label(round)}
            </div>
            <div className={`${CONN_W} shrink-0`} />
          </div>
        ))}

      <div className={`${CARD_W} shrink-0 text-center text-xs font-semibold text-gray-300`}>
        {label(roundCount)}
      </div>

      {hasWings &&
        [...wings].reverse().map((round) => (
          <div key={`r${round}`} className="flex">
            <div className={`${CONN_W} shrink-0`} />
            <div className={`${CARD_W} shrink-0 text-center text-xs text-gray-500`}>
              {label(round)}
            </div>
          </div>
        ))}
    </div>
  );
}

function MatchNode({
  round,
  position,
  mirror,
  index,
  onSelect,
}: {
  round: number;
  position: number;
  mirror: boolean;
  index: MatchIndex;
  onSelect: (matchId: string) => void;
}) {
  const card = (
    <div className={`${CARD_W} shrink-0`}>
      <MatchCardOrEmpty match={index.get(key(round, position))} mirror={mirror} onSelect={onSelect} />
    </div>
  );

  if (round <= 1) {
    return <div className="flex items-center">{card}</div>;
  }

  return (
    <div className={`flex items-stretch ${mirror ? "flex-row-reverse" : ""}`}>
      <div className="flex flex-col">
        <div className="flex flex-1 items-center py-1">
          <MatchNode round={round - 1} position={position * 2} mirror={mirror} index={index} onSelect={onSelect} />
        </div>
        <div className="flex flex-1 items-center py-1">
          <MatchNode
            round={round - 1}
            position={position * 2 + 1}
            mirror={mirror}
            index={index}
            onSelect={onSelect}
          />
        </div>
      </div>

      <PairConnector mirror={mirror} />

      <div className="flex items-center">{card}</div>
    </div>
  );
}

function PairConnector({ mirror }: { mirror: boolean }) {
  const fromChildren = mirror ? "right-0" : "left-0";
  const spine = mirror ? "right-1/2" : "left-1/2";
  return (
    <div className={`relative ${CONN_W} shrink-0 self-stretch`} aria-hidden>
      <span className={`absolute ${fromChildren} top-1/4 h-px w-1/2 bg-border`} />
      <span className={`absolute ${fromChildren} bottom-1/4 h-px w-1/2 bg-border`} />
      <span className={`absolute ${spine} bottom-1/4 top-1/4 w-px bg-border`} />
      <span className={`absolute ${spine} top-1/2 h-px w-1/2 bg-border`} />
    </div>
  );
}

function StraightConnector() {
  return (
    <div className={`relative ${CONN_W} shrink-0`} aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
    </div>
  );
}

function MatchCardOrEmpty({
  match,
  mirror,
  onSelect,
}: {
  match: MatchRow | undefined;
  mirror: boolean;
  onSelect: (matchId: string) => void;
}) {
  if (!match) {
    return (
      <div
        className={`flex ${CARD_H} items-center justify-center rounded-xl border border-dashed border-border text-[10px] text-gray-600`}
      >
        —
      </div>
    );
  }

  // 不戦勝は対戦相手がそもそも存在しない。相手側の「未確定」枠は出さず、本人だけを表示する。
  const byeWinner =
    match.winnerDecidedBy === "BYE"
      ? match.sides.find((s) => s.id === match.winnerSideId)
      : undefined;

  return (
    <button
      type="button"
      onClick={() => onSelect(match.id)}
      className={`card flex ${CARD_H} w-full flex-col justify-between overflow-hidden p-2 text-left transition hover:border-brand/40`}
    >
      <div
        className={`flex items-center justify-between gap-1 text-[10px] text-gray-500 ${
          mirror ? "flex-row-reverse" : ""
        }`}
      >
        <span
          className={`rounded-full px-1.5 py-0.5 ${
            MATCH_STATUS_CLASSES[match.status] ?? "bg-white/5 text-gray-400"
          }`}
        >
          {MATCH_STATUS_LABELS[match.status] ?? match.status}
        </span>
      </div>

      {byeWinner ? (
        <div className="flex flex-1 items-center">
          <div className="flex w-full items-center justify-center gap-1 rounded-lg bg-brand/10 px-1.5 py-1 text-sm ring-1 ring-brand/40">
            <span className="min-w-0 truncate">{byeWinner.label}</span>
          </div>
        </div>
      ) : (
        match.sides.map((side) => (
          <div
            key={side.id}
            className={`flex items-center justify-between gap-1 rounded-lg px-1.5 py-1 text-sm ${
              match.winnerSideId === side.id ? "bg-brand/10 ring-1 ring-brand/40" : "bg-white/5"
            } ${mirror ? "flex-row-reverse" : ""}`}
          >
            <span className={`min-w-0 flex-1 truncate ${mirror ? "text-right" : ""}`}>
              {side.empty ? <span className="text-gray-600">未確定</span> : side.label}
            </span>
          </div>
        ))
      )}
    </button>
  );
}
