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
  connected: "bg-green-500",
  connecting: "bg-yellow-500 animate-pulse",
  retrying: "bg-yellow-500 animate-pulse",
  idle: "bg-gray-500",
  error: "bg-red-500",
};

export default function DashboardHeader() {
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
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <Link href="/analytics" className="flex items-baseline gap-1.5 shrink-0 hover:opacity-80 transition-opacity">
          <span className="text-brand font-bold text-base sm:text-lg">LIVE Sidestage</span>
          <span className="hidden sm:inline text-gray-400 font-medium text-sm">Analytics</span>
        </Link>

        <div className="flex items-center gap-2 min-w-0">
          {listener && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400 min-w-0 truncate">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  statusColor[listener.status] ?? "bg-gray-500"
                }`}
              />
              <span className="hidden sm:inline truncate">
                @{listener.tiktokId} · {listener.message}
              </span>
            </span>
          )}
        </div>

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
