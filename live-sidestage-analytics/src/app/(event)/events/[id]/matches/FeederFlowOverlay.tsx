"use client";

import { useLayoutEffect, useState } from "react";
import { buildFlowPath, type FlowRect } from "@/event/bracket-flow";
import type { FeederFlowEdge } from "@/event/winner-feeders";

// 「接続の交換」で座標既定とずれた勝者フローを、黄色の破線矢印で見せる独立overlay。
//
// **既存の接続線(PairConnector)は拡張しない。** あちらは再帰ツリーのサブツリー内の
// span絶対配置なので、隣接カラムしか結べない。この overlay は `containerRef` が指す
// 根(`AdminBracketTree.tsx` の `treeRef`。`position:relative` を持つ)の直下に敷き、
// `data-bracket-slot` / `data-bracket-side` を実測して任意の2枠を結ぶ。
//
// MVP方針(過剰な演出をしない): 静的な黄色破線 + 矢じり + 最小限の黒下地ストロークのみ。
// アニメーション・発光・両端リングは入れない(参加者上限200人では交換の蓄積で数百本の
// 矢印が残りうるため、視認性とパフォーマンスを優先する)。

function slotSelector(round: number, position: number): string {
  return `[data-bracket-slot="${round}:${position}"]`;
}

/** `el` から `root`(自身を含まない)までの `offsetLeft/Top` を積み上げる。
 * `getBoundingClientRect()` ではなくこちらを使うのは、`transform: scale()`(ズーム)の
 * 影響を受けないレイアウト座標が欲しいため。 */
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
  bounds,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  flows: FeederFlowEdge[];
  bounds: { width: number; height: number };
}) {
  const [paths, setPaths] = useState<ResolvedPath[]>([]);

  // 座標で決定的に固定済み(`feederFlowEdges()`)の辺を、比較用の文字列キーへ畳む。
  // 参照(配列オブジェクト)ではなく中身の変化だけで再計測させるため。
  const flowsKey = flows
    .map((f) => `${f.from.round}:${f.from.position}>${f.to.round}:${f.to.position}:${f.to.sideIndex}`)
    .join("|");

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root || flows.length === 0) {
      setPaths([]);
      return;
    }

    function measure() {
      const bowCounters = new Map<string, number>();
      const next: ResolvedPath[] = [];

      for (const flow of flows) {
        const sourceEl = root!.querySelector<HTMLElement>(
          slotSelector(flow.from.round, flow.from.position)
        );
        const targetSlotEl = root!.querySelector<HTMLElement>(
          slotSelector(flow.to.round, flow.to.position)
        );
        if (!sourceEl || !targetSlotEl) continue; // fail open: 見つからない矢印だけ諦める

        const targetSideEl = targetSlotEl.querySelector<HTMLElement>(
          `[data-bracket-side="${flow.to.sideIndex}"]`
        );
        if (!targetSideEl) continue;

        // 壊れたデータに対する描画防御(バックエンドの抜け穴対策ではない。本選と
        // 順位決定戦を跨ぐ組み合わせはAPI側で既に拒否される)。
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
    // ResizeObserver は使わない(overflow-auto コンテナを observe するとスペーサーの
    // サイズ変化を誤検知する既知の地雷。`AdminBracketTree.tsx` の `fit()` と同じ理由)。
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowsKey, bounds.width, bounds.height]);

  if (paths.length === 0) return null;

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
