"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

export function DashboardHeader({ email }: { email: string | null }) {
  return (
    <header className="border-b border-border bg-panel">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/events" className="text-sm font-bold">
          LIVE Sidestage <span className="text-brand">Event</span>
        </Link>
        <div className="flex items-center gap-2">
          {email && <span className="hidden text-xs text-gray-500 sm:inline">{email}</span>}
          <button onClick={() => signOut({ callbackUrl: "/" })} className="btn-ghost text-xs">
            ログアウト
          </button>
        </div>
      </div>
    </header>
  );
}
