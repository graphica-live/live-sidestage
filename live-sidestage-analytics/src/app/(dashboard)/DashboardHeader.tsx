"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

interface ListenerState {
  status: "idle" | "connecting" | "connected" | "retrying" | "error";
  message: string;
  tiktokId: string;
}

const statusColor: Record<string, string> = {
  connected: "bg-ok shadow-[0_0_0_3px_rgba(34,197,94,.15)]",
  connecting: "bg-yellow-500 animate-pulse",
  retrying: "bg-yellow-500 animate-pulse",
  idle: "bg-muted",
  error: "bg-red-500",
};

export default function DashboardHeader({ email }: { email?: string | null }) {
  const [listener, setListener] = useState<ListenerState | null>(null);

  useEffect(() => {
    async function poll() {
      const res = await fetch("/api/listener/status");
      if (!res.ok) return;
      const d = await res.json();
      setListener(d.listener);
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="border-b border-border bg-panel sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-[18px] py-[14px] flex items-center justify-between gap-3">
        <Link href="/analytics" className="flex items-baseline gap-1.5 shrink-0 hover:opacity-80 transition-opacity">
          <span className="text-strong font-bold text-base sm:text-[1.05rem]">LIVE Sidestage</span>
          <span className="hidden sm:inline text-muted font-medium text-sm">Analytics</span>
        </Link>

        <div className="flex items-center gap-2 min-w-0">
          {listener && (
            <span className="flex items-center gap-1.5 text-xs text-muted min-w-0 truncate">
              <span
                className={`w-[9px] h-[9px] rounded-full shrink-0 ${
                  statusColor[listener.status] ?? "bg-muted"
                }`}
              />
              <span className="hidden sm:inline truncate">
                @{listener.tiktokId} · {listener.message}
              </span>
            </span>
          )}
        </div>

        {email && (
          <span
            className="text-xs text-muted truncate shrink min-w-0 max-w-[100px] sm:max-w-[160px]"
            title={email}
          >
            {email}
          </span>
        )}

        {/* オーバーレイ(/overlays)・イベント(/events)への導線はここに置かない。
            どちらも表向き別サービスとして分離してあり、analytics 側から
            存在が見えないようにしている。 */}
        <Link href="/setup" className="btn-ghost text-xs shrink-0" aria-label="設定" title="設定">
          ⚙️<span className="hidden sm:inline"> 設定</span>
        </Link>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="btn-ghost text-xs shrink-0"
        >
          ログアウト
        </button>
      </div>
    </header>
  );
}
