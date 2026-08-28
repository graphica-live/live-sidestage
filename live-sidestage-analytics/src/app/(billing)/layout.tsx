import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import BillingHeader from "./BillingHeader";

export const metadata: Metadata = {
  title: "LIVE Sidestage プラン",
  description: "FREE/PRO/ULTRAプランの管理",
};

// 課金ページの route group。(dashboard)/(event)/(overlay-settings)はいずれも相互リンクしない
// 設計だが、各設定ページの「プランをアップグレード」からここへ遷移する経路だけは
// ユーザー承認済みの唯一の例外として扱う。ここ自身はどの製品のブランド・導線も持たない。
export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <>
      <BillingHeader />
      {children}
    </>
  );
}
