"use client";

import { useState } from "react";
import { Avatar } from "@/components/analytics/battle-types";
import type { PublicContributionPayload } from "@/lib/contribution-share";

/**
 * 貢献ランキング公開ページの本体。**`AnalyticsView.tsx` の `RankingRow` は流用しない**
 * (非exportかつ tiktokHandle 表示・内訳開閉を前提にした所有者向けコンポーネントのため)。
 * ここは読み取り専用で nickname/profileImageUrl/集計値だけを表示する。
 */
export function PublicContributionClient({ payload }: { payload: PublicContributionPayload }) {
  const sorted = [...payload.users].sort((a, b) => b.totalDiamonds - a.totalDiamonds);

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <div className="overflow-hidden rounded-xl border border-white/10 bg-panel">
        <div className="flex items-center justify-between gap-3 border-b border-row-border px-[14px] py-[10px]">
          <div className="min-w-0 flex items-center gap-2">
            <Avatar src={payload.streamer.profileImageUrl} alt={payload.streamer.nickname ?? "配信者"} size="sm" />
            <div className="min-w-0">
              <h1 className="m-0 truncate text-[13px] font-semibold text-strong">
                {payload.streamer.nickname ?? "配信者"}の貢献ランキング
              </h1>
              <div className="font-mono text-[11px] text-muted">
                {payload.dateRange.start} 〜 {payload.dateRange.end}
              </div>
            </div>
          </div>
          <CopyLinkButton />
        </div>

        <div className="px-[12px] py-[10px]">
          <div className="mb-2 font-mono text-[11px] text-muted">
            合計 🪙{payload.total.totalDiamonds.toLocaleString()} ・ {payload.total.giftCount.toLocaleString()}件
          </div>
          {sorted.length === 0 ? (
            <div className="rounded-md border border-border bg-white/[.02] px-2.5 py-6 text-center text-[11px] text-muted">
              この期間の貢献者はまだいない
            </div>
          ) : (
            <div className="max-h-96 space-y-0.5 overflow-y-auto">
              {sorted.map((u, i) => (
                <PublicRankingRow key={`${u.nickname ?? "?"}-${i}`} rank={i + 1} user={u} />
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mx-auto mt-4 max-w-lg text-center text-[11px] leading-relaxed text-muted">
        このページは配信者が発行した共有リンクで、URL を知っている人なら誰でも閲覧できる。
        <br />
        <a href="/privacy" className="underline">
          プライバシーポリシー
        </a>
      </p>
    </main>
  );
}

function PublicRankingRow({
  rank,
  user,
}: {
  rank: number;
  user: PublicContributionPayload["users"][number];
}) {
  return (
    <div className="flex items-center gap-1.5 rounded px-1 py-1">
      <span className="w-4 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">{rank}</span>
      <Avatar src={user.profileImageUrl} alt={user.nickname ?? "?"} size="sm" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{user.nickname ?? "?"}</span>
      <span className="shrink-0 font-mono text-[11.5px] text-muted">
        🪙{user.totalDiamonds.toLocaleString()} ({user.giftCount.toLocaleString()}件)
      </span>
    </div>
  );
}

function CopyLinkButton() {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  const copy = async () => {
    const url = window.location.href;
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("manual");
    }
  };

  if (state === "manual") {
    return (
      <input
        readOnly
        value={typeof window === "undefined" ? "" : window.location.href}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="共有URL"
        className="w-[160px] shrink-0 rounded-field border border-border bg-surface px-2 py-1 font-mono text-[10px] text-muted"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={state === "copied" ? "コピーした" : "リンクをコピー"}
      title={state === "copied" ? "コピーした" : "リンクをコピー"}
      className="flex shrink-0 items-center justify-center rounded-field border border-border p-1.5 text-muted transition-colors hover:text-strong"
    >
      {state === "copied" ? <CheckIcon /> : <ShareIcon />}
    </button>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
