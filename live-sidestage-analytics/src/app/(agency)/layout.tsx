import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import AgencyHeader from "./AgencyHeader";

// 配信者向けの (dashboard) とは別のroute group。事務所向け画面に
// 配信者用ヘッダー(リスナー状態・オーバーレイ設定)を混ぜないために分けている。
export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <>
      <AgencyHeader />
      {children}
    </>
  );
}
