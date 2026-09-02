"use client";

import { signOut } from "next-auth/react";

// 課金ページのヘッダー。analytics/event/overlaysのいずれのブランド・導線も持たない。
//
// (dashboard)/(event)/(overlay-settings)は互いにリンクしない設計だが、各設定ページの
// 「プランをアップグレード」からここへ遷移する経路だけはユーザー承認済みの唯一の例外。
// ここ自身から特定の製品へ戻るリンクは作らない(どの製品から来たか分からないため、
// ブランドロゴも非リンクのプレーンテキストにしてある)。
export default function BillingHeader() {
  return (
    <header className="border-b border-border bg-panel sticky top-0 z-10">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <span className="flex items-baseline gap-1.5 shrink-0">
          <span className="text-brand font-bold text-base sm:text-lg">LIVE Sidestage</span>
          <span className="text-muted font-medium text-sm">プラン</span>
        </span>

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
