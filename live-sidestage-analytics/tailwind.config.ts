import type { Config } from "tailwindcss";

const config: Config = {
  // src 配下を丸ごと見る。app/ と components/ だけに絞ると、
  // src/event/labels.ts のように「クラス名の文字列を定数として持つモジュール」が
  // スキャン対象から外れ、そのクラスだけ CSS から消える(バッジの色が出ない)。
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: "#fe2c55",
        "brand-hover": "#e91e50",
        surface: "#111111",
        panel: "#1a1a1a",
        border: "#2a2a2a",
      },
    },
  },
  plugins: [],
};

export default config;
