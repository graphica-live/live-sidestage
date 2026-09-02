"use client";

import { useEffect, useState } from "react";

interface EulerApiStatus {
  configured: boolean;
  maskedKey: string | null;
}

interface EulerUsageRow {
  id: string;
  createdAt: string;
  requestedAt: string;
  roomId: string;
  tiktokId: string;
  outcome: string;
  errorMessage: string | null;
  trigger: string;
  reason: string | null;
  role: string;
  workerIndex: number | null;
  listenerEpoch: string | null;
  assignedWorkerId: number | null;
  credentialMode: string;
  roomMonitorUntil: string | null;
  streamers: { userId: string; email: string | null }[];
  agencies: { agencyId: string; name: string | null }[];
  events: { eventId: string; title: string | null }[];
}

export default function EulerApiAdminPage() {
  const [status, setStatus] = useState<EulerApiStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [usageRows, setUsageRows] = useState<EulerUsageRow[]>([]);
  const [usageError, setUsageError] = useState("");
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageCursor, setUsageCursor] = useState<string | null>(null);
  const [roomIdFilter, setRoomIdFilter] = useState("");
  const [tiktokIdFilter, setTiktokIdFilter] = useState("");

  useEffect(() => {
    fetch("/api/admin/euler-api")
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => setError("設定の取得に失敗しました"));
  }, []);

  async function loadUsage(reset: boolean) {
    setUsageLoading(true);
    setUsageError("");
    try {
      const params = new URLSearchParams();
      if (roomIdFilter.trim()) params.set("roomId", roomIdFilter.trim());
      if (tiktokIdFilter.trim()) params.set("tiktokId", tiktokIdFilter.trim());
      if (!reset && usageCursor) params.set("cursor", usageCursor);
      const res = await fetch(`/api/admin/euler-usage?${params.toString()}`);
      if (!res.ok) {
        setUsageError("履歴の取得に失敗しました");
        return;
      }
      const data = await res.json();
      setUsageRows((prev) => (reset ? data.data : [...prev, ...data.data]));
      setUsageCursor(data.nextCursor);
    } catch {
      setUsageError("履歴の取得に失敗しました");
    } finally {
      setUsageLoading(false);
    }
  }

  useEffect(() => {
    loadUsage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setError("");
    setMessage("");
    if (!apiKey.trim()) {
      setError("APIキーを入力してください");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/euler-api", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "保存に失敗しました");
        return;
      }
      setStatus(data);
      setApiKey("");
      setMessage("保存しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    if (!confirm("EulerAPIキーの設定を削除し、匿名取得に戻しますか？")) return;
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/euler-api", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "削除に失敗しました");
        return;
      }
      setStatus(data);
      setMessage("削除しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-5xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-lg font-bold text-brand">EulerAPI 設定</h1>
        <p className="text-xs text-muted mt-1">
          ここで設定したAPIキーを使ってTikTok Liveの署名(Euler)を取得します。未設定の場合は匿名で取得します。
        </p>
      </div>

      <div className="card space-y-4 max-w-xl">
        <div>
          <p className="text-sm text-strong mb-1">現在の状態</p>
          {status ? (
            status.configured ? (
              <p className="text-sm font-mono text-green-600 dark:text-green-400">設定済み ({status.maskedKey})</p>
            ) : (
              <p className="text-sm text-muted">未設定(匿名取得)</p>
            )
          ) : (
            <p className="text-sm text-muted">読み込み中...</p>
          )}
        </div>

        <div>
          <label className="text-sm text-strong block mb-1">APIキー</label>
          <input
            type="text"
            placeholder="新しいAPIキーを入力"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="input-field"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
        {message && <p className="text-green-600 dark:text-green-400 text-sm">{message}</p>}

        <div className="flex gap-2">
          <button onClick={handleSave} disabled={loading} className="btn-primary flex-1">
            {loading ? "処理中..." : "保存"}
          </button>
          {status?.configured && (
            <button
              onClick={handleClear}
              disabled={loading}
              className="btn-ghost text-sm text-red-600 dark:text-red-400 hover:text-red-300"
            >
              削除
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-brand">署名利用履歴</h2>
          <p className="text-xs text-muted mt-1">
            EulerAPIへ実際に署名(WebSocket接続用)を要求した履歴。いつ・何がきっかけで・誰の目的で消費したかを追跡する。
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="roomIdで絞り込み"
            value={roomIdFilter}
            onChange={(e) => setRoomIdFilter(e.target.value)}
            className="input-field flex-1 min-w-[160px]"
          />
          <input
            type="text"
            placeholder="tiktokIdで絞り込み"
            value={tiktokIdFilter}
            onChange={(e) => setTiktokIdFilter(e.target.value)}
            className="input-field flex-1 min-w-[160px]"
          />
          <button onClick={() => loadUsage(true)} disabled={usageLoading} className="btn-primary">
            検索
          </button>
        </div>

        {usageError && <p className="text-red-600 dark:text-red-400 text-sm">{usageError}</p>}

        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="p-2">requestedAt</th>
                <th className="p-2">tiktokId</th>
                <th className="p-2">outcome</th>
                <th className="p-2">trigger / reason</th>
                <th className="p-2">role</th>
                <th className="p-2">credential</th>
                <th className="p-2">配信者</th>
                <th className="p-2">事務所</th>
                <th className="p-2">イベント</th>
              </tr>
            </thead>
            <tbody>
              {usageRows.map((r) => (
                <tr key={r.id} className="border-b border-border">
                  <td className="p-2 whitespace-nowrap">{new Date(r.requestedAt).toLocaleString("ja-JP")}</td>
                  <td className="p-2">@{r.tiktokId}</td>
                  <td className={`p-2 ${r.outcome === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                    {r.outcome}
                    {r.errorMessage && <div className="text-muted">{r.errorMessage}</div>}
                  </td>
                  <td className="p-2">
                    {r.trigger}
                    {r.reason && <div className="text-muted">({r.reason})</div>}
                  </td>
                  <td className="p-2">
                    {r.role}
                    {r.workerIndex !== null && `#${r.workerIndex}`}
                    {r.assignedWorkerId !== null && r.assignedWorkerId !== r.workerIndex && (
                      <div className="text-yellow-500">担当#{r.assignedWorkerId}</div>
                    )}
                  </td>
                  <td className="p-2">{r.credentialMode}</td>
                  <td className="p-2">
                    {r.streamers.length === 0 ? "-" : r.streamers.map((s) => s.email ?? s.userId).join(", ")}
                  </td>
                  <td className="p-2">
                    {r.agencies.length === 0 ? "-" : r.agencies.map((a) => a.name ?? a.agencyId).join(", ")}
                  </td>
                  <td className="p-2">
                    {r.events.length === 0 ? "-" : r.events.map((e) => e.title ?? e.eventId).join(", ")}
                  </td>
                </tr>
              ))}
              {usageRows.length === 0 && !usageLoading && (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-muted">
                    履歴がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {usageCursor && (
          <button onClick={() => loadUsage(false)} disabled={usageLoading} className="btn-ghost text-sm">
            {usageLoading ? "読み込み中..." : "もっと見る"}
          </button>
        )}
      </div>
    </div>
  );
}
