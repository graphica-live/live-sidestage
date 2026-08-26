import type { CSSProperties } from "react";
import type { OverlayHeadingBackground } from "@/lib/overlay/contracts";

// 見出しの背景テーマ。配信者が設定画面から選ぶ5種類。
export const HEADING_BACKGROUND_STYLE: Record<OverlayHeadingBackground, CSSProperties> = {
  clear: {},
  "crystal-blue": {
    padding: "8px 20px",
    borderRadius: 14,
    background:
      "linear-gradient(135deg, rgba(56,189,248,0.32) 0%, rgba(37,99,235,0.22) 50%, rgba(165,243,252,0.32) 100%)",
    border: "1px solid rgba(191,235,255,0.55)",
    boxShadow: "0 4px 18px rgba(37,99,235,0.35), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
  "sakura-pink": {
    padding: "8px 20px",
    borderRadius: 14,
    background:
      "linear-gradient(135deg, rgba(255,182,213,0.38) 0%, rgba(255,214,229,0.26) 50%, rgba(255,150,190,0.32) 100%)",
    border: "1px solid rgba(255,214,229,0.6)",
    boxShadow: "0 4px 18px rgba(244,114,182,0.3), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
  black: {
    padding: "8px 20px",
    borderRadius: 14,
    background: "rgba(8,8,8,0.74)",
    border: "1px solid rgba(255,255,255,0.16)",
    boxShadow: "0 4px 18px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
  },
  white: {
    padding: "8px 20px",
    borderRadius: 14,
    background: "rgba(255,255,255,0.85)",
    backdropFilter: "blur(6px) saturate(120%)",
    WebkitBackdropFilter: "blur(6px) saturate(120%)",
    border: "3px solid rgba(0,0,0,0.65)",
    boxShadow: "0 6px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.9)",
  },
};

// 見出し2つ目のテキストとスクロールインジケーターに使うアクセントカラー。
// 背景色に応じてブランドレッド(#fe2c55)固定だと浮くため、背景と合わせて切り替える。
export const HEADING_ACCENT_COLOR: Record<OverlayHeadingBackground, string> = {
  clear: "#1a1a1a",
  "crystal-blue": "#7dd3fc",
  "sakura-pink": "#fda4c7",
  black: "#ffffff",
  white: "#1a1a1a",
};

// 背景カードのあるテーマは映像への重畳を考慮した濃い影が不要かつ白背景では逆効果なので、テーマごとに切り替える。
const HEADING_TEXT_SHADOW: Record<OverlayHeadingBackground, string> = {
  clear: "0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.85), 0 0 16px rgba(0,0,0,0.6)",
  "crystal-blue": "0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.85), 0 0 16px rgba(0,0,0,0.6)",
  "sakura-pink": "0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.85), 0 0 16px rgba(0,0,0,0.6)",
  black: "0 1px 2px rgba(0,0,0,0.6)",
  white: "none",
};

// アクセント文字用の影。clearは透過背景に黒文字を乗せるため、黒フチだと文字と同化して見えなくなる。
// 黒文字のときだけ白グローに切り替えて映像背景から浮かせる。
export const HEADING_ACCENT_TEXT_SHADOW: Record<OverlayHeadingBackground, string> = {
  ...HEADING_TEXT_SHADOW,
  clear: "0 1px 3px rgba(255,255,255,0.9), 0 0 8px rgba(255,255,255,0.75), 0 0 14px rgba(255,255,255,0.5)",
};

// 背景カードを敷かない代わりに、任意の映像の上でも文字を読めるよう濃いめの影を重ねる。
export const TEXT_SHADOW = "0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.85), 0 0 16px rgba(0,0,0,0.6)";
