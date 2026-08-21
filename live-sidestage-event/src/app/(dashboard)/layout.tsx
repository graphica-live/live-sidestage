import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardHeader } from "./DashboardHeader";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="min-h-screen">
      <DashboardHeader email={session.user.email ?? null} />
      <main className="mx-auto w-full max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
