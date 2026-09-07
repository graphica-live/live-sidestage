"use client";

import { useLayoutEffect, useRef } from "react";
import type { ReplaySender } from "@/lib/battle-replay-contract";
import { formatShortAmount, initialOf, rippleScaleForCoins } from "./replay-format";
import type { ReplayContributor } from "./replay-select";

/** 1〜3位のバッジ色(金 / 銀 / 銅)。4位以下はバッジを出さない。 */
const RANK_BADGE_COLORS = ["#f5c451", "#c9cedb", "#cf8f5a"];

/**
 * その時点の貢献者上位。**DOM順は1位→下位**で、`row-reverse` により右端が1位になる
 * (見出し右端の「上位 ➡」がその向きを明示する)。
 *
 * 順位の入れ替わりは FLIP。並び順は再生位置の純関数で DOM を毎フレーム組み直すので、
 * 直前フレームの矩形との差を transform で埋めてから 0 へ戻す。
 */
export function ReplayContributorBoard({
  contributors,
  senders,
  colorByAnchor,
}: {
  contributors: ReplayContributor[];
  senders: ReplaySender[];
  colorByAnchor: string[];
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  // **位置は offsetLeft/offsetTop で測る。** `getBoundingClientRect()` は transform 込みの
  // 矩形を返すので、FLIP で変位させた直後の値を次フレームの基準として記録してしまい、
  // 毎フレーム差分が積み上がって全員が1点へ収束する(貢献者が1人しか見えなくなる)。
  const positions = useRef(new Map<number, { left: number; top: number }>());

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const previous = positions.current;
    const next = new Map<number, { left: number; top: number }>();
    for (const node of Array.from(board.children) as HTMLElement[]) {
      const key = Number(node.dataset.sender);
      const rect = { left: node.offsetLeft, top: node.offsetTop };
      next.set(key, rect);
      const before = previous.get(key);
      if (!before) continue;
      const dx = before.left - rect.left;
      const dy = before.top - rect.top;
      if (dx === 0 && dy === 0) continue;
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      // 次のフレームで 0 へ戻すと、CSS の transition が差分を補間する
      requestAnimationFrame(() => {
        node.style.transition = "";
        node.style.transform = "";
      });
    }
    positions.current = next;
  });

  // **0人でも領域を残す。** 高さが 0 になると、再生開始の瞬間に下のコントロールが
  // 押し上げられて飛ぶ(comp では常にこの行がある)。
  if (contributors.length === 0) {
    return (
      <div className="replay-board" ref={boardRef}>
        <span className="replay-board-empty">まだ貢献者がいません</span>
      </div>
    );
  }

  return (
    <div className="replay-board" ref={boardRef}>
      {contributors.map((contributor, index) => {
        const sender = senders[contributor.senderIndex];
        const name = sender?.n ?? "";
        const color = colorByAnchor[contributor.anchorIndex] ?? "#9a9ea6";
        return (
          <div
            key={contributor.senderIndex}
            data-sender={contributor.senderIndex}
            className={contributor.gifting ? "replay-fan replay-fan--gifting" : "replay-fan"}
            style={{
              ["--fc" as string]: color,
              ["--replay-ripple" as string]: String(rippleScaleForCoins(contributor.lastCoins)),
            }}
            title={`${name} ${contributor.coins.toLocaleString("ja-JP")}`}
          >
            {index < RANK_BADGE_COLORS.length ? (
              <span className="replay-fan-rank" style={{ background: RANK_BADGE_COLORS[index] }}>
                {index + 1}
              </span>
            ) : null}
            <span className="replay-fav">
              {sender?.a ? (
                // eslint-disable-next-line @next/next/no-img-element -- 署名付きTikTok URL(数時間で失効)
                <img src={sender.a} alt="" />
              ) : (
                initialOf(name)
              )}
            </span>
            <span className="replay-amt">{formatShortAmount(contributor.coins)}</span>
          </div>
        );
      })}
    </div>
  );
}
