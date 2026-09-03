"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { BattleDetailModal } from "./BattleDetailModal";
import { Avatar, BattleVersus, BATTLE_STATUS_LABELS, tiktokProfileUrl, type BattleListItem, type BattleStatus } from "./battle-types";

type Period = "day" | "week" | "month" | "year" | "custom";
type SortKey = "diamonds" | "count" | "name" | "recent";
type HistorySortKey = "time" | "diamonds" | "user" | "gift";
type SortOrder = "asc" | "desc";
type ViewMode = "ranking" | "history" | "battles";

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
  verified?: boolean;
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
  edited: boolean;
}

interface HistoryData {
  events: GiftEvent[];
  dateRange: { start: string; end: string };
  total: { count: number; diamonds: number };
  verified?: boolean;
}

interface BattlesData {
  battles: BattleListItem[];
  dateRange: { start: string; end: string };
  verified?: boolean;
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
  // サーバー(UTC想定)とクライアント(JST)でローカル時刻の「今日」がズレると
  // hydration mismatchが起きるため、常にAsia/Tokyoで計算する
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function addYears(date: string, n: number): string {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + n);
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
  if (period === "month") {
    return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long" });
  }
  return d.toLocaleDateString("ja-JP", { year: "numeric" });
}

function navigateDate(period: Period, date: string, dir: -1 | 1): string {
  if (period === "day") return addDays(date, dir);
  if (period === "week") return addDays(date, dir * 7);
  if (period === "month") return addMonths(date, dir);
  return addYears(date, dir);
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
  a.download = `live-sidestage-analytics_${period}_${date}.csv`;
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
  a.download = `live-sidestage-analytics_history_${period}_${date}.csv`;
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
  const [battlesData, setBattlesData] = useState<BattlesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [battlesLoading, setBattlesLoading] = useState(false);
  const [openBattleId, setOpenBattleId] = useState<string | null>(null);
  const [hideLowDiamond, setHideLowDiamond] = useState(true);
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
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ giftName: string; totalDiamonds: string }>({
    giftName: "",
    totalDiamonds: "",
  });
  const [editSaving, setEditSaving] = useState(false);

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
          const json = await res.json();
          setData(json);
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
        const json = await res.json();
        setHistoryData(json);
        setLastRefreshed(new Date());
      }
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, [customStart, customEnd]);

  const fetchBattles = useCallback(async (p: Period, d: string, silent = false) => {
    if (!silent) setBattlesLoading(true);
    try {
      let url: string;
      if (p === "custom") {
        url = `/api/analytics/battles?startDatetime=${encodeURIComponent(new Date(customStart).toISOString())}&endDatetime=${encodeURIComponent(new Date(customEnd).toISOString())}`;
      } else {
        url = `/api/analytics/battles?period=${p}&date=${d}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setBattlesData(json);
        setLastRefreshed(new Date());
      }
    } finally {
      if (!silent) setBattlesLoading(false);
    }
  }, [customStart, customEnd]);

  useEffect(() => {
    if (viewMode === "ranking") {
      fetchData(period, currentDate);
    } else if (viewMode === "history") {
      fetchHistory(period, currentDate);
    } else {
      fetchBattles(period, currentDate);
    }
  }, [period, currentDate, viewMode, fetchData, fetchHistory, fetchBattles]);

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

  useEffect(() => {
    if (!showSortMenu) return;
    function onMouseDown(e: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showSortMenu]);

  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;
  const fetchHistoryRef = useRef(fetchHistory);
  fetchHistoryRef.current = fetchHistory;
  const fetchBattlesRef = useRef(fetchBattles);
  fetchBattlesRef.current = fetchBattles;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  // Combined poll: listener status every 5s + analytics refresh every 15s when connected
  useEffect(() => {
    let tick = 0;
    async function poll() {
      const res = await fetch("/api/listener/status");
      if (!res.ok) return;
      const d = await res.json();

      tick++;
      const isActive =
        d.listener?.status === "connected" || d.listener?.status === "connecting";
      const isToday = currentDate === todayStr();
      console.log("[poll]", { tick, status: d.listener?.status, isActive, isToday, willRefresh: tick % 3 === 0 && isActive && isToday });
      if (tick % 3 === 0 && isActive && isToday) {
        console.log("[poll] triggering data refresh");
        if (viewModeRef.current === "ranking") {
          fetchDataRef.current(period, currentDate, true);
        } else if (viewModeRef.current === "history") {
          fetchHistoryRef.current(period, currentDate, true);
        } else {
          fetchBattlesRef.current(period, currentDate, true);
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

  const filteredBattles = useMemo(() => {
    if (!battlesData) return [];
    const q = filter.toLowerCase();
    return battlesData.battles.filter((b) => {
      if (hideLowDiamond && b.selfTotalDiamonds <= 100) return false;
      if (!q) return true;
      const opponent = b.opponent;
      return (
        opponent?.tiktokId?.toLowerCase().includes(q) ||
        opponent?.displayId?.toLowerCase().includes(q) ||
        opponent?.nickName?.toLowerCase().includes(q) ||
        false
      );
    });
  }, [battlesData, filter, hideLowDiamond]);

  const giftNameSuggestions = useMemo(() => {
    if (!historyData) return [];
    return Array.from(new Set(historyData.events.map((e) => e.giftName))).sort((a, b) =>
      a.localeCompare(b, "ja")
    );
  }, [historyData]);

  const coinSuggestions = useMemo(() => {
    if (!historyData) return [];
    return Array.from(new Set(historyData.events.map((e) => e.totalDiamonds))).sort((a, b) => a - b);
  }, [historyData]);

  const startEdit = useCallback((ev: GiftEvent) => {
    setEditingId(ev.id);
    setEditDraft({ giftName: ev.giftName, totalDiamonds: String(ev.totalDiamonds) });
  }, []);

  const stopEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const commitEdit = useCallback(async (ev: GiftEvent) => {
    const giftName = editDraft.giftName.trim();
    const totalDiamonds = Number(editDraft.totalDiamonds);
    if (!giftName || !Number.isInteger(totalDiamonds)) return;
    if (giftName === ev.giftName && totalDiamonds === ev.totalDiamonds) return;

    setEditSaving(true);
    try {
      const res = await fetch(`/api/analytics/gifts/history/${ev.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ giftName, totalDiamonds }),
      });
      if (res.ok) {
        const updated = await res.json();
        setHistoryData((prev) =>
          prev
            ? {
                ...prev,
                events: prev.events.map((e) =>
                  e.id === ev.id
                    ? { ...e, giftName: updated.giftName, totalDiamonds: updated.totalDiamonds, edited: true }
                    : e
                ),
              }
            : prev
        );
      }
    } finally {
      setEditSaving(false);
    }
  }, [editDraft]);

  return (
    <>
    <main className="max-w-4xl mx-auto w-full px-4 py-4 space-y-4">
        {/* Period tabs + View mode toggle */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-0.5 bg-panel border border-border rounded-seg p-[3px] w-fit">
            {(["day", "week", "month", "year"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPeriod(p);
                  setCurrentDate(todayStr());
                }}
                className={`px-[13px] py-[7px] rounded-[5px] text-[.78rem] font-semibold transition-colors ${
                  period === p
                    ? "bg-brand text-on-accent shadow-[0_1px_2px_rgba(16,24,40,.08)]"
                    : "text-muted hover:text-strong"
                }`}
              >
                {p === "day" ? "日" : p === "week" ? "週" : p === "month" ? "月" : "年"}
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
                className={`px-2 py-[7px] rounded-[5px] text-[.78rem] font-semibold transition-colors flex items-center gap-1 ${
                  period === "custom"
                    ? "bg-brand text-on-accent shadow-[0_1px_2px_rgba(16,24,40,.08)]"
                    : "text-muted hover:text-strong"
                }`}
                title="カスタム期間"
              >
                <CalendarIcon />
              </button>
              {showCalendar && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-panel border border-border rounded-xl p-4 shadow-xl w-72">
                  <p className="text-xs text-muted mb-3 font-medium">カスタム期間</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-muted block mb-1">開始日時</label>
                      <input
                        type="datetime-local"
                        step="1"
                        value={pendingStart}
                        onChange={(e) => setPendingStart(e.target.value)}
                        className="input-field text-sm w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted block mb-1">終了日時</label>
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
                      className="w-full bg-brand text-on-accent rounded-lg py-2 text-sm font-medium hover:bg-brand-hover disabled:opacity-40 transition-colors"
                    >
                      適用
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-0.5 bg-panel border border-border rounded-seg p-[3px] w-fit">
            {(["ranking", "history", "battles"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-[13px] py-[7px] rounded-[5px] text-[.78rem] font-semibold transition-colors ${
                  viewMode === m
                    ? "bg-brand text-on-accent shadow-[0_1px_2px_rgba(16,24,40,.08)]"
                    : "text-muted hover:text-strong"
                }`}
              >
                {m === "ranking" ? "ユーザー別コイン数" : m === "history" ? "ギフト履歴" : "バトル履歴"}
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
          <span className="text-sm font-medium text-strong min-w-0 text-center flex-1 truncate">
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
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={
                viewMode === "history"
                  ? "ユーザー・ギフト名で絞り込み..."
                  : viewMode === "battles"
                    ? "対戦相手を絞り込み..."
                    : "ユーザーを絞り込み..."
              }
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="input-field pl-9 text-sm"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {(viewMode === "ranking" || viewMode === "history") && (
              <div className="relative" ref={sortMenuRef}>
                <button
                  onClick={() => setShowSortMenu((v) => !v)}
                  className="btn-ghost text-[.76rem] font-semibold px-2.5 py-2"
                >
                  並び替え ▾
                </button>
                {showSortMenu && (
                  <div className="absolute top-full right-0 mt-1 z-50 bg-panel border border-border rounded-xl p-3 shadow-xl w-48 flex items-center gap-1.5">
                    {viewMode === "ranking" ? (
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
                          className="btn-ghost px-2 py-2 text-sm shrink-0"
                          title={sortOrder === "desc" ? "降順" : "昇順"}
                        >
                          {sortOrder === "desc" ? "↓" : "↑"}
                        </button>
                      </>
                    ) : (
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
                          className="btn-ghost px-2 py-2 text-sm shrink-0"
                          title={historySortOrder === "desc" ? "降順" : "昇順"}
                        >
                          {historySortOrder === "desc" ? "↓" : "↑"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {viewMode !== "battles" && (
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
            )}

            {viewMode === "ranking" && (
              <button
                onClick={async () => {
                  if (!confirm(`${formatPeriodLabel(period, currentDate)} のデータを自分の表示からのみ非表示にします。同じTikTok IDの他の登録者には影響しません。よろしいですか？`)) return;
                  setDeleting(true);
                  try {
                    await fetch(`/api/analytics/gifts?period=${period}&date=${currentDate}`, { method: "DELETE" });
                    await fetchData(period, currentDate);
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting || (data?.users.length === 0)}
                className="btn-ghost flex items-center gap-1 text-xs text-red-600 dark:text-red-400 hover:text-red-300 disabled:opacity-30"
                title={`この${period === "day" ? "日" : period === "week" ? "週" : period === "month" ? "月" : "年"}のデータを自分の表示からのみ非表示にする(他の登録者には影響しません)`}
              >
                {deleting ? "処理中..." : "🙈 非表示"}
              </button>
            )}
          </div>
        </div>

        {/* Stats bar + Table */}
        <div className="relative">
          <div className="space-y-4">
        {viewMode === "ranking" && data && (
          <div className="flex gap-4 text-[.74rem] text-muted flex-wrap">
            <span>
              <b className="text-strong font-bold">{filter ? sortedFiltered.length : data.users.length}</b>
              {filter ? ` / ${data.users.length} 人` : " 人"}
            </span>
            <span>
              合計{" "}
              <b className="text-strong font-bold">
                {sortedFiltered.reduce((s, u) => s + u.totalDiamonds, 0).toLocaleString()}
              </b>{" "}
              コイン
            </span>
            <span>
              ギフト{" "}
              <b className="text-strong font-bold">
                {sortedFiltered.reduce((s, u) => s + u.giftCount, 0).toLocaleString()}
              </b>{" "}
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
          <div className="flex gap-4 text-[.74rem] text-muted flex-wrap">
            <span>
              <b className="text-strong font-bold">{filter ? filteredEvents.length : historyData.events.length}</b>
              {filter ? ` / ${historyData.events.length} 件` : " 件"}
            </span>
            <span>
              合計{" "}
              <b className="text-strong font-bold">
                {filteredEvents.reduce((s, e) => s + e.totalDiamonds, 0).toLocaleString()}
              </b>{" "}
              コイン
            </span>
            {lastRefreshed && (
              <span className="ml-auto">
                更新 {lastRefreshed.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        )}

        {viewMode === "battles" && battlesData && (
          <div className="flex gap-4 text-[.74rem] text-muted flex-wrap items-center">
            <span>
              {filter || hideLowDiamond
                ? `${filteredBattles.length} / ${battlesData.battles.length} 件`
                : `${battlesData.battles.length} 件`}
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideLowDiamond}
                onChange={(e) => setHideLowDiamond(e.target.checked)}
                className="cursor-pointer"
              />
              コイン100以下を非表示
            </label>
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
            <div className="text-center py-16 text-muted">読み込み中...</div>
          ) : sortedFiltered.length === 0 ? (
            <div className="text-center py-16 text-muted">
              {filter ? "一致するユーザーなし" : "この期間のデータなし"}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-card border border-border shadow-[0_1px_2px_rgba(16,24,40,.05)]">
              <table className="w-full text-[.84rem]">
                <thead>
                  <tr className="border-b border-border text-[.68rem] tracking-[.02em] text-muted bg-panel">
                    <th className="py-[9px] px-3 text-right w-10 font-semibold">#</th>
                    <th className="py-[9px] px-3 text-left font-semibold">ユーザー</th>
                    <th className="py-[9px] px-3 text-right font-semibold">
                      <span title="コイン数">💎</span>
                    </th>
                    <th className="py-[9px] px-3 text-right hidden sm:table-cell font-semibold">
                      <span title="ギフト数">🎁</span>
                    </th>
                    <th className="py-[9px] px-3 text-right hidden md:table-cell font-semibold text-muted">
                      最終
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFiltered.map((user, idx) => (
                    <tr
                      key={user.uniqueId}
                      className={`border-b border-row-border hover:bg-row-hover transition-colors ${
                        idx === 0 ? "bg-yellow-500/5" : ""
                      }`}
                    >
                      <td className="py-[9px] px-3 text-right text-muted font-mono text-xs">
                        {user.rank}
                      </td>
                      <td className="py-[9px] px-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <a
                            href={tiktokProfileUrl(user.uniqueId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="TikTokプロフィールを開く"
                            className="shrink-0"
                          >
                            <Avatar
                              src={user.profileImageUrl}
                              alt={user.nickname}
                            />
                          </a>
                          <div className="min-w-0">
                            <a
                              href={tiktokProfileUrl(user.uniqueId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="TikTokプロフィールを開く"
                              className="font-semibold text-strong truncate max-w-[140px] sm:max-w-none hover:text-brand transition-colors block"
                            >
                              {user.nickname}
                            </a>
                            <div className="flex items-center gap-1 text-xs text-muted">
                              <span className="truncate max-w-[100px]">
                                @{user.uniqueId}
                              </span>
                              <a
                                href={tiktokProfileUrl(user.uniqueId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted hover:text-brand transition-colors shrink-0"
                                title="TikTokプロフィールを開く"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLinkIcon />
                              </a>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-[9px] px-3 text-right font-mono font-bold text-strong">
                        {user.totalDiamonds.toLocaleString()}
                      </td>
                      <td className="py-[9px] px-3 text-right text-muted hidden sm:table-cell">
                        {user.giftCount.toLocaleString()}
                      </td>
                      <td className="py-[9px] px-3 text-right text-muted text-xs hidden md:table-cell">
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
            <div className="text-center py-16 text-muted">読み込み中...</div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-16 text-muted">
              {filter ? "一致するイベントなし" : "この期間のデータなし"}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="py-2.5 px-3 text-left whitespace-nowrap">時刻</th>
                    <th className="py-2.5 px-3 text-left">ユーザー</th>
                    <th className="py-2.5 px-3 text-left">ギフト</th>
                    <th className="py-2.5 px-3 text-right">
                      <span title="コイン数">💎</span>
                    </th>
                    <th className="py-2.5 px-3 text-center w-10">編集</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((ev) => {
                    const isEditing = editingId === ev.id;
                    return (
                      <tr
                        key={ev.id}
                        className="border-b border-row-border hover:bg-row-hover transition-colors"
                      >
                        <td className="py-2 px-3 text-xs text-muted whitespace-nowrap">
                          {formatEventTime(ev.receivedAt, period)}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <a
                              href={tiktokProfileUrl(ev.uniqueId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="TikTokプロフィールを開く"
                              className="shrink-0"
                            >
                              <Avatar src={ev.profileImageUrl} alt={ev.nickname} />
                            </a>
                            <div className="min-w-0">
                              <a
                                href={tiktokProfileUrl(ev.uniqueId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="TikTokプロフィールを開く"
                                className="font-medium truncate max-w-[120px] sm:max-w-[200px] hover:text-brand transition-colors block"
                              >
                                {ev.nickname}
                              </a>
                              <div className="text-xs text-muted truncate max-w-[100px]">
                                @{ev.uniqueId}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          {isEditing ? (
                            <input
                              type="text"
                              list="gift-name-suggestions"
                              value={editDraft.giftName}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, giftName: e.target.value }))
                              }
                              onBlur={() => commitEdit(ev)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                              placeholder="例: Rose"
                              disabled={editSaving}
                              className="input-field text-sm w-full min-w-[110px]"
                            />
                          ) : (
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
                                  <span className="text-muted ml-1">×{ev.repeatCount}</span>
                                )}
                              </span>
                              {ev.edited && (
                                <span
                                  className="text-[10px] text-brand shrink-0"
                                  title="編集データ(オリジナルとは別に保持されています)"
                                >
                                  編集済
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-medium">
                          {isEditing ? (
                            <input
                              type="number"
                              list="coin-suggestions"
                              value={editDraft.totalDiamonds}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, totalDiamonds: e.target.value }))
                              }
                              onBlur={() => commitEdit(ev)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                              placeholder="例: 100"
                              disabled={editSaving}
                              className="input-field text-sm w-24 text-right ml-auto"
                            />
                          ) : (
                            ev.totalDiamonds.toLocaleString()
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            onClick={() => (isEditing ? stopEdit() : startEdit(ev))}
                            className="btn-ghost p-1.5"
                            title={isEditing ? "編集を終了" : "このギフトを編集"}
                          >
                            {isEditing ? <CheckIcon /> : <PencilIcon />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="gift-name-suggestions">
                {giftNameSuggestions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <datalist id="coin-suggestions">
                {coinSuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          )
        )}

        {/* Battles Table */}
        {viewMode === "battles" && (
          battlesLoading ? (
            <div className="text-center py-16 text-muted">読み込み中...</div>
          ) : filteredBattles.length === 0 ? (
            <div className="text-center py-16 text-muted">
              {filter ? "一致するバトルなし" : "この期間のバトルなし"}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="py-2.5 px-3 text-left whitespace-nowrap">時刻</th>
                    <th className="py-2.5 px-3 text-left">対戦相手</th>
                    <th className="py-2.5 px-3 text-right">スコア</th>
                    <th className="py-2.5 px-3 text-center whitespace-nowrap">状態</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">コイン</th>
                    <th className="py-2.5 px-3 text-center w-10">詳細</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBattles.map((battle) => {
                    const bothScores = battle.selfScore !== null && battle.opponentScore !== null;
                    const win = bothScores && BigInt(battle.selfScore!) > BigInt(battle.opponentScore!);
                    const lose = bothScores && BigInt(battle.selfScore!) < BigInt(battle.opponentScore!);
                    const opponent = battle.opponent;

                    return (
                      <tr
                        key={battle.battleId}
                        onClick={() => setOpenBattleId(battle.battleId)}
                        className="border-b border-row-border hover:bg-row-hover transition-colors cursor-pointer"
                      >
                        <td className="py-2 px-3 text-xs text-muted whitespace-nowrap">
                          {formatEventTime(battle.startedAt, period)}
                        </td>
                        <td className="py-2 px-3">
                          {battle.selfTeam && battle.opponentTeam ? (
                            <BattleVersus selfTeam={battle.selfTeam} opponentTeam={battle.opponentTeam} size="sm" />
                          ) : opponent === null ? (
                            <span className="text-muted">対戦相手不明</span>
                          ) : opponent.count > 1 ? (
                            <span className="text-muted">複数人バトル({opponent.count + 1}人)</span>
                          ) : opponent.nickName || opponent.displayId || opponent.tiktokId ? (
                            <div className="flex items-center gap-2">
                              <Avatar src={opponent.avatarUrl} alt={opponent.nickName ?? opponent.displayId ?? "?"} />
                              <div className="min-w-0">
                                <div className="font-medium truncate max-w-[160px]">
                                  {opponent.nickName ?? `@${opponent.displayId}`}
                                </div>
                                {(opponent.displayId || opponent.tiktokId) && (
                                  <div className="text-xs text-muted truncate max-w-[160px]">
                                    @{opponent.displayId ?? opponent.tiktokId}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted">対戦相手不明</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono whitespace-nowrap">
                          {battle.selfScore === null ? (
                            "-"
                          ) : (
                            <span className={win ? "text-brand font-semibold" : ""}>
                              {Number(battle.selfScore).toLocaleString()}
                            </span>
                          )}
                          {" / "}
                          {battle.opponentScore === null ? (
                            "-"
                          ) : (
                            <span className={lose ? "text-red-600 dark:text-red-400 font-semibold" : ""}>
                              {Number(battle.opponentScore).toLocaleString()}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center text-xs whitespace-nowrap">
                          <span
                            className={
                              battle.status === "live"
                                ? "text-brand"
                                : battle.status === "cut_short"
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-muted"
                            }
                          >
                            {BATTLE_STATUS_LABELS[battle.status]}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono whitespace-nowrap">
                          💎{battle.selfTotalDiamonds.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenBattleId(battle.battleId);
                            }}
                            className="btn-ghost p-1.5"
                            title="貢献者一覧を見る"
                          >
                            詳細
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
          </div>
        </div>
      </main>
    <BattleDetailModal
      battle={battlesData?.battles.find((b) => b.battleId === openBattleId) ?? null}
      onClose={() => setOpenBattleId(null)}
    />
    </>
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

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-brand">
      <polyline points="20 6 9 17 4 12" />
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
