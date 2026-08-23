import { Zen_Kaku_Gothic_New } from "next/font/google";

// 公開イベントページ専用のフォント・背景。ダッシュボード側の globals.css
// (Inter系システムフォント + rounded-xl card)には触れず、この route group だけで
// 「バトル興行」寄りの見た目に振る。
const zenKaku = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["500", "700", "900"],
  variable: "--font-battle",
  display: "swap",
});

export default function EventPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${zenKaku.variable} relative isolate min-h-screen bg-[#0a0a0a] font-[family-name:var(--font-battle)]`}>
      {/* 会場フロア: 斜めのラインパターン + 上からのスポットライト。装飾のみでスクロールに追従しない。 */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-60"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 44px)",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 50% -5%, rgba(254,44,85,0.22), transparent 60%)",
        }}
        aria-hidden
      />
      {children}
    </div>
  );
}
