import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LIVE Sidestage Event",
  description: "TikTok Live のイベント・大会を作って運営する",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
