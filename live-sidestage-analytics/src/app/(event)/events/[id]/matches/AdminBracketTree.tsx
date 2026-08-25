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

/** 組み合わせ変更(編集モード)の操作面。渡されている間だけカードがドラッグできる。 */
export type SwapSlotRef = { matchId: string; sideIndex: number };

export type SwapMode = {
  /** 掴める枠か(出場者がいて、そのカードがまだ始まっていない) */
  canGrab: (match: MatchRow, sideIndex: number) => boolean;
  /** 置ける枠か。**空き枠も置き先になる**(片道移動 = その枠を不戦勝にする) */
  canDrop: (match: MatchRow, sideIndex: number) => boolean;
  /** タップ操作のフォールバックで選択中の枠 */
  selected: SwapSlotRef | null;
  onSelect: (slot: SwapSlotRef | null) => void;
  onSwap: (from: SwapSlotRef, to: SwapSlotRef) => void;
  busy: boolean;
};

function key(round: number, position: number): string {
  return `${round}:${position}`;
}

function sameSlot(a: SwapSlotRef | null, b: SwapSlotRef): boolean {
  return !!a && a.matchId === b.matchId && a.sideIndex === b.sideIndex;
}

export function AdminBracketTree({
  matches,
  onSelect,
  swap,
}: {
  matches: MatchRow[];
  onSelect: (matchId: string) => void;
  /** 編集モードのときだけ渡す。渡さなければ従来どおりの表示専用。 */
  swap?: SwapMode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [treeSize, setTreeSize] = useState({ width: 0, height: 0 });
  const [fitZoom, setFitZoom] = useState(1);
  const [zoom, setZoom] = useState(1);

  // **編集モードでは縮小しない。** スマホ幅では画面に収める倍率が 35% ほどまで下がり、
  // 枠が小さすぎて置けなくなる(`ManualBracketBuilder.tsx` がそもそもズームを持っていないのと
  // 同じ理由)。横スクロールで見せて、縮めたい人はズームボタンで下げられるようにしておく。
  const editing = !!swap;

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
      setZoom(editing ? 1 : next);
    }

    fit();
    // container(overflow-auto)自体を observe すると、ズームでスペーサー div の
    // 高さが変わるたびに container の content box も追従して変化し、それを
    // ResizeObserver が「リサイズされた」と誤検知して zoom を fitZoom へ戻してしまう。
    // 画面幅の変化(回転・リサイズ)だけを見ればよいので window の resize で足りる。
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [matches, editing]);

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
                  swap={swap}
                />
              )}
              {hasWings && <StraightConnector />}

              <div className={`${CARD_W} shrink-0`}>
                <MatchCardOrEmpty
                  match={index.get(key(roundCount, 0))}
                  mirror={false}
                  onSelect={onSelect}
                  swap={swap}
                />
              </div>

              {hasWings && <StraightConnector />}
              {hasWings && (
                <MatchNode
                  round={roundCount - 1}
                  position={1}
                  mirror
                  index={index}
                  onSelect={onSelect}
                  swap={swap}
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
  // **position 0 の行が存在するとは限らない。** 手動配置では空き枠が隣り合った枝の行が
  // まるごと作られないので、そのラウンドの任意の行からラベルを取る。
  const labels = new Map<number, string>();
  for (const match of index.values()) {
    if (!labels.has(match.round)) labels.set(match.round, match.roundLabel);
  }
  const label = (round: number) => labels.get(round) ?? `${round}回戦`;
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
  swap,
}: {
  round: number;
  position: number;
  mirror: boolean;
  index: MatchIndex;
  onSelect: (matchId: string) => void;
  swap?: SwapMode;
}) {
  const card = (
    <div className={`${CARD_W} shrink-0`}>
      <MatchCardOrEmpty
        match={index.get(key(round, position))}
        mirror={mirror}
        onSelect={onSelect}
        swap={swap}
      />
    </div>
  );

  if (round <= 1) {
    return <div className="flex items-center">{card}</div>;
  }

  return (
    <div className={`flex items-stretch ${mirror ? "flex-row-reverse" : ""}`}>
      <div className="flex flex-col">
        <div className="flex flex-1 items-center py-1">
          <MatchNode
            round={round - 1}
            position={position * 2}
            mirror={mirror}
            index={index}
            onSelect={onSelect}
            swap={swap}
          />
        </div>
        <div className="flex flex-1 items-center py-1">
          <MatchNode
            round={round - 1}
            position={position * 2 + 1}
            mirror={mirror}
            index={index}
            onSelect={onSelect}
            swap={swap}
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
  swap,
}: {
  match: MatchRow | undefined;
  mirror: boolean;
  onSelect: (matchId: string) => void;
  swap?: SwapMode;
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
  // **編集モードでは両サイドを描く** — 空き枠そのものがドロップ先(そこへ置くと不戦勝が
  // 実際の対戦になり、元いた枠が不戦勝になる)なので、畳んでしまうと操作できない。
  const byeWinner =
    !swap && match.winnerDecidedBy === "BYE"
      ? match.sides.find((s) => s.id === match.winnerSideId)
      : undefined;

  // バトルの開始を検知した枠。公開ページの表と同じ赤い発光にする(.live-glow は globals.css)。
  const isLive = match.status === "LIVE";

  const header = (
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
  );

  const body = byeWinner ? (
    <div className="flex flex-1 items-center">
      <div className="flex w-full items-center justify-center gap-1 rounded-lg bg-brand/10 px-1.5 py-1 text-sm ring-1 ring-brand/40">
        <span className="min-w-0 truncate">{byeWinner.label}</span>
      </div>
    </div>
  ) : (
    match.sides.map((side) => (
      <SideRow key={side.id} match={match} side={side} mirror={mirror} swap={swap} />
    ))
  );

  // 編集モードではカード全体のクリック(操作モーダル)を外す。サイド行がドラッグと
  // タップ選択を受け取るので、button で包むと入れ子の操作と競合する。
  if (swap) {
    return (
      <div
        className={`card flex ${CARD_H} w-full flex-col justify-between overflow-hidden p-2 ${
          isLive ? "live-glow border-red-500/70" : ""
        }`}
      >
        {header}
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(match.id)}
      className={`card flex ${CARD_H} w-full flex-col justify-between overflow-hidden p-2 text-left transition ${
        isLive ? "live-glow border-red-500/70 hover:border-red-400" : "hover:border-brand/40"
      }`}
    >
      {header}
      {body}
    </button>
  );
}

/** ドラッグ&ドロップで受け渡すスロット。`matchId` は cuid なので `:` を含まない。 */
function parseSlot(raw: string): SwapSlotRef | null {
  const at = raw.lastIndexOf(":");
  if (at <= 0) return null;
  const sideIndex = Number(raw.slice(at + 1));
  if (sideIndex !== 0 && sideIndex !== 1) return null;
  return { matchId: raw.slice(0, at), sideIndex };
}

/**
 * カード内の1サイド。**行を増やさない** — カード高(`CARD_H`)が変わるとコネクタの
 * 幾何(25% / 50% / 75%)がカード中心とずれて線が刺さらなくなる。
 */
function SideRow({
  match,
  side,
  mirror,
  swap,
}: {
  match: MatchRow;
  side: MatchRow["sides"][number];
  mirror: boolean;
  swap?: SwapMode;
}) {
  const [over, setOver] = useState(false);

  // 空き枠の見え方を2つに分ける。不戦勝行の空き側は「構造的に誰も来ない枠」で、
  // それ以外の空きは「上流がまだ決まっていない枠」。編集モードではどちらへも置けるが、
  // 後者へ置くと相手の枝ごと入れ替わるので、同じ言葉で見せない。
  const emptyLabel = match.isBye ? "空き" : "未確定";
  const content = (
    <>
      <span className={`min-w-0 flex-1 truncate ${mirror ? "text-right" : ""}`}>
        {side.empty ? <span className="text-gray-600">{emptyLabel}</span> : side.label}
      </span>
      {/* TikTok 側のバトルスコア。**行を増やさず同じ行に置く**。 */}
      {side.tiktokScore !== null && (
        <span className="shrink-0 font-mono text-[11px] text-gray-400">{side.tiktokScore}</span>
      )}
    </>
  );

  const base = `flex items-center justify-between gap-1 rounded-lg px-1.5 py-1 text-sm ${
    match.winnerSideId === side.id ? "bg-brand/10 ring-1 ring-brand/40" : "bg-white/5"
  } ${mirror ? "flex-row-reverse" : ""}`;

  if (!swap) {
    return <div className={base}>{content}</div>;
  }

  const ref: SwapSlotRef = { matchId: match.id, sideIndex: side.sideIndex };
  const grabbable = !swap.busy && swap.canGrab(match, side.sideIndex);
  const droppable = !swap.busy && swap.canDrop(match, side.sideIndex);
  const selected = sameSlot(swap.selected, ref);
  const acceptsDrop = droppable && !!swap.selected && !selected;

  function activate() {
    if (swap!.busy) return;
    if (swap!.selected && !selected) {
      if (droppable) swap!.onSwap(swap!.selected, ref);
      return;
    }
    if (selected) {
      swap!.onSelect(null);
      return;
    }
    if (grabbable) swap!.onSelect(ref);
  }

  return (
    <div
      role="button"
      tabIndex={grabbable || acceptsDrop ? 0 : -1}
      aria-label={`${match.roundLabel} ${side.empty ? emptyLabel : side.label}`}
      title={
        grabbable
          ? "ドラッグして入れ替え(スマホは押してから相手の枠を押す)"
          : acceptsDrop
            ? "ここへ入れ替える"
            : side.empty
              ? undefined
              : "この枠は動かせません"
      }
      draggable={grabbable}
      onDragStart={(e) => {
        if (!grabbable) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `${match.id}:${side.sideIndex}`);
        swap.onSelect(ref);
      }}
      onDragEnd={() => setOver(false)}
      onDragOver={(e) => {
        if (!acceptsDrop) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!droppable) return;
        const from = parseSlot(e.dataTransfer.getData("text/plain")) ?? swap.selected;
        if (from && !sameSlot(from, ref)) swap.onSwap(from, ref);
      }}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      className={`${base} ${selected ? "ring-1 ring-brand" : ""} ${
        over ? "ring-1 ring-brand" : ""
      } ${
        grabbable
          ? "cursor-grab active:cursor-grabbing"
          : acceptsDrop
            ? "cursor-pointer"
            : "cursor-not-allowed opacity-50"
      }`}
    >
      {content}
    </div>
  );
}
