"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";

type NaturalSize = { width: number; height: number };

/**
 * 表の実寸(px、transform適用前の自然サイズ)。`FeederFlowOverlay` が矢印のSVGの
 * width/height・座標のclamp範囲に使う。overlayは同じ `transform: scale()` の内側に
 * 敷くので、スケール値そのものは要らない(拡縮は他のカードと同じくCSSが担う)。
 */
const BracketNaturalSizeContext = createContext<NaturalSize | null>(null);

export function useBracketNaturalSize(): NaturalSize | null {
  return useContext(BracketNaturalSizeContext);
}

/**
 * トーナメント表の表示枠。
 *
 * 表は横に長く、スマホ画面には収まらない。初期表示でいきなり横スクロールを
 * 要求すると全体像が掴めないため、**実寸を測って画面幅に収まる倍率まで縮小**する。
 * 拡大はブラウザ標準のピンチズームに任せる想定なので、ここでは縮小方向のみ扱う
 * (viewport の user-scalable 制限はしていないので、ピンチズーム自体は既に有効)。
 *
 * transform: scale() は見た目だけを縮め、レイアウト上の専有サイズは変わらない。
 * 外側の枠に縮小後の実寸(px)を明示しないと下・右に空白が残るため、
 * 計測した自然サイズ×倍率を wrapper に固定値として与えている。
 *
 * 計測は `scrollWidth`/`scrollHeight` を使う。これらは transform の影響を
 * 受けない(transform はペイント時の見た目だけを変え、レイアウトサイズには
 * 効かない)ので、**measure 前に等倍へ戻す必要はない**。以前はDOM styleを
 * 直接リセットしてから測っていたが、Reactの再レンダーと競合し、開発モードの
 * StrictMode二重実行時にまれに scale が適用されないまま残るレースがあった。
 */
export function BracketScroller({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const fit = () => {
      const naturalWidth = inner.scrollWidth;
      const naturalHeight = inner.scrollHeight;
      const containerWidth = outer.clientWidth;
      const scale = naturalWidth > containerWidth ? containerWidth / naturalWidth : 1;
      setBox({ scale, width: naturalWidth, height: naturalHeight });
    };

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div ref={outerRef} className="overflow-x-auto pb-4">
      <div
        style={
          box ? { width: box.width * box.scale, height: box.height * box.scale } : undefined
        }
      >
        <div
          ref={innerRef}
          style={
            box && box.scale < 1
              ? { transform: `scale(${box.scale})`, transformOrigin: "top left" }
              : undefined
          }
        >
          <BracketNaturalSizeContext.Provider
            value={box ? { width: box.width, height: box.height } : null}
          >
            {children}
          </BracketNaturalSizeContext.Provider>
        </div>
      </div>
    </div>
  );
}
