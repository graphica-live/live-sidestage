"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { signOut } from "next-auth/react";

type Period = "day" | "week" | "month";
type SortKey = "diamonds" | "count" | "name" | "recent";
type SortOrder = "asc" | "desc";

interface GiftUser {
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  giftCount: number;
  totalDiamonds: number;
  lastGiftAt: string;
}

interface AnalyticsData {
  users: GiftUser[];
  dateRange: { start: string; end: string };
  total: { giftCount: number; totalDiamonds: number };
}

interface ListenerState {
  status: "idle" | "connecting" | "connected" | "retrying" | "error";
  message: string;
  tiktokId: string;
}

const SORT_LABELS: Record<SortKey, string> = {
  diamonds: "コイン数",
  count: "ギフト数",
  name: "名前",
  recent: "最終ギフト",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(date: string, n: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function formatPeriodLabel(period: Period, date: string): string {
  const d = new Date(date + "T00:00:00");
  if (period === "day") {
    return d.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
  }
  if (period === "week") {
    const day = d.getDay();
    const daysToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setDate(d.getDate() + daysToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt = (dt: Date) =>
      `${dt.getMonth() + 1}/${dt.getDate()}`;
    return `${mon.getFullYear()}年 ${fmt(mon)} 〜 ${fmt(sun)}`;
  }
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long" });
}

function navigateDate(period: Period, date: string, dir: -1 | 1): string {
  if (period === "day") return addDays(date, dir);
  if (period === "week") return addDays(date, dir * 7);
  return addMonths(date, dir);
}

function downloadCSV(
  rows: (GiftUser & { rank: number })[],
  period: Period,
  date: string
) {
  const header = "順位,TikTokID,ニックネーム,ギフト数,コイン数\n";
  const body = rows
    .map(
      (r) =>
        `${r.rank},"${r.uniqueId}","${r.nickname.replace(/"/g, '""')}",${r.giftCount},${r.totalDiamonds}`
    )
    .join("\n");
  const blob = new Blob(["﻿" + header + body], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `liveanalytics_${period}_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("day");
  const [currentDate, setCurrentDate] = useState(todayStr());
  const [sortKey, setSortKey] = useState<SortKey>("diamonds");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [filter, setFilter] = useState("");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [listener, setListener] = useState<ListenerState | null>(null);
  const [listenerLoading, setListenerLoading] = useState(false);

  const fetchData = useCallback(
    async (p: Period, d: string) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/analytics/gifts?period=${p}&date=${d}&sort=${sortKey}&order=${sortOrder}`
        );
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
      }
    },
    [sortKey, sortOrder]
  );

  useEffect(() => {
    fetchData(period, currentDate);
  }, [period, currentDate, fetchData]);

  // Poll listener status every 5s
  useEffect(() => {
    async function pollStatus() {
      const res = await fetch("/api/listener/status");
      if (res.ok) {
        const d = await res.json();
        setListener(d.listener);
      }
    }
    pollStatus();
    const id = setInterval(pollStatus, 5000);
    return () => clearInterval(id);
  }, []);

  const sortedFiltered = useMemo(() => {
    if (!data) return [];
    const q = filter.toLowerCase();
    let rows = data.users.filter(
      (u) =>
        !q ||
        u.uniqueId.toLowerCase().includes(q) ||
        u.nickname.toLowerCase().includes(q)
    );

    rows = [...rows].sort((a, b) => {
      let diff = 0;
      if (sortKey === "diamonds") diff = a.totalDiamonds - b.totalDiamonds;
      else if (sortKey === "count") diff = a.giftCount - b.giftCount;
      else if (sortKey === "name") diff = a.nickname.localeCompare(b.nickname, "ja");
      else if (sortKey === "recent")
        diff = new Date(a.lastGiftAt).getTime() - new Date(b.lastGiftAt).getTime();
      return sortOrder === "desc" ? -diff : diff;
    });

    return rows.map((u, i) => ({ ...u, rank: i + 1 }));
  }, [data, filter, sortKey, sortOrder]);

  async function toggleListener() {
    if (!listener) return;
    setListenerLoading(true);
    const isRunning =
      listener.status === "connected" || listener.status === "connecting";
    const endpoint = isRunning ? "/api/listener/stop" : "/api/listener/start";
    await fetch(endpoint, { method: "POST" });
    await new Promise((r) => setTimeout(r, 800));
    const res = await fetch("/api/listener/status");
    if (res.ok) {
      const d = await res.json();
      setListener(d.listener);
    }
    setListenerLoading(false);
  }

  const statusColor: Record<string, string> = {
    connected: "bg-green-500",
    connecting: "bg-yellow-500 animate-pulse",
    retrying: "bg-yellow-500 animate-pulse",
    idle: "bg-gray-500",
    error: "bg-red-500",
  };

  const isActive =
    listener?.status === "connected" || listener?.status === "connecting";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-panel sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <h1 className="text-brand font-bold text-lg shrink-0">LiveAnalytics</h1>

          <div className="flex items-center gap-2 min-w-0">
            {listener && (
              <>
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
                <button
                  onClick={toggleListener}
                  disabled={listenerLoading}
                  className={`text-xs px-2.5 py-1 rounded font-medium transition-colors shrink-0 ${
                    isActive
                      ? "bg-red-900/40 text-red-300 hover:bg-red-900/60"
                      : "bg-green-900/40 text-green-300 hover:bg-green-900/60"
                  }`}
                >
                  {listenerLoading ? "..." : isActive ? "停止" : "開始"}
                </button>
              </>
            )}
          </div>

          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="btn-ghost text-xs shrink-0"
          >
            ログアウト
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-4 space-y-4">
        {/* Period tabs */}
        <div className="flex gap-1 bg-panel border border-border rounded-lg p-1 w-fit">
          {(["day", "week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => {
                setPeriod(p);
                setCurrentDate(todayStr());
              }}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                period === p
                  ? "bg-brand text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {p === "day" ? "日" : p === "week" ? "週" : "月"}
            </button>
          ))}
        </div>

        {/* Date navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentDate(navigateDate(period, currentDate, -1))}
            className="btn-ghost px-2 py-1 text-lg leading-none"
          >
            ‹
          </button>
          <span className="text-sm font-medium min-w-0 text-center flex-1 truncate">
            {formatPeriodLabel(period, currentDate)}
          </span>
          <button
            onClick={() => setCurrentDate(navigateDate(period, currentDate, 1))}
            disabled={currentDate >= todayStr()}
            className="btn-ghost px-2 py-1 text-lg leading-none disabled:opacity-30"
          >
            ›
          </button>
          {currentDate !== todayStr() && (
            <button
              onClick={() => setCurrentDate(todayStr())}
              className="btn-ghost text-xs"
            >
              今日
            </button>
          )}
        </div>

        {/* Filter + Sort + Export */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[160px]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="ユーザーを絞り込み..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="input-field pl-9 text-sm"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="input-field text-sm w-auto pr-8 appearance-none cursor-pointer"
            >
              {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(
                ([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                )
              )}
            </select>

            <button
              onClick={() =>
                setSortOrder((o) => (o === "desc" ? "asc" : "desc"))
              }
              className="btn-ghost px-2 py-2 text-sm"
              title={sortOrder === "desc" ? "降順" : "昇順"}
            >
              {sortOrder === "desc" ? "↓" : "↑"}
            </button>

            <button
              onClick={() =>
                downloadCSV(sortedFiltered, period, currentDate)
              }
              disabled={sortedFiltered.length === 0}
              className="btn-ghost flex items-center gap-1 text-xs disabled:opacity-30"
              title="CSV出力"
            >
              <DownloadIcon />
              <span className="hidden sm:inline">CSV</span>
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {data && (
          <div className="flex gap-4 text-xs text-gray-400">
            <span>
              {filter ? `${sortedFiltered.length} / ${data.users.length} 人` : `${data.users.length} 人`}
            </span>
            <span>
              合計{" "}
              {sortedFiltered
                .reduce((s, u) => s + u.totalDiamonds, 0)
                .toLocaleString()}{" "}
              コイン
            </span>
            <span>
              ギフト{" "}
              {sortedFiltered
                .reduce((s, u) => s + u.giftCount, 0)
                .toLocaleString()}{" "}
              件
            </span>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="text-center py-16 text-gray-500">読み込み中...</div>
        ) : sortedFiltered.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            {filter ? "一致するユーザーなし" : "この期間のデータなし"}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-gray-400">
                  <th className="py-2.5 px-3 text-right w-10">#</th>
                  <th className="py-2.5 px-3 text-left">ユーザー</th>
                  <th className="py-2.5 px-3 text-right">
                    <span title="コイン数">💎</span>
                  </th>
                  <th className="py-2.5 px-3 text-right hidden sm:table-cell">
                    <span title="ギフト数">🎁</span>
                  </th>
                  <th className="py-2.5 px-3 text-right hidden md:table-cell text-gray-400">
                    最終
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map((user, idx) => (
                  <tr
                    key={user.uniqueId}
                    className={`border-b border-border/50 hover:bg-white/[0.02] transition-colors ${
                      idx === 0 ? "bg-yellow-500/5" : ""
                    }`}
                  >
                    <td className="py-2.5 px-3 text-right text-gray-500 font-mono text-xs">
                      {user.rank}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar
                          src={user.profileImageUrl}
                          alt={user.nickname}
                        />
                        <div className="min-w-0">
                          <div className="font-medium truncate max-w-[140px] sm:max-w-none">
                            {user.nickname}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <span className="truncate max-w-[100px]">
                              @{user.uniqueId}
                            </span>
                            <a
                              href={`https://www.tiktok.com/@${user.uniqueId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-500 hover:text-brand transition-colors shrink-0"
                              title="TikTokプロフィールを開く"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLinkIcon />
                            </a>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-medium">
                      {user.totalDiamonds.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-400 hidden sm:table-cell">
                      {user.giftCount.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-500 text-xs hidden md:table-cell">
                      {formatRelativeTime(user.lastGiftAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function Avatar({
  src,
  alt,
}: {
  src: string | null;
  alt: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className="w-8 h-8 rounded-full object-cover shrink-0 bg-panel"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center text-gray-500 text-xs shrink-0">
      {alt.charAt(0).toUpperCase()}
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-3 h-3"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-4 h-4"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "今";
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}
