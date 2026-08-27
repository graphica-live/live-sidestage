"use client";

import { useLayoutEffect, useState } from "react";
import { buildFlowPath, type FlowRect } from "@/event/bracket-flow";
import type { BracketFeederFlowDto } from "@/event/public-event";
import { useBracketNaturalSize } from "./BracketScroller";

// 「接続の交換」で座標既定とずれた勝者フローを、黄色の破線矢印で見せる独立overlay。
// 管理画面版(`(event)/events/[id]/matches/FeederFlowOverlay.tsx`)と役割・幾何は同じ。
// 配色・シェイプ言語(CARD_CLIP等)がAdminBracketTreeとBracketTreeで最初から
// 揃えていない([src/event/CLAUDE.md](../../../../../event/CLAUDE.md) 参照)ため、
// 共通コンポーネントにはせず route ごとに置く。共有するのは純粋な幾何計算
// (`@/event/bracket-flow`)と辺の導出(`@/event/winner-feeders` の `feederFlowEdges`、
// `loadBracket()` が呼ぶ)だけ。
//
// MVP方針: 静的な黄色破線 + 矢じり + 最小限の黒下地ストロークのみ。アニメーション・
// 発光・両端リングは入れない(交換の蓄積で数百本の矢印が残りうるため)。

function slotSelector(round: number, position: number): string {
  return `[data-bracket-slot="${round}:${position}"]`;
}

function localRect(el: HTMLElement, root: HTMLElement): FlowRect {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

function sectionOf(el: Element): string | null {
  return el.closest("[data-bracket-section]")?.getAttribute("data-bracket-section") ?? null;
}

type ResolvedPath = { key: string; d: string; headX: number; headY: number; headAngleDeg: number };

export function FeederFlowOverlay({
  containerRef,
  flows,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  flows: BracketFeederFlowDto[];
}) {
  // **`useContext` は呼び出し元の位置ではなく、この関数自身がツリー上どこにマウント
  // されるかで解決される。** `BracketScroller` の Provider は自身の children の内側に
  // あるので、`containerRef` を渡す親(`BracketTree`)ではなく、children として実際に
  // Provider配下でレンダーされるこのコンポーネント自身がここで呼ぶ必要がある
  // (親側で呼ぶと常に `null` が返り、矢印が1本も描画されない実害があった)。
  const bounds = useBracketNaturalSize();
  const [paths, setPaths] = useState<ResolvedPath[]>([]);

  const flowsKey = flows
    .map((f) => `${f.from.round}:${f.from.position}>${f.to.round}:${f.to.position}:${f.to.sideIndex}`)
    .join("|");

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root || flows.length === 0 || !bounds) {
      setPaths([]);
      return;
    }

    function measure() {
      if (!bounds) return; // 関数境界を跨ぐとnarrowingが効かないため再チェック(型のためだけ)
      const bowCounters = new Map<string, number>();
      const next: ResolvedPath[] = [];

      for (const flow of flows) {
        const sourceEl = root!.querySelector<HTMLElement>(
          slotSelector(flow.from.round, flow.from.position)
        );
        const targetSlotEl = root!.querySelector<HTMLElement>(
          slotSelector(flow.to.round, flow.to.position)
        );
        if (!sourceEl || !targetSlotEl) continue;

        const targetSideEl = targetSlotEl.querySelector<HTMLElement>(
          `[data-bracket-side="${flow.to.sideIndex}"]`
        );
        if (!targetSideEl) continue;

        if (sectionOf(sourceEl) !== sectionOf(targetSideEl)) continue;

        const sourceRect = localRect(sourceEl, root!);
        const targetRect = localRect(targetSideEl, root!);

        const bowKey = `${Math.round(sourceRect.x)}`;
        const bowIndex = bowCounters.get(bowKey) ?? 0;
        bowCounters.set(bowKey, bowIndex + 1);

        const path = buildFlowPath(sourceRect, targetRect, bounds, bowIndex);
        next.push({
          key: `${flow.from.round}:${flow.from.position}>${flow.to.round}:${flow.to.position}:${flow.to.sideIndex}`,
          ...path,
        });
      }

      setPaths(next);
    }

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowsKey, bounds?.width, bounds?.height]);

  if (!bounds || paths.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-30"
      width={bounds.width}
      height={bounds.height}
      aria-hidden
    >
      {paths.map((p) => (
        <g key={p.key}>
          <path d={p.d} fill="none" stroke="#000" strokeOpacity={0.55} strokeWidth={5} strokeLinecap="round" />
          <path
            d={p.d}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={2.5}
            strokeDasharray="7 5"
            strokeLinecap="round"
          />
          <polygon
            points="0,-4 8,0 0,4"
            fill="#fbbf24"
            transform={`translate(${p.headX} ${p.headY}) rotate(${p.headAngleDeg})`}
          />
        </g>
      ))}
    </svg>
  );
}
