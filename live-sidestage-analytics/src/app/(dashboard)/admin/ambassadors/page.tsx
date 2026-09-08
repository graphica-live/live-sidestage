"use client";

import { useCallback, useEffect, useState } from "react";

interface Ambassador {
  id: string;
  principalId: string;
  userEmail: string | null;
  userName: string | null;
  createdAt: string;
}

interface Invite {
  id: string;
  token: string;
  url: string;
  createdAt: string;
  expiresAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" });
}

export default function AmbassadorsAdminPage() {
  const [ambassadors, setAmbassadors] = useState<Ambassador[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ambassadors");
      if (!res.ok) {
        setError("一覧の取得に失敗しました");
        return;
      }
      const data = await res.json();
      setAmbassadors(data.ambassadors);
      setInvites(data.invites);
    } catch {
      setError("一覧の取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateInvite() {
    setError("");
    setMessage("");
    setIssuing(true);
    try {
      const res = await fetch("/api/admin/ambassadors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createInvite" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "発行に失敗しました");
        return;
      }
      await load();
      setMessage("招待URLを発行しました(有効期限30日)");
    } finally {
      setIssuing(false);
    }
  }

  async function handleAddByEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setAdding(true);
    try {
      const res = await fetch("/api/admin/ambassadors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addByEmail", email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "追加に失敗しました");
        return;
      }
      setEmail("");
      await load();
      setMessage(`${data.ambassador.userEmail} をアンバサダーに追加しました`);
    } finally {
      setAdding(false);
    }
  }

  async function handleRevokeInvite(invite: Invite) {
    const ok = confirm("この招待URLを失効させますか?");
    if (!ok) return;
    setBusyId(invite.id);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/admin/ambassadors?id=${encodeURIComponent(invite.id)}&type=invite`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "失効に失敗しました");
        return;
      }
      await load();
      setMessage("招待URLを失効させました");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemoveAmbassador(a: Ambassador) {
    const ok = confirm(`${a.userEmail ?? a.principalId} のアンバサダー資格を解除しますか?`);
    if (!ok) return;
    setBusyId(a.id);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/admin/ambassadors?id=${encodeURIComponent(a.id)}&type=ambassador`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "解除に失敗しました");
        return;
      }
      await load();
      setMessage(
        data.hadActiveAmbassadorUltraSubscription
          ? "解除しました。ただしULTRAの有効な購読が残っている可能性があります。Stripe側の契約状況を確認してください。"
          : "解除しました"
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-4xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-lg font-bold text-brand">アンバサダー</h1>
        <p className="text-xs text-muted mt-1">
          アンバサダーはPROプランを無料で利用できます。招待URL経由で新規登録した先着1名、または既存ユーザーを直接指定して追加できます。
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && <p className="text-sm text-green-600 dark:text-green-400">{message}</p>}

      <div className="card space-y-3">
        <p className="text-xs font-semibold text-strong">招待URLを発行</p>
        <p className="text-xs text-muted">発行から30日で自動的に失効・削除されます。</p>
        <button onClick={handleCreateInvite} disabled={issuing} className="btn-primary">
          {issuing ? "発行中..." : "招待URLを発行する"}
        </button>
      </div>

      <form onSubmit={handleAddByEmail} className="card space-y-3">
        <p className="text-xs font-semibold text-strong">既存ユーザーを追加</p>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="input-field flex-1"
            required
          />
          <button type="submit" disabled={adding || !email.trim()} className="btn-primary">
            {adding ? "追加中..." : "追加する"}
          </button>
        </div>
      </form>

      <div>
        <p className="text-xs font-semibold text-strong mb-2">未使用の招待URL</p>
        {invites === null ? (
          <p className="text-sm text-muted">読み込み中...</p>
        ) : invites.length === 0 ? (
          <div className="card">
            <p className="text-sm text-muted">未使用の招待URLはありません。</p>
          </div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">URL</th>
                  <th className="px-4 py-2 font-medium">発行日</th>
                  <th className="px-4 py-2 font-medium">期限</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 text-xs text-muted break-all">{i.url}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{formatDate(i.createdAt)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{formatDate(i.expiresAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleRevokeInvite(i)}
                        disabled={busyId === i.id}
                        className="btn-ghost text-xs hover:text-red-600 dark:text-red-400"
                      >
                        {busyId === i.id ? "..." : "失効"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-strong mb-2">アンバサダー一覧</p>
        {ambassadors === null ? (
          <p className="text-sm text-muted">読み込み中...</p>
        ) : ambassadors.length === 0 ? (
          <div className="card">
            <p className="text-sm text-muted">まだアンバサダーがいません。</p>
          </div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">メールアドレス</th>
                  <th className="px-4 py-2 font-medium">名前</th>
                  <th className="px-4 py-2 font-medium">登録日</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {ambassadors.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 text-xs text-muted">{a.userEmail ?? "-"}</td>
                    <td className="px-4 py-2.5">{a.userName ?? "-"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{formatDate(a.createdAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleRemoveAmbassador(a)}
                        disabled={busyId === a.id}
                        className="btn-ghost text-xs hover:text-red-600 dark:text-red-400"
                      >
                        {busyId === a.id ? "..." : "解除"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
