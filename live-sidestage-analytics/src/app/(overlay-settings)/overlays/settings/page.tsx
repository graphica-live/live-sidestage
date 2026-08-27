import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserPlan } from "@/lib/plan/get-user-plan";

export const dynamic = "force-dynamic";

// オーバーレイ設定の設定ページ。現状はプラン表示のみの最小構成。
export default async function OverlaysSettingsPage() {
  const session = await getServerSession(authOptions);
  const plan = await getUserPlan(session!.user.id);

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <h1 className="mb-6 text-xl font-bold">設定</h1>

      <div className="card space-y-3">
        <div>
          <p className="text-sm text-gray-300 font-semibold">現在のプラン</p>
          <p className="mt-1 text-lg font-bold text-brand">{plan}</p>
        </div>
        <Link href="/billing" className="btn-primary block w-full text-center text-sm">
          プランを管理する
        </Link>
      </div>
    </main>
  );
}
