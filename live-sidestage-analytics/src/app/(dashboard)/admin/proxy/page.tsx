"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// 型のみの import なので、prisma を含む tiktok-gift-catalog.ts の実体はクライアントに入らない。
import type { ProxyAttemptLogEntry } from "@/lib/tiktok-gift-catalog";

// ギフトカタログのリフレッシュ周期(worker.ts の30秒reconcile、TTL2h)に対して
// 極端に短く叩く必要はないが、失敗直後の確認用途を考えて workers 画面と同じ間隔にする。
const REFRESH_INTERVAL_MS = 15_000;

function outcomeBadge(outcome: ProxyAttemptLogEntry["outcome"]) {
  return outcome === "success" ? (
    <span className="text-green-600 dark:text-green-400">成功</span>
  ) : (
    <span className="text-red-600 dark:text-red-400">失敗</span>
  );
}

export default function ProxyAdminPage() {
  const [log, setLog] = useState<ProxyAttemptLogEntry[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 前の fetch が終わる前に次を重ねない。詰まったときに要求が積み上がるのを防ぐ。
  const inFlight = useRef(false);
  // 遅れて届いた古いレスポンスで新しい表示を上書きしないための世代番号。
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const id = ++requestId.current;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/proxy", { cache: "no-store" });
      if (id !== requestId.current) return;
      if (!res.ok) {
        setError(res.status === 401 ? "権限がありません" : "取得に失敗しました");
        return;
      }
      const body = (await res.json()) as { log: ProxyAttemptLogEntry[] };
      setLog(body.log);
      setError("");
    } catch {
      if (id === requestId.current) setError("取得に失敗しました");
    } finally {
      inFlight.current = false;
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-strong">ギフトカタログ プロキシ取得履歴</h1>
          <p className="text-xs text-muted mt-1">
            日本プロキシ(GIFT_CATALOG_PROXY_URL)経由でのギフトカタログ取得、直近の成功/失敗。
            {REFRESH_INTERVAL_MS / 1000}秒ごとに自動更新
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded border border-border text-strong hover:bg-row-hover disabled:opacity-50"
        >
          {loading ? "取得中..." : "更新"}
        </button>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded border border-border bg-panel">
        <div className="px-4 py-2 border-b border-border text-sm text-strong">
          取得履歴{log && `(直近${log.length}件、新しい順)`}
        </div>
        {log && log.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted">まだ履歴がありません。</div>
        )}
        {log && log.length > 0 && (
          <div className="divide-y divide-border">
            {log.map((entry, i) => (
              <div key={i} className="px-4 py-2 text-xs text-muted">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-strong">
                    {new Date(entry.at).toLocaleString("ja-JP")}
                  </span>
                  {outcomeBadge(entry.outcome)}
                  <span>locale={entry.locale}</span>
                  <span>@{entry.tiktokId}</span>
                  <span>{entry.usedJpProxy ? "日本プロキシ経由" : "フォールバック(部屋プロキシ)"}</span>
                  {entry.outcome === "success" && entry.giftCount != null && (
                    <span className="text-green-300">{entry.giftCount}件取得</span>
                  )}
                </div>
                {entry.outcome === "failure" && entry.error && (
                  <div className="mt-1 text-red-300 break-all">{entry.error}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
