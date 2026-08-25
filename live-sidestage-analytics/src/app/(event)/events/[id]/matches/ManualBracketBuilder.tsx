"use client";

import { useState } from "react";
import { seedOrder } from "@/event/bracket";
import type { EntrantOption } from "./MatchManager";

// 空欄のトーナメント表へ、主催者が自分でエントリーを置いていく画面。
//
// **幾何は `AdminBracketTree.tsx` と揃えている**(決勝を中央に置いた再帰ツリー、
// カード高さ固定、コネクタの絶対配置)。あちらは確定した `MatchRow` を描く表示専用の
// コンポーネントなので流用せず、定数と描き方だけ合わせた別物にしてある。
// 幾何の成立条件(カードの高さが全部同じ)はこちらでも同じなので、カードに行を足さないこと。
//
// **ズーム(縮小表示)は付けない。** ここはドラッグ&ドロップの操作面で、縮めると
// ドロップ先が小さくなって置きにくくなる。横スクロールで見せる。

const CARD_W = "w-40 sm:w-44";
const CONN_W = "w-5";
const CARD_H = "h-24";
// 2回戦以降は「勝者が入る」だけの枠で、置く操作もない。1回戦と同じ幅を取ると
// 3ラウンドで横 950px を超えてスクロールが要るので、ここだけ細くする
// (幾何の成立条件はカードの**高さ**が揃っていることなので、幅は変えてよい)。
const FUTURE_W = "w-20 sm:w-24";

