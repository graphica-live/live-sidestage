"use client";

import { useCallback, useEffect, useState } from "react";

type Agency = {
  id: string;
  name: string;
  email: string;
  maxWatchTargets: number;
  hasApiKey: boolean;
  watchCount: number;
};

type Watch = {
  id: string;
  tiktokId: string;
  label: string | null;
  createdAt: string;
  listenerStatus: string | null;
  listenerMessage: string | null;
  listenerUpdatedAt: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  connected: "bg-green-500",
  connecting: "bg-yellow-500 animate-pulse",
  retrying: "bg-yellow-500 animate-pulse",
  idle: "bg-gray-500",
  error: "bg-red-500",
};

const STATUS_LABEL: Record<string, string> = {
  connected: "接続中",
  connecting: "接続処理中",
  retrying: "再接続中",
  idle: "待機中",
  error: "エラー",
};

function statusText(w: Watch): string {
  if (!w.listenerStatus) return "起動待ち(最大60秒)";
  return STATUS_LABEL[w.listenerStatus] ?? w.listenerStatus;
}

export default function AgencyClient({ agencyOrigin }: { agencyOrigin: string }) {
  const [loading, setLoading] = useState(true);
  const [agency, setAgency] = useState<Agency | null>(null);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [tiktokIdInput, setTiktokIdInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [adding, setAdding] = useState(false);

  const [issuedApiKey, setIssuedApiKey] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadWatches = useCallback(async () => {
    const res = await fetch("/api/agency/watches");
    if (!res.ok) return;
    const data = await res.json();
    setWatches(data.watches);
  }, []);

  const loadAgency = useCallback(async () => {
    const res = await fetch("/api/agency");
    if (!res.ok) {
      setError("読み込みに失敗しました。");
      return null;
    }
    const data = await res.json();
    setAgency(data.agency);
    return data.agency as Agency | null;
  }, []);

  useEffect(() => {
    (async () => {
      const a = await loadAgency();
      if (a) await loadWatches();
      setLoading(false);
    })();
  }, [loadAgency, loadWatches]);

  // 監視対象の接続開始は担当Workerのensureループ(最大60秒間隔)が拾うため、
  // 追加直後は listenerStatus が未設定のままになる。定期的に取り直して状態を反映する。
  useEffect(() => {
    if (!agency) return;
    const id = setInterval(loadWatches, 15000);
    return () => clearInterval(id);
  }, [agency, loadWatches]);

  async function handleAddWatch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAdding(true);
    try {
      const res = await fetch("/api/agency/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiktokId: tiktokIdInput, label: labelInput || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "追加に失敗しました。");
        return;
      }
      setTiktokIdInput("");
      setLabelInput("");
      await Promise.all([loadWatches(), loadAgency()]);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveWatch(id: string, tiktokId: string) {
    if (!window.confirm(`@${tiktokId} を監視対象から外しますか？`)) return;
    setError(null);
    const res = await fetch(`/api/agency/watches/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "削除に失敗しました。");
      return;
    }
    await Promise.all([loadWatches(), loadAgency()]);
  }

  async function handleIssueApiKey() {
    if (agency?.hasApiKey && !window.confirm("再発行すると既存のAPIキーは使えなくなります。続けますか？")) {
      return;
    }
    setError(null);
    setIssuing(true);
    try {
      const res = await fetch("/api/agency/api-key", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "発行に失敗しました。");
        return;
      }
      setIssuedApiKey(data.apiKey);
      await loadAgency();
    } finally {
      setIssuing(false);
    }
  }

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8">
        <p className="text-sm text-muted">読み込み中...</p>
      </main>
    );
  }

  // 事務所は管理者が登録する。未登録アカウントでもログインは通るため
  // (理由は agencyAuthOptions の callbacks コメント参照)、権限判定はここで行う。
  // 別アカウントで入り直す場合はヘッダーのログアウトを使う。
  if (!agency) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        <div>
          <h1 className="text-xl font-bold">事務所情報が見つかりません</h1>
          <p className="text-sm text-muted mt-1">
            このGoogleアカウントは事務所として登録されていません。
            利用を希望する場合は、ログインに使うGoogleアカウントのメールアドレスを運営までお知らせください。
            以前は使えていた場合は、登録が取り消された可能性があります。
          </p>
        </div>
      </main>
    );
  }

  const remaining = Math.max(0, agency.maxWatchTargets - watches.length);

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-xl font-bold">{agency.name}</h1>
        <p className="text-sm text-muted mt-1">
          監視対象 {watches.length} / {agency.maxWatchTargets} 件
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-strong">監視対象ライバー</h2>

        <form onSubmit={handleAddWatch} className="card space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">TikTok ID</label>
              <input
                value={tiktokIdInput}
                onChange={(e) => setTiktokIdInput(e.target.value)}
                placeholder="@example"
                className="input-field"
                required
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">管理名(任意)</label>
              <input
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Aチーム / 山田"
                maxLength={100}
                className="input-field"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={adding || !tiktokIdInput.trim() || remaining === 0}
              className="btn-primary"
            >
              {adding ? "追加中..." : "追加する"}
            </button>
            <span className="text-xs text-muted">
              {remaining === 0 ? "上限に達しています" : `あと${remaining}件追加できます`}
            </span>
          </div>
        </form>

        {watches.length === 0 ? (
          <div className="card">
            <p className="text-sm text-muted">
              まだ監視対象がありません。TikTok IDを追加すると、そのライバーの配信からギフト情報の収集が始まります。
            </p>
          </div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">TikTok ID</th>
                  <th className="px-4 py-2 font-medium">管理名</th>
                  <th className="px-4 py-2 font-medium">接続状態</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {watches.map((w) => (
                  <tr key={w.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 font-medium">@{w.tiktokId}</td>
                    <td className="px-4 py-2.5 text-muted">{w.label ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            STATUS_COLOR[w.listenerStatus ?? ""] ?? "bg-gray-500"
                          }`}
                        />
                        {statusText(w)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleRemoveWatch(w.id, w.tiktokId)}
                        className="btn-ghost text-xs"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-strong">APIキー</h2>
        <div className="card space-y-3">
          <p className="text-xs text-muted">
            企業向けAPIの認証に使います。キーは発行した瞬間だけ表示され、以降は再表示できません。
          </p>

          {issuedApiKey && (
            <div>
              <label className="text-xs text-muted block mb-1">
                発行されたAPIキー(この場でコピーしてください)
              </label>
              <div className="flex items-center gap-1.5">
                <code className="text-xs font-mono text-strong bg-black/5 dark:bg-white/5 px-2 py-1.5 rounded flex-1 break-all">
                  {issuedApiKey}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(issuedApiKey);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="btn-ghost text-xs shrink-0"
                >
                  {copied ? "✓" : "コピー"}
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button onClick={handleIssueApiKey} disabled={issuing} className="btn-primary">
              {issuing ? "発行中..." : agency.hasApiKey ? "再発行する" : "発行する"}
            </button>
            <span className="text-xs text-muted">
              {agency.hasApiKey ? "発行済み" : "未発行"}
            </span>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-strong">API の使い方</h2>
        <div className="card space-y-3 text-xs text-muted">
          <p>
            監視対象ライバーのギフト実績を、期間を指定してまとめて取得します。数値は編集前の
            オリジナル生データ基準です(レスポンスの <code className="text-strong">basis</code> が{" "}
            <code className="text-strong">&quot;raw&quot;</code> であることがその契約を示します)。
          </p>
          <pre className="bg-black/5 dark:bg-white/5 rounded p-3 overflow-x-auto text-[11px] font-mono text-strong">
{`curl -H "x-api-key: <APIキー>" \\
  "${agencyOrigin}/api/agency/gifts/summary?from=2026-08-01&to=2026-08-21"`}
          </pre>
          <ul className="space-y-1 list-disc list-inside">
            <li>
              <code className="text-strong">from</code> / <code className="text-strong">to</code>{" "}
              — 必須。YYYY-MM-DD形式。期間は最大366日(1年)
            </li>
            <li>
              <code className="text-strong">tiktokIds</code> — 任意。カンマ区切り。
              省略すると監視対象すべてが対象。監視対象に無いIDは{" "}
              <code className="text-strong">unknownTiktokIds</code> として返り、集計には含まれません
            </li>
            <li>
              レスポンスの <code className="text-strong">tiktokId</code> は正規化済み(小文字・@なし)で、
              そのまま <code className="text-strong">tiktokIds</code> に渡せます。
              入力した表記は <code className="text-strong">displayName</code> に入ります
            </li>
            <li>
              <code className="text-strong">watchStartedAt</code> — 監視を開始した日時。
              ギフトは配信単位で蓄積されるため、これより前の期間の数値は監視開始前のものです
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
