"use client";

import { useCallback, useRef, useState } from "react";
import { Avatar, tiktokProfileUrl } from "@/components/analytics/battle-types";
import type { PublicContributionPayload } from "@/lib/contribution-share";

const GIFT_TILE_BG = "rgba(127,127,127,.12)";
const SKELETON_BG = "rgba(127,127,127,.16)";

interface GiftBreakdownEntry {
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  repeatCount: number;
  totalDiamonds: number;
}

interface GiftBreakdownData {
  gifts: GiftBreakdownEntry[];
  coverage: { detailAvailable: boolean; rawFrom: string | null; partial: boolean };
  truncated?: boolean;
}

type BreakdownState =
  | { status: "loading" }
  | { status: "ready"; data: GiftBreakdownData }
  | { status: "error" };

/**
 * 貢献ランキング公開ページの本体。所有者向け `AnalyticsView.tsx` の `RankingRow` /
 * `RankingBreakdownRow` と同等(プロフィールリンク・tiktokHandle表示・ギフト内訳アコーディオン)を
 * 読み取り専用で再現する(ユーザー指示: 2026-09-11、非公開化・内訳省略の当初方針を撤回)。
 * `RankingRow` 自体は非exportかつ仮想化テーブル前提のため直接流用しない。
 */
export function PublicContributionClient({
  token,
  payload,
}: {
  token: string;
  payload: PublicContributionPayload;
}) {
  const sorted = [...payload.users].sort((a, b) => b.totalDiamonds - a.totalDiamonds);
  const [openTiktokUid, setOpenTiktokUid] = useState<string | null>(null);
  const [breakdowns, setBreakdowns] = useState<Record<string, BreakdownState>>({});

  const fetchBreakdown = useCallback(
    async (tiktokUid: string) => {
      setBreakdowns((prev) => ({ ...prev, [tiktokUid]: { status: "loading" } }));
      try {
        const res = await fetch(
          `/api/public/contribution/${token}/breakdown?tiktokUid=${encodeURIComponent(tiktokUid)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as GiftBreakdownData;
        setBreakdowns((prev) => ({ ...prev, [tiktokUid]: { status: "ready", data } }));
      } catch {
        setBreakdowns((prev) => ({ ...prev, [tiktokUid]: { status: "error" } }));
      }
    },
    [token]
  );

  // breakdowns を ref でも保持し、setOpenTiktokUid の関数型更新の中で最新値を参照する
  // (連続クリックで toggleBreakdown が古い state をクロージャに残したまま呼ばれても、
  // 二重フェッチを起こさないため)。
  const breakdownsRef = useRef(breakdowns);
  breakdownsRef.current = breakdowns;

  const toggleBreakdown = useCallback(
    (tiktokUid: string) => {
      setOpenTiktokUid((prev) => {
        const willOpen = prev !== tiktokUid;
        if (willOpen && !breakdownsRef.current[tiktokUid]) void fetchBreakdown(tiktokUid);
        return willOpen ? tiktokUid : null;
      });
    },
    [fetchBreakdown]
  );

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
                <PublicRankingRow
                  key={u.tiktokUid}
                  rank={i + 1}
                  user={u}
                  open={openTiktokUid === u.tiktokUid}
                  onToggle={() => toggleBreakdown(u.tiktokUid)}
                  breakdownState={breakdowns[u.tiktokUid]}
                  onRetry={() => void fetchBreakdown(u.tiktokUid)}
                />
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
  open,
  onToggle,
  breakdownState,
  onRetry,
}: {
  rank: number;
  user: PublicContributionPayload["users"][number];
  open: boolean;
  onToggle: () => void;
  breakdownState: BreakdownState | undefined;
  onRetry: () => void;
}) {
  const panelId = `gift-breakdown-${user.tiktokUid}`;
  // TikTokUser 未観測ならハンドルが無く、プロフィールURLを作れない(所有者向けRankingRowと同じ)。
  const profileUrl = user.tiktokHandle ? tiktokProfileUrl(user.tiktokHandle) : null;

  return (
    <div className={`rounded px-1 py-1 ${open ? "bg-row-hover" : ""}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button")) return;
          onToggle();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle();
        }}
        className="flex items-center gap-1.5 cursor-pointer"
      >
        <span className="w-4 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">{rank}</span>
        {profileUrl ? (
          <a href={profileUrl} target="_blank" rel="noopener noreferrer" title="TikTokプロフィールを開く" className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Avatar src={user.profileImageUrl} alt={user.nickname ?? "?"} size="sm" />
          </a>
        ) : (
          <Avatar src={user.profileImageUrl} alt={user.nickname ?? "?"} size="sm" />
        )}
        <div className="min-w-0 flex-1">
          {profileUrl ? (
            <a
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="TikTokプロフィールを開く"
              className="truncate text-xs font-medium block hover:text-brand transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {user.nickname ?? "?"}
            </a>
          ) : (
            <span className="truncate text-xs font-medium block">{user.nickname ?? "?"}</span>
          )}
          {user.tiktokHandle && (
            <span className="truncate text-[10px] text-muted block">@{user.tiktokHandle}</span>
          )}
        </div>
        <span className="shrink-0 font-mono text-[11.5px] text-muted">
          🪙{user.totalDiamonds.toLocaleString()} ({user.giftCount.toLocaleString()}件)
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${user.nickname ?? "?"} のギフト内訳を${open ? "閉じる" : "開く"}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`w-[22px] h-[22px] shrink-0 inline-flex items-center justify-center rounded-lg motion-safe:transition-transform duration-150 ${
            open ? "text-brand rotate-180" : "text-muted"
          }`}
        >
          <ChevronDownIcon />
        </button>
      </div>
      {open && (
        <div id={panelId} className="pt-2 pb-2.5 pl-[26px] pr-1">
          <GiftBreakdownPanel state={breakdownState} onRetry={onRetry} />
        </div>
      )}
    </div>
  );
}

