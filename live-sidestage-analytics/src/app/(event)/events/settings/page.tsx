import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserPlan } from "@/lib/plan/get-user-plan";

export const dynamic = "force-dynamic";

// イベント運営の設定ページ。現状はプラン表示のみの最小構成。
// イベント固有の設定項目が増えたらここに足す。
export default async function EventSettingsPage() {
  const session = await getServerSession(authOptions);
  const plan = await getUserPlan(session!.user.id);

  return (
    <div className="max-w-md">
      <h1 className="mb-6 text-xl font-bold">設定</h1>

      <div className="card space-y-3">
        <div>
          <p className="text-sm text-strong font-semibold">現在のプラン</p>
          <p className="mt-1 text-lg font-bold text-brand">{plan}</p>
        </div>
        <Link href="/billing" className="btn-primary block w-full text-center text-sm">
          プランを管理する
        </Link>
      </div>
    </div>
  );
}
