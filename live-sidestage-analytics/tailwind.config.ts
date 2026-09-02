import type { Config } from "tailwindcss";

// CSS変数は "R G B"(スペース区切り)で持っている(src/app/globals.css)。
// bg-brand/40 のような opacity 修飾子を機能させるには、tailwindの色を
// rgb(var(--x) / <alpha-value>) の関数形式で解決する必要がある
// (単純な `var(--x)` 参照だと不透明な色として扱われ、/NN 修飾子が使えない)。
// 戻り値を string へキャストしているのは、tailwindcss が同梱する `Config` 型の
// colors が関数形式(実行時には正式にサポートされている)を受け付けないため。
function withOpacity(varName: string): string {
  return ((({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined
      ? `rgb(var(${varName}))`
      : `rgb(var(${varName}) / ${opacityValue})`) as unknown) as string;
}

const config: Config = {
  // src 配下を丸ごと見る。app/ と components/ だけに絞ると、
  // src/event/labels.ts のように「クラス名の文字列を定数として持つモジュール」が
  // スキャン対象から外れ、そのクラスだけ CSS から消える(バッジの色が出ない)。
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: withOpacity("--accent"),
        "brand-hover": withOpacity("--accent-hover"),
        surface: withOpacity("--bg"),
        panel: withOpacity("--panel"),
        border: withOpacity("--border"),
        "row-border": withOpacity("--row-border"),
        "row-hover": withOpacity("--row-hover"),
        "on-accent": withOpacity("--on-accent"),
        ok: withOpacity("--ok"),
        strong: withOpacity("--text-strong"),
        muted: withOpacity("--muted"),
        ink: withOpacity("--text"),
      },
      borderRadius: {
        seg: "8px",
        field: "8px",
        card: "12px",
      },
    },
  },
  plugins: [],
};

export default config;
