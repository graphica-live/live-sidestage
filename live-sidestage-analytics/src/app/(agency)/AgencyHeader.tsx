"use client";

import Link from "next/link";
import { SessionProvider, signOut } from "next-auth/react";
import { AGENCY_AUTH_BASE_PATH, AGENCY_LOGIN_PATH } from "@/lib/agency/session-cookie";

// signOut() も signIn() と同じく SessionProvider の basePath を見るため、
// 事務所側のエンドポイントを指す Provider で包む。ここで包まないと
// 配信者側(/api/auth)のセッションを消してしまう。
export default function AgencyHeader() {
  return (
    <SessionProvider basePath={AGENCY_AUTH_BASE_PATH}>
      <HeaderBar />
    </SessionProvider>
  );
}

function HeaderBar() {
  return (
    <header className="border-b border-border bg-panel sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <Link
          href="/agency"
          className="text-brand font-bold text-lg shrink-0 hover:opacity-80 transition-opacity"
        >
          事務所コンソール
        </Link>

        <button
          onClick={() => signOut({ callbackUrl: AGENCY_LOGIN_PATH })}
          className="btn-ghost text-xs shrink-0"
        >
          ログアウト
        </button>
      </div>
    </header>
  );
}
