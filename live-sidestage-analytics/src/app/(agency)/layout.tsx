import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { agencyAuthOptions } from "@/lib/agency/auth";
import { AGENCY_LOGIN_PATH } from "@/lib/agency/session-cookie";
import AgencyHeader from "./AgencyHeader";

// 配信者向けの (dashboard) とは別のroute group。事務所向け画面に
// 配信者用ヘッダー(リスナー状態・オーバーレイ設定)を混ぜないために分けている。
//
// セッションも配信者側とは別系統。middleware でも同じ判定をしているが、
// ページ側でも確認して「middlewareの除外設定を触ったら素通しになる」状態を作らない。
export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(agencyAuthOptions);
  if (!session) redirect(AGENCY_LOGIN_PATH);

  return (
    <>
      <AgencyHeader />
      {children}
    </>
  );
}
