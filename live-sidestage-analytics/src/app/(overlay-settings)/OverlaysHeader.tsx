"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

// オーバーレイ設定画面のヘッダー。**analytics の要素は一切置かない。**
//
// もともと overlays/ は (dashboard) route group の中にあり、DashboardHeader が付いていた。
// あちらはリスナー接続ステータス・/setup(TikTok BIO認証)・ログアウトへの導線を持っていて、
// OBS 側の見た目を確認しに来ただけのユーザーにも analytics 側の機能が丸見えだった。
// 表向きは別サービスとして見せるため、ここはブランドとログアウトだけに絞る。
//
// セッション Cookie は analytics と共有なので、ここでのログアウトは analytics 側からも
// ログアウトすることになる(1セッション1ログイン)。ログイン画面もあえて分けていない —
// 同じ配信者アカウントの設定ページなので、event のような別ログイン導線までは不要。
export default function OverlaysHeader() {
  return (
    <header className="border-b border-border bg-panel sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <Link
          href="/overlays"
          className="flex items-baseline gap-1.5 shrink-0 hover:opacity-80 transition-opacity"
        >
          <span className="text-brand font-bold text-base sm:text-lg">LIVE Sidestage</span>
          <span className="text-gray-400 font-medium text-sm">Overlays</span>
        </Link>

        <Link
          href="/overlays/settings"
          className="btn-ghost text-xs shrink-0"
          aria-label="設定"
          title="設定"
        >
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
