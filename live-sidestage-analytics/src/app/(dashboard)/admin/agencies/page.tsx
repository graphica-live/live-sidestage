"use client";

import { useCallback, useEffect, useState } from "react";

interface Agency {
  id: string;
  name: string;
  email: string;
  maxWatchTargets: number;
  hasApiKey: boolean;
  watchCount: number;
  createdAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

export default function AgenciesAdminPage() {
  const [agencies, setAgencies] = useState<Agency[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [limit, setLimit] = useState("10");
  const [creating, setCreating] = useState(false);

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setCreating(true);
    try {
      const res = await fetch("/api/admin/agencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, maxWatchTargets: Number(limit) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "発行に失敗しました");
        return;
      }
      setName("");
      setEmail("");
      setLimit("10");
      await load();
      setMessage(`${data.agency.name} を発行しました。${data.agency.email} でログインすればすぐ使えます。`);
    } finally {
      setCreating(false);
    }
  }

  async function handleChangeLimit(a: Agency) {
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

    setError("");
    setMessage("");
    setBusyId(a.id);
    try {
      const res = await fetch("/api/admin/agencies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, maxWatchTargets: max }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "更新に失敗しました");
        return;
      }
      await load();
      setMessage("上限を変更しました");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(a: Agency) {
    const ok = confirm(
      `${a.name} (${a.email}) を削除しますか？\n` +
        `監視対象${a.watchCount}件も一緒に消え、TikTok接続が停止します。\n` +
        `このアカウントは事務所コンソールを使えなくなります。`
    );
    if (!ok) return;

    setError("");
    setMessage("");
    setBusyId(a.id);
    try {
      const res = await fetch(`/api/admin/agencies?id=${encodeURIComponent(a.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "削除に失敗しました");
        return;
      }
      await load();
      setMessage("削除しました");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-4xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-lg font-bold text-brand">事務所</h1>
        <p className="text-xs text-muted mt-1">
          相手のGoogleアカウントのメールアドレスを登録すると、その人はログインするだけで事務所コンソールを使えます。
          申請や承認のやり取りはありません。監視対象1件につきTikTok接続とproxy枠を1つ消費するため、上限に注意してください。
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && <p className="text-sm text-green-600 dark:text-green-400">{message}</p>}

      <form onSubmit={handleCreate} className="card space-y-3">
        <p className="text-xs font-semibold text-strong">事務所を発行</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <label className="text-xs text-muted block mb-1">事務所名</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="合同会社ネオライブ"
              maxLength={100}
              className="input-field"
              required
            />
          </div>
          <div className="sm:col-span-1">
            <label className="text-xs text-muted block mb-1">Googleアカウント</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="agency@gmail.com"
              className="input-field"
              required
            />
          </div>
          <div className="sm:col-span-1">
            <label className="text-xs text-muted block mb-1">監視対象の上限</label>
            <input
              type="number"
              min={0}
              max={1000}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="input-field"
              required
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={creating || !name.trim() || !email.trim()}
          className="btn-primary"
        >
          {creating ? "発行中..." : "発行する"}
        </button>
      </form>

      {agencies === null ? (
        <p className="text-sm text-muted">読み込み中...</p>
      ) : agencies.length === 0 ? (
        <div className="card">
          <p className="text-sm text-muted">まだ事務所がありません。上のフォームから発行してください。</p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">事務所名</th>
                <th className="px-4 py-2 font-medium">Googleアカウント</th>
                <th className="px-4 py-2 font-medium">監視</th>
                <th className="px-4 py-2 font-medium">APIキー</th>
                <th className="px-4 py-2 font-medium">発行日</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {agencies.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5 font-medium">{a.name}</td>
                  <td className="px-4 py-2.5 text-muted text-xs">{a.email}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => handleChangeLimit(a)}
                      disabled={busyId === a.id}
                      className="text-xs text-strong hover:text-brand hover:underline"
                      title="上限を変更"
                    >
                      {a.watchCount} / {a.maxWatchTargets}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">
                    {a.hasApiKey ? "発行済み" : "未発行"}
                  </td>
                  <td className="px-4 py-2.5 text-muted text-xs">{formatDate(a.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => handleDelete(a)}
                      disabled={busyId === a.id}
                      className="btn-ghost text-xs hover:text-red-600 dark:text-red-400"
                    >
                      {busyId === a.id ? "..." : "削除"}
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
