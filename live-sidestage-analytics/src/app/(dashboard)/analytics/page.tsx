"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { signOut } from "next-auth/react";

type Period = "day" | "week" | "month" | "custom";
type SortKey = "diamonds" | "count" | "name" | "recent";
type HistorySortKey = "time" | "diamonds" | "user" | "gift";
type SortOrder = "asc" | "desc";
type ViewMode = "ranking" | "history";

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

interface GiftEvent {
  id: string;
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  repeatCount: number;
  totalDiamonds: number;
  receivedAt: string;
}

interface HistoryData {
  events: GiftEvent[];
  dateRange: { start: string; end: string };
  total: { count: number; diamonds: number };
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

const HISTORY_SORT_LABELS: Record<HistorySortKey, string> = {
  time: "時刻",
  diamonds: "コイン数",
  user: "ユーザー",
  gift: "ギフト名",
};

function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatCustomRangeLabel(start: string, end: string): string {
  const fmt = (d: Date) =>
    d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${fmt(new Date(start))} 〜 ${fmt(new Date(end))}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function formatEventTime(iso: string, period: Period): string {
  const d = new Date(iso);
  if (period === "day") {
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
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

function downloadHistoryCSV(events: GiftEvent[], period: Period, date: string) {
  const header = "時刻,TikTokID,ニックネーム,ギフト名,個数,コイン数\n";
  const body = events
    .map(
      (e) =>
        `"${new Date(e.receivedAt).toLocaleString("ja-JP")}","${e.uniqueId}","${e.nickname.replace(/"/g, '""')}","${e.giftName.replace(/"/g, '""')}",${e.repeatCount},${e.totalDiamonds}`
    )
    .join("\n");
  const blob = new Blob(["﻿" + header + body], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `liveanalytics_history_${period}_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("day");
  const [currentDate, setCurrentDate] = useState(todayStr());
  const [viewMode, setViewMode] = useState<ViewMode>("ranking");
  const [sortKey, setSortKey] = useState<SortKey>("diamonds");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [historySortKey, setHistorySortKey] = useState<HistorySortKey>("time");
  const [historySortOrder, setHistorySortOrder] = useState<SortOrder>("desc");
  const [filter, setFilter] = useState("");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [historyData, setHistoryData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [listener, setListener] = useState<ListenerState | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return toLocalDatetimeString(d);
  });
  const [customEnd, setCustomEnd] = useState(() => {
    const d = new Date(); d.setHours(23, 59, 59, 0); return toLocalDatetimeString(d);
  });
  const [pendingStart, setPendingStart] = useState(customStart);
  const [pendingEnd, setPendingEnd] = useState(customEnd);
  const calendarRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(
    async (p: Period, d: string, silent = false) => {
      if (!silent) setLoading(true);
      try {
        let url: string;
        if (p === "custom") {
          url = `/api/analytics/gifts?startDatetime=${encodeURIComponent(new Date(customStart).toISOString())}&endDatetime=${encodeURIComponent(new Date(customEnd).toISOString())}&sort=${sortKey}&order=${sortOrder}`;
        } else {
          url = `/api/analytics/gifts?period=${p}&date=${d}&sort=${sortKey}&order=${sortOrder}`;
        }
        const res = await fetch(url);
        if (res.ok) {
          setData(await res.json());
          setLastRefreshed(new Date());
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [sortKey, sortOrder, customStart, customEnd]
  );

  const fetchHistory = useCallback(async (p: Period, d: string, silent = false) => {
    if (!silent) setHistoryLoading(true);
    try {
      let url: string;
      if (p === "custom") {
        url = `/api/analytics/gifts/history?startDatetime=${encodeURIComponent(new Date(customStart).toISOString())}&endDatetime=${encodeURIComponent(new Date(customEnd).toISOString())}`;
      } else {
        url = `/api/analytics/gifts/history?period=${p}&date=${d}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        setHistoryData(await res.json());
        setLastRefreshed(new Date());
      }
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, [customStart, customEnd]);

  useEffect(() => {
    if (viewMode === "ranking") {
      fetchData(period, currentDate);
    } else {
      fetchHistory(period, currentDate);
    }
  }, [period, currentDate, viewMode, fetchData, fetchHistory]);

  useEffect(() => {
    if (!showCalendar) return;
    function onMouseDown(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showCalendar]);

  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;
  const fetchHistoryRef = useRef(fetchHistory);
  fetchHistoryRef.current = fetchHistory;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  // Combined poll: listener status every 5s + analytics refresh every 15s when connected
  useEffect(() => {
    let tick = 0;
    async function poll() {
      const res = await fetch("/api/listener/status");
      if (!res.ok) return;
      const d = await res.json();
      setListener(d.listener);

        tick++;
      const isActive =
        d.listener?.status === "connected" || d.listener?.status === "connecting";
      const isToday = currentDate === todayStr();
      console.log("[poll]", { tick, status: d.listener?.status, isActive, isToday, willRefresh: tick % 3 === 0 && isActive && isToday });
      if (tick % 3 === 0 && isActive && isToday) {
        console.log("[poll] triggering data refresh");
        if (viewModeRef.current === "ranking") {
          fetchDataRef.current(period, currentDate, true);
        } else {
          fetchHistoryRef.current(period, currentDate, true);
        }
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [currentDate, period]);

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

  const filteredEvents = useMemo(() => {
    if (!historyData) return [];
    const q = filter.toLowerCase();
    let events = !q
      ? historyData.events
      : historyData.events.filter(
          (e) =>
            e.uniqueId.toLowerCase().includes(q) ||
            e.nickname.toLowerCase().includes(q) ||
            e.giftName.toLowerCase().includes(q)
        );

    events = [...events].sort((a, b) => {
      let diff = 0;
      if (historySortKey === "time")
        diff = new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
      else if (historySortKey === "diamonds")
        diff = a.totalDiamonds - b.totalDiamonds;
      else if (historySortKey === "user")
        diff = a.nickname.localeCompare(b.nickname, "ja");
      else if (historySortKey === "gift")
        diff = a.giftName.localeCompare(b.giftName, "ja");
      return historySortOrder === "desc" ? -diff : diff;
    });

    return events;
  }, [historyData, filter, historySortKey, historySortOrder]);

  const statusColor: Record<string, string> = {
    connected: "bg-green-500",
    connecting: "bg-yellow-500 animate-pulse",
    retrying: "bg-yellow-500 animate-pulse",
    idle: "bg-gray-500",
    error: "bg-red-500",
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-panel sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <h1 className="text-brand font-bold text-lg shrink-0">LiveAnalytics</h1>

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

          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="btn-ghost text-xs shrink-0"
          >
            ログアウト
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-4 space-y-4">
        {/* Period tabs + View mode toggle */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
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
            <div className="w-px bg-border mx-0.5 self-stretch" />
            <div className="relative" ref={calendarRef}>
              <button
                onClick={() => {
                  setPendingStart(customStart);
                  setPendingEnd(customEnd);
                  setShowCalendar((v) => !v);
                }}
                className={`px-2 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1 ${
                  period === "custom"
                    ? "bg-brand text-white"
                    : "text-gray-400 hover:text-white"
                }`}
                title="カスタム期間"
              >
                <CalendarIcon />
              </button>
              {showCalendar && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-panel border border-border rounded-xl p-4 shadow-xl w-72">
                  <p className="text-xs text-gray-400 mb-3 font-medium">カスタム期間</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">開始日時</label>
                      <input
                        type="datetime-local"
                        step="1"
                        value={pendingStart}
                        onChange={(e) => setPendingStart(e.target.value)}
                        className="input-field text-sm w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">終了日時</label>
                      <input
                        type="datetime-local"
                        step="1"
                        value={pendingEnd}
                        onChange={(e) => setPendingEnd(e.target.value)}
                        className="input-field text-sm w-full"
                      />
                    </div>
                    <button
                      onClick={() => {
                        setCustomStart(pendingStart);
                        setCustomEnd(pendingEnd);
                        setPeriod("custom");
                        setShowCalendar(false);
                      }}
                      disabled={!pendingStart || !pendingEnd || pendingStart >= pendingEnd}
                      className="w-full bg-brand text-white rounded-lg py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      適用
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-1 bg-panel border border-border rounded-lg p-1 w-fit">
            {(["ranking", "history"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  viewMode === m
                    ? "bg-brand text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {m === "ranking" ? "ユーザー別コイン数" : "ギフト履歴"}
              </button>
            ))}
          </div>
        </div>

        {/* Date navigation */}
        <div className="flex items-center gap-2">
          {period !== "custom" && (
            <button
              onClick={() => setCurrentDate(navigateDate(period, currentDate, -1))}
              className="btn-ghost px-2 py-1 text-lg leading-none"
            >
              ‹
            </button>
          )}
          <span className="text-sm font-medium min-w-0 text-center flex-1 truncate">
            {period === "custom"
              ? formatCustomRangeLabel(customStart, customEnd)
              : formatPeriodLabel(period, currentDate)}
          </span>
          {period !== "custom" && (
            <>
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
            </>
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
              placeholder={viewMode === "history" ? "ユーザー・ギフト名で絞り込み..." : "ユーザーを絞り込み..."}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="input-field pl-9 text-sm"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {viewMode === "ranking" && (
              <>
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
              </>
            )}

            {viewMode === "history" && (
              <>
                <select
                  value={historySortKey}
                  onChange={(e) => setHistorySortKey(e.target.value as HistorySortKey)}
                  className="input-field text-sm w-auto pr-8 appearance-none cursor-pointer"
                >
                  {(Object.entries(HISTORY_SORT_LABELS) as [HistorySortKey, string][]).map(
                    ([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    )
                  )}
                </select>

                <button
                  onClick={() =>
                    setHistorySortOrder((o) => (o === "desc" ? "asc" : "desc"))
                  }
                  className="btn-ghost px-2 py-2 text-sm"
                  title={historySortOrder === "desc" ? "降順" : "昇順"}
                >
                  {historySortOrder === "desc" ? "↓" : "↑"}
                </button>
              </>
            )}

            <button
              onClick={() => {
                if (viewMode === "ranking") {
                  downloadCSV(sortedFiltered, period, currentDate);
                } else {
                  downloadHistoryCSV(filteredEvents, period, currentDate);
                }
              }}
              disabled={viewMode === "ranking" ? sortedFiltered.length === 0 : filteredEvents.length === 0}
              className="btn-ghost flex items-center gap-1 text-xs disabled:opacity-30"
              title="CSV出力"
            >
              <DownloadIcon />
              <span className="hidden sm:inline">CSV</span>
            </button>

            {viewMode === "ranking" && (
              <button
                onClick={async () => {
                  if (!confirm(`${formatPeriodLabel(period, currentDate)} のデータを全削除しますか？`)) return;
                  setDeleting(true);
                  try {
                    await fetch(`/api/analytics/gifts?period=${period}&date=${currentDate}`, { method: "DELETE" });
                    await fetchData(period, currentDate);
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting || (data?.users.length === 0)}
                className="btn-ghost flex items-center gap-1 text-xs text-red-400 hover:text-red-300 disabled:opacity-30"
                title={`この${period === "day" ? "日" : period === "week" ? "週" : "月"}のデータを削除`}
              >
                {deleting ? "削除中..." : "🗑 削除"}
              </button>
            )}
          </div>
        </div>

        {/* Stats bar */}
        {viewMode === "ranking" && data && (
          <div className="flex gap-4 text-xs text-gray-400 flex-wrap">
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
            {lastRefreshed && (
              <span className="ml-auto">
                更新 {lastRefreshed.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        )}

        {viewMode === "history" && historyData && (
          <div className="flex gap-4 text-xs text-gray-400 flex-wrap">
            <span>
              {filter ? `${filteredEvents.length} / ${historyData.events.length} 件` : `${historyData.events.length} 件`}
            </span>
            <span>
              合計{" "}
              {filteredEvents.reduce((s, e) => s + e.totalDiamonds, 0).toLocaleString()}{" "}
              コイン
            </span>
            {lastRefreshed && (
              <span className="ml-auto">
                更新 {lastRefreshed.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        )}

        {/* Ranking Table */}
        {viewMode === "ranking" && (
          loading ? (
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
          )
        )}

        {/* History Table */}
        {viewMode === "history" && (
          historyLoading ? (
            <div className="text-center py-16 text-gray-500">読み込み中...</div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              {filter ? "一致するイベントなし" : "この期間のデータなし"}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-gray-400">
                    <th className="py-2.5 px-3 text-left whitespace-nowrap">時刻</th>
                    <th className="py-2.5 px-3 text-left">ユーザー</th>
                    <th className="py-2.5 px-3 text-left">ギフト</th>
                    <th className="py-2.5 px-3 text-right">
                      <span title="コイン数">💎</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((ev) => (
                    <tr
                      key={ev.id}
                      className="border-b border-border/50 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">
                        {formatEventTime(ev.receivedAt, period)}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar src={ev.profileImageUrl} alt={ev.nickname} />
                          <div className="min-w-0">
                            <div className="font-medium truncate max-w-[120px] sm:max-w-[200px]">
                              {ev.nickname}
                            </div>
                            <div className="text-xs text-gray-500 truncate max-w-[100px]">
                              @{ev.uniqueId}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {ev.giftPictureUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={ev.giftPictureUrl}
                              alt={ev.giftName}
                              className="w-6 h-6 object-contain shrink-0"
                            />
                          )}
                          <span className="truncate">
                            {ev.giftName}
                            {ev.repeatCount > 1 && (
                              <span className="text-gray-400 ml-1">×{ev.repeatCount}</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-medium">
                        {ev.totalDiamonds.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
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

function CalendarIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
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
