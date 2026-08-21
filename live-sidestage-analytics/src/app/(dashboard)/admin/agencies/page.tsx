"use client";

import { useCallback, useEffect, useState } from "react";

interface Agency {
  id: string;
  name: string;
  email: string | null;
  approved: boolean;
  approvedAt: string | null;
  maxWatchTargets: number;
  watchCount: number;
  createdAt: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AgenciesAdminPage() {
  const [agencies, setAgencies] = useState<Agency[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/agencies");
      if (!res.ok) {
        setError("一覧の取得に失敗しました");
        return;
      }
      setAgencies((await res.json()).agencies);
    } catch {
      setError("一覧の取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>, successMessage: string) {
    setError("");
    setMessage("");
    setBusyId(id);
    try {
      const res = await fetch("/api/admin/agencies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "更新に失敗しました");
        return;
      }
      await load();
      setMessage(successMessage);
    } finally {
      setBusyId(null);
    }
  }

  function handleToggleApproval(a: Agency) {
    if (a.approved) {
      const ok = confirm(
        `${a.name} の承認を取り消しますか？\n監視対象${a.watchCount}件のTikTok接続が停止し、企業APIも使えなくなります。`
      );
      if (!ok) return;
      patch(a.id, { approved: false }, "承認を取り消しました");
      return;
    }
    patch(a.id, { approved: true }, "承認しました");
  }

  function handleChangeLimit(a: Agency) {
    const input = prompt(
      `${a.name} の監視対象上限を入力してください(0〜1000)。\n1件ごとにTikTok接続とproxy枠を消費します。`,
      String(a.maxWatchTargets)
    );
    if (input === null) return;
    const max = Number(input.trim());
    if (!Number.isInteger(max) || max < 0 || max > 1000) {
      setError("上限は0〜1000の整数で入力してください");
      return;
    }
    patch(a.id, { maxWatchTargets: max }, "上限を変更しました");
  }

  return (
    <div className="max-w-4xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-lg font-bold text-brand">事務所</h1>
        <p className="text-xs text-gray-400 mt-1">
          事務所は承認するまで監視対象を追加できず、企業APIも使えません。承認するとその事務所の監視対象ぶん
          TikTok接続を消費するため、上限とあわせて確認してください。
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {message && <p className="text-sm text-green-400">{message}</p>}

      {agencies === null ? (
        <p className="text-sm text-gray-400">読み込み中...</p>
      ) : agencies.length === 0 ? (
        <div className="card">
          <p className="text-sm text-gray-400">まだ事務所が作成されていません。</p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-left text-xs text-gray-500">
                <th className="px-4 py-2 font-medium">事務所名</th>
                <th className="px-4 py-2 font-medium">アカウント</th>
                <th className="px-4 py-2 font-medium">監視</th>
                <th className="px-4 py-2 font-medium">状態</th>
                <th className="px-4 py-2 font-medium">作成日</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {agencies.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5 font-medium">{a.name}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{a.email ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => handleChangeLimit(a)}
                      disabled={busyId === a.id}
                      className="text-xs text-gray-300 hover:text-brand hover:underline"
                      title="上限を変更"
                    >
                      {a.watchCount} / {a.maxWatchTargets}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    {a.approved ? (
                      <span className="flex items-center gap-1.5 text-xs text-gray-400">
                        <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                        承認済み
                        <span className="text-gray-600">({formatDate(a.approvedAt)})</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-yellow-500">
                        <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
                        承認待ち
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{formatDate(a.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => handleToggleApproval(a)}
                      disabled={busyId === a.id}
                      className={
                        a.approved
                          ? "btn-ghost text-xs"
                          : "bg-brand hover:bg-brand-hover text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      }
                    >
                      {busyId === a.id ? "..." : a.approved ? "承認取消" : "承認する"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
