import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/admin";

const NAV_ITEMS = [{ href: "/admin/euler-api", label: "EulerAPI" }];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();
  if (!session) redirect("/analytics");

  return (
    <div className="min-h-screen flex">
      <aside className="w-48 shrink-0 border-r border-border bg-panel min-h-screen">
        <div className="px-4 py-3 border-b border-border">
          <Link href="/analytics" className="text-xs text-gray-400 hover:text-white">
            ← 戻る
          </Link>
          <p className="text-sm font-bold text-brand mt-1">管理者画面</p>
        </div>
        <nav className="py-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-4 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