export function ManualBracketBuilder({
  entrants,
  slots,
  disabled,
  onChange,
}: {
  entrants: EntrantOption[];
  /** 1回戦の枠。配列長が枠数(2のべき乗)で、null は空き枠 */
  slots: (string | null)[];
  disabled: boolean;
  onChange: (next: (string | null)[]) => void;
}) {
  // タップ操作のフォールバック。モバイルブラウザは HTML5 のドラッグ&ドロップが効かないので、
  // 「エントリーを選ぶ → 枠を押す」でも置けるようにする。
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const size = slots.length;
  const roundCount = Math.log2(size);
  const labelById = new Map(entrants.map((e) => [e.id, e.label]));
  const placedIds = new Set(slots.filter((id): id is string => id !== null));
  const unplaced = entrants.filter((e) => !placedIds.has(e.id));

  function place(entrantId: string, index: number) {
    if (disabled) return;
    const next = [...slots];
    const from = next.indexOf(entrantId);
    const occupant = next[index] ?? null;
    // 置いてあるものを掴んだなら入れ替え。未配置から置いたなら、元いた組を未配置へ戻す。
    if (from >= 0) next[from] = occupant;
    next[index] = entrantId;
    onChange(next);
    setSelectedId(null);
  }

  function clearSlot(index: number) {
    if (disabled) return;
    const next = [...slots];
    next[index] = null;
    onChange(next);
    setSelectedId(null);
  }

  /** 枠を押したとき。選択中があれば置き、無ければその枠の組を選ぶ(移動の起点)。 */
  function handleSlotClick(index: number) {
    if (disabled) return;
    if (selectedId) {
      place(selectedId, index);
      return;
    }
    const current = slots[index];
    setSelectedId(current);
  }

  /** シード順(登録・順位の並び)で標準の位置に一括で置く。手を入れる出発点として使う。 */
  function autoFill() {
    if (disabled) return;
    const order = seedOrder(size);
    onChange(order.map((rank) => entrants[rank - 1]?.id ?? null));
    setSelectedId(null);
  }

  const context: SlotContext = {
    slots,
    labelById,
    selectedId,
    disabled,
    onDropEntrant: place,
    onClear: clearSlot,
    onSlotClick: handleSlotClick,
    onDragStartEntrant: setSelectedId,
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs text-gray-400">
            {unplaced.length > 0 ? (
              <>
                未配置 <strong className="text-gray-200">{unplaced.length}</strong> 組。枠へドラッグ
                (スマホは組を押してから枠を押す)。
              </>
            ) : (
              "すべて配置した。空いている枠は不戦勝になる。"
            )}
          </p>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={autoFill}
              disabled={disabled}
              className="text-gray-400 hover:text-white disabled:opacity-40"
            >
              シード順で並べる
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(Array.from({ length: size }, () => null));
                setSelectedId(null);
              }}
              disabled={disabled}
              className="text-gray-400 hover:text-white disabled:opacity-40"
            >
              すべて外す
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-lg bg-white/[0.03] p-2">
          {unplaced.length === 0 ? (
            <span className="px-1 py-0.5 text-xs text-gray-600">未配置なし</span>
          ) : (
            unplaced.map((entrant) => (
              <button
                key={entrant.id}
                type="button"
                draggable={!disabled}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", entrant.id);
                  setSelectedId(entrant.id);
                }}
                onClick={() => setSelectedId(selectedId === entrant.id ? null : entrant.id)}
                className={`max-w-[14rem] truncate rounded-full px-3 py-1 text-sm transition ${
                  selectedId === entrant.id
                    ? "bg-brand/20 text-brand ring-1 ring-brand/60"
                    : "bg-white/5 text-gray-200 hover:bg-white/10"
                } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-grab active:cursor-grabbing"}`}
              >
                {entrant.label}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="overflow-auto pb-2">
        <div style={{ width: "max-content" }}>
          {roundCount === 1 ? (
            <div className={`${CARD_W} shrink-0`}>
              <SlotCard position={0} mirror={false} context={context} />
            </div>
          ) : (
            <div className="flex items-center">
              <BuilderNode round={roundCount - 1} position={0} mirror={false} context={context} />
              <StraightConnector />
              <div className={`${FUTURE_W} shrink-0`}>
                <FutureCard label="決勝" />
              </div>
              <StraightConnector />
              <BuilderNode round={roundCount - 1} position={1} mirror context={context} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type SlotContext = {
  slots: (string | null)[];
  labelById: Map<string, string>;
  selectedId: string | null;
  disabled: boolean;
  onDropEntrant: (entrantId: string, index: number) => void;
  onClear: (index: number) => void;
  onSlotClick: (index: number) => void;
  onDragStartEntrant: (entrantId: string) => void;
};

function BuilderNode({
  round,
  position,
  mirror,
  context,
}: {
  round: number;
  position: number;
  mirror: boolean;
  context: SlotContext;
}) {
  if (round <= 1) {
    return (
      <div className="flex items-center">
        <div className={`${CARD_W} shrink-0`}>
          <SlotCard position={position} mirror={mirror} context={context} />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-stretch ${mirror ? "flex-row-reverse" : ""}`}>
      <div className="flex flex-col">
        <div className="flex flex-1 items-center py-1">
          <BuilderNode round={round - 1} position={position * 2} mirror={mirror} context={context} />
        </div>
        <div className="flex flex-1 items-center py-1">
          <BuilderNode
            round={round - 1}
            position={position * 2 + 1}
            mirror={mirror}
            context={context}
          />
        </div>
      </div>

      <PairConnector mirror={mirror} />

      <div className="flex items-center">
        <div className={`${FUTURE_W} shrink-0`}>
          <FutureCard label={`${round}回戦`} />
        </div>
      </div>
    </div>
  );
}

/** 1回戦のカード。枠2つ(葉 position*2 と position*2+1)がドロップ先になる。 */
function SlotCard({
  position,
  mirror,
  context,
}: {
  position: number;
  mirror: boolean;
  context: SlotContext;
}) {
  return (
    <div className={`card flex ${CARD_H} w-full flex-col justify-center gap-1 p-2`}>
      <Slot index={position * 2} mirror={mirror} context={context} />
      <Slot index={position * 2 + 1} mirror={mirror} context={context} />
    </div>
  );
}

function Slot({
  index,
  mirror,
  context,
}: {
  index: number;
  mirror: boolean;
  context: SlotContext;
}) {
  const [over, setOver] = useState(false);
  const entrantId = context.slots[index] ?? null;
  const label = entrantId ? (context.labelById.get(entrantId) ?? "不明なエントリー") : null;
  const selected = !!entrantId && context.selectedId === entrantId;

  return (
    <div
      role="button"
      tabIndex={context.disabled ? -1 : 0}
      aria-label={label ? `${index + 1}番の枠: ${label}` : `${index + 1}番の枠: 空き`}
      draggable={!!entrantId && !context.disabled}
      onDragStart={(e) => {
        if (!entrantId) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", entrantId);
        context.onDragStartEntrant(entrantId);
      }}
      onDragOver={(e) => {
        if (context.disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const dropped = e.dataTransfer.getData("text/plain") || context.selectedId;
        if (dropped) context.onDropEntrant(dropped, index);
      }}
      onClick={() => context.onSlotClick(index)}
      // 枠は幅が限られていて名前が切れる。全文はホバーで読めるようにする。
      title={label ?? undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          context.onSlotClick(index);
        }
      }}
      className={`flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 text-sm transition ${
        mirror ? "flex-row-reverse" : ""
      } ${
        entrantId
          ? selected
            ? "bg-brand/20 ring-1 ring-brand/60"
            : "bg-white/5 hover:bg-white/10"
          : "border border-dashed border-border text-gray-600 hover:border-brand/40"
      } ${over ? "ring-1 ring-brand" : ""} ${
        context.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <span className={`min-w-0 flex-1 truncate ${mirror ? "text-right" : ""}`}>
        {label ?? <span className="text-gray-600">空き</span>}
      </span>
      {entrantId && !context.disabled && (
        <button
          type="button"
          aria-label="この枠から外す"
          onClick={(e) => {
            e.stopPropagation();
            context.onClear(index);
          }}
          className="shrink-0 rounded px-1 text-xs text-gray-500 hover:text-red-300"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** 2回戦以降の枠。ここに誰が来るかは1回戦の結果で決まるので、置くことはできない。 */
function FutureCard({ label }: { label: string }) {
  return (
    <div
      className={`flex ${CARD_H} w-full flex-col items-center justify-center rounded-xl border border-dashed border-border text-[11px] text-gray-600`}
    >
      <span>{label}</span>
      <span className="mt-0.5 text-[10px]">勝者</span>
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
