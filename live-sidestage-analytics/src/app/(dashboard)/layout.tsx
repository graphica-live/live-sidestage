import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <>
      {isAdminEmail(session.user.email) && (
        <div className="bg-black border-b border-border px-4 py-1 text-right">
          <Link href="/admin" className="text-xs text-brand hover:underline">
            管理者
          </Link>
        </div>
      )}
      {children}
    </>
  );
}
