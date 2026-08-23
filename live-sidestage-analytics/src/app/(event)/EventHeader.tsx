import Link from "next/link";

// イベント管理画面のヘッダー。**analytics の要素は一切置かない。**
//
// もともと events/ は (dashboard) route group の中にあり、DashboardHeader が付いていた。
// あちらはリスナー接続ステータス・貢献リストオーバーレイ設定・/setup(TikTok BIO認証)への
// 導線を持っていて、イベント主催者から見ると別サービスの機能がそのまま露出していた。
// 表向きは別サービスとして見せるため、ここはブランドと一覧への導線だけに絞る。
export default function EventHeader() {
  return (
    <header className="border-b border-border bg-panel sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center">
        <Link
          href="/events"
          className="flex items-baseline gap-1.5 shrink-0 hover:opacity-80 transition-opacity"
        >
          <span className="text-brand font-bold text-base sm:text-lg">LIVE Sidestage</span>
          <span className="text-gray-400 font-medium text-sm">Event</span>
        </Link>
      </div>
    </header>
  );
}
