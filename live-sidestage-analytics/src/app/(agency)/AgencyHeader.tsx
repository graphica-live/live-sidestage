"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

export default function AgencyHeader() {
  return (
    <header className="border-b border-border bg-panel sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <Link
          href="/agency"
          className="text-brand font-bold text-lg shrink-0 hover:opacity-80 transition-opacity"
        >
          事務所コンソール
        </Link>

        <div className="flex items-center gap-2">
          <Link href="/analytics" className="btn-ghost text-xs shrink-0">
            配信者画面
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="btn-ghost text-xs shrink-0"
          >
            ログアウト
          </button>
        </div>
      </div>
    </header>
  );
}
