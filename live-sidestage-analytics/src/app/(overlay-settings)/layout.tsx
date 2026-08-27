import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import OverlaysHeader from "./OverlaysHeader";

// metadata はフィールド単位の浅いマージなので、title だけ上書きすると
// ルート layout.tsx の description がそのまま継承される。両方書く。
export const metadata: Metadata = {
  title: "LIVE Sidestage Overlays",
  description: "OBSオーバーレイ設定",
};

// オーバーレイ設定画面の route group。(dashboard) とは意図的に分けてあり、
// analytics のヘッダー・導線・metadata を一切引き継がない。
// URL は route group が出ないので /overlays のまま。
export default async function OverlaySettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <>
      <OverlaysHeader />
      {children}
    </>
  );
}
