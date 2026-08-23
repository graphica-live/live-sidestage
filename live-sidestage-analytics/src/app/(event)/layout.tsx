import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import EventHeader from "./EventHeader";

// Next.js の metadata はフィールド単位の浅いマージなので、title だけ上書きすると
// ルート layout.tsx の description("TikTok Live gift analytics")が events 配下へ
// そのまま継承されてしまう。リンクプレビューや検索結果に出る以上タブ title と同格なので
// 両方書く。
export const metadata: Metadata = {
  title: "LIVE Sidestage Event",
  description: "TikTok Live イベント運営",
};

// イベント管理画面の route group。(dashboard) とは意図的に分けてあり、
// analytics のヘッダー・管理者バー・metadata を一切引き継がない。
// URL は route group が出ないので /events のまま。
export default async function EventLayout({ children }: { children: React.ReactNode }) {
  // **このガードを外さないこと。** 配下のページは session!.user.id と非nullアサーション
  // しているので、middleware の除外リストを変えた拍子にここが無いと null クラッシュする。
  const session = await getServerSession(authOptions);
  if (!session) redirect("/event/login");

  return (
    <>
      <EventHeader />
      {children}
    </>
  );
}
