"use client";

import { useEffect, useState } from "react";

interface EulerApiStatus {
  configured: boolean;
  maskedKey: string | null;
}

export default function EulerApiAdminPage() {
  const [status, setStatus] = useState<EulerApiStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/admin/euler-api")
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => setError("設定の取得に失敗しました"));
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
    <div className="max-w-xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-lg font-bold text-brand">EulerAPI 設定</h1>
        <p className="text-xs text-gray-400 mt-1">
          ここで設定したAPIキーを使ってTikTok Liveの署名(Euler)を取得します。未設定の場合は匿名で取得します。
        </p>
      </div>

      <div className="card space-y-4">
        <div>
          <p className="text-sm text-gray-300 mb-1">現在の状態</p>
          {status ? (
            status.configured ? (
              <p className="text-sm font-mono text-green-400">設定済み ({status.maskedKey})</p>
            ) : (
              <p className="text-sm text-gray-500">未設定(匿名取得)</p>
            )
          ) : (
            <p className="text-sm text-gray-500">読み込み中...</p>
          )}
        </div>

        <div>
          <label className="text-sm text-gray-300 block mb-1">APIキー</label>
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

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {message && <p className="text-green-400 text-sm">{message}</p>}

        <div className="flex gap-2">
          <button onClick={handleSave} disabled={loading} className="btn-primary flex-1">
            {loading ? "処理中..." : "保存"}
          </button>
          {status?.configured && (
            <button
              onClick={handleClear}
              disabled={loading}
              className="btn-ghost text-sm text-red-400 hover:text-red-300"
            >
              削除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