function GiftBreakdownPanel({ state, onRetry }: { state: BreakdownState | undefined; onRetry: () => void }) {
  const heading = <span className="text-[.68rem] tracking-[.06em] font-semibold text-muted">ギフト内訳</span>;

  if (!state || state.status === "loading") {
    return (
      <div aria-busy="true">
        <div className="mb-2">{heading}</div>
        {["78%", "60%", "69%"].map((w) => (
          <div key={w} className="h-3 rounded my-[7px]" style={{ width: w, backgroundColor: SKELETON_BG }} />
        ))}
        <span className="sr-only">ギフト内訳を読み込み中</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <div className="mb-2">{heading}</div>
        <div className="text-[.78rem] text-muted">内訳を取得できなかった。</div>
        <button type="button" onClick={onRetry} className="btn-secondary mt-2 text-[.75rem] px-2.5 py-1">
          再試行
        </button>
      </div>
    );
  }

  const { gifts, coverage, truncated } = state.data;

  if (!coverage.detailAvailable) {
    return (
      <div>
        <div className="mb-2">{heading}</div>
        <div className="text-[.78rem] text-muted">
          この期間の内訳は残っていない(ギフト明細は90日で削除される)。
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap mb-2">
        {heading}
        {coverage.partial && coverage.rawFrom && (
          <span className="ml-auto text-[.68rem] text-muted">{coverage.rawFrom} 以降のみ</span>
        )}
        {truncated && <span className="ml-auto text-[.68rem] text-muted">上位{gifts.length}件のみ表示</span>}
      </div>
      {gifts.length === 0 ? (
        <div className="text-[.78rem] text-muted">この期間の内訳はない。</div>
      ) : (
        <div className="grid grid-cols-1 gap-y-0.5">
          {gifts.map((g) => (
            <div key={g.giftId} className="flex items-center gap-2 min-w-0 py-[6px] border-b border-row-border">
              {g.giftPictureUrl ? (
                <img
                  src={g.giftPictureUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-5 h-5 shrink-0 object-contain rounded-md"
                  style={{ backgroundColor: GIFT_TILE_BG }}
                />
              ) : (
                <div className="w-5 h-5 shrink-0 rounded-md" style={{ backgroundColor: GIFT_TILE_BG }} aria-hidden="true" />
              )}
              <span className="flex-1 min-w-0 truncate text-[.75rem] text-strong">{g.giftName}</span>
              <span className="shrink-0 font-mono text-[.68rem] text-muted">×{g.repeatCount.toLocaleString()}</span>
              <span className="shrink-0 font-mono text-[.75rem] font-bold text-strong min-w-[50px] text-right">
                {g.totalDiamonds.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
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
