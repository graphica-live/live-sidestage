"use client";

import { useEffect, useRef } from "react";

/**
 * トーナメント表の横スクロール枠。
 *
 * 決勝を中央に置く形なので、左端のままだと**画面が狭いときに1回戦しか見えない**。
 * 表の中心(決勝)が最初に見えるよう、初期位置を真ん中へ寄せる。
 *
 * スクロール位置を触るだけなので、失敗しても表示自体は成立する。
 */
export function BracketScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 収まっているなら動かさない(PC で無用に横スクロールを発生させない)。
    if (el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, []);

  return (
    <div ref={ref} className="overflow-x-auto pb-4">
      {children}
    </div>
  );
}
