import type { Config } from "tailwindcss";

// 配色は live-sidestage-analytics のトークンを踏襲する(DESIGN.md 参照)。
const config: Config = {
  content: ["./src/app/**/*.{js,ts,jsx,tsx,mdx}", "./src/components/**/*.{js,ts,jsx,tsx,mdx}"],
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
