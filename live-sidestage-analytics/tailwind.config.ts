import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
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
