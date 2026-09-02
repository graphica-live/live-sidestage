"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// 型のみの import なので、prisma を含む worker-status.ts / worker-guardian.ts の実体はクライアントに入らない。
import type { WorkerIssue, WorkerReport } from "@/lib/worker-status";
import type { MigrationAuditEntry } from "@/lib/worker-guardian";

type WorkerReportWithAudit = WorkerReport & { guardianAuditLog: MigrationAuditEntry[] };

// Worker の /status は reconcile 間隔(60秒)と listener heartbeat(30秒)で更新される。
// それより短い間隔で叩いても新しい情報は増えないので、15秒で足りる。
const REFRESH_INTERVAL_MS = 15_000;

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分${sec % 60}秒`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間${min % 60}分`;
  return `${Math.floor(hour / 24)}日${hour % 24}時間`;
}

function ageMs(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, nowMs - t) : null;
}

function statusColor(status: string): string {
  if (status === "connected") return "text-green-600 dark:text-green-400";
  if (status === "connecting" || status === "retrying") return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

// issue の type は worker_url_count_mismatch のように長く、スマホ幅では改行できずに
// 行をはみ出させる。flex-wrap と break-all で折り返しを許す。
function IssueRow({ issue }: { issue: WorkerIssue }) {
  const tone =
    issue.severity === "error"
      ? "bg-red-500/10 border-red-500/30 text-red-300"
      : "bg-yellow-500/10 border-yellow-500/30 text-yellow-200";
  return (
    <div
      className={`px-3 py-2 rounded border text-sm flex flex-wrap items-baseline gap-x-2 gap-y-1 ${tone}`}
    >
      <span className="font-mono text-xs opacity-70 break-all">{issue.type}</span>
      {issue.workerIndex != null && (
        <span className="whitespace-nowrap">worker {issue.workerIndex}</span>
      )}
      {issue.tiktokId && <span className="break-all">@{issue.tiktokId}</span>}
      <span className="min-w-0 break-words">{issue.detail}</span>
    </div>
  );
}

export default function WorkersAdminPage() {
  const [report, setReport] = useState<WorkerReportWithAudit | null>(null);
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
      const res = await fetch("/api/admin/workers", { cache: "no-store" });
      if (id !== requestId.current) return;
      if (!res.ok) {
        setError(res.status === 401 ? "権限がありません" : "取得に失敗しました");
        return;
      }
      setReport((await res.json()) as WorkerReportWithAudit);
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

  const nowMs = report ? new Date(report.generatedAt).getTime() : Date.now();
  const errors = report?.issues.filter((i) => i.severity === "error") ?? [];
  const warns = report?.issues.filter((i) => i.severity === "warn") ?? [];

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-strong">Worker 稼働状況</h1>
          <p className="text-xs text-muted mt-1">
            {REFRESH_INTERVAL_MS / 1000}秒ごとに自動更新
            {report && ` · 最終取得 ${new Date(report.generatedAt).toLocaleTimeString("ja-JP")}`}
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

      {report?.dbError && (
        <div className="mb-4 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          DB を読めていません（Worker の応答のみ表示中）: {report.dbError}
        </div>
      )}

      {report && (errors.length > 0 || warns.length > 0) && (
        <div className="mb-4 space-y-1">
          {errors.map((issue, i) => (
            <IssueRow key={`e${i}`} issue={issue} />
          ))}
          {warns.map((issue, i) => (
            <IssueRow key={`w${i}`} issue={issue} />
          ))}
        </div>
      )}

      {report && report.issues.length === 0 && (
        <div className="mb-4 px-3 py-2 rounded bg-green-500/10 border border-green-500/30 text-sm text-green-300">
          異常なし（WORKER_COUNT={String(report.workerCount)}）
        </div>
      )}

      {!report && !error && <p className="text-sm text-muted">読み込み中...</p>}

      <div className="space-y-4">
        {report?.workers.map((w) => (
          <div key={w.workerIndex} className="rounded border border-border bg-panel">
            <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
              <span className="text-sm font-bold text-strong">worker {w.workerIndex}</span>
              {w.reachable ? (
                <span className={w.ready ? "text-xs text-green-600 dark:text-green-400" : "text-xs text-yellow-600 dark:text-yellow-400"}>
                  {w.ready ? "ready" : "unready"}
                </span>
              ) : (
                <span className="text-xs text-red-600 dark:text-red-400">応答なし</span>
              )}
              <span className="text-xs text-muted">
                listener {w.listeners.length}件 / DB 上の担当 {w.assignedRooms.length}件
              </span>
              {w.uptimeMs != null && (
                <span className="text-xs text-muted">稼働 {formatDuration(w.uptimeMs)}</span>
              )}
              {/* 本番の URL は worker1.railway.internal:8080 と長いので、狭い幅では折り返させる。 */}
              {w.url && (
                <span className="text-xs text-muted font-mono ml-auto min-w-0 break-all">
                  {w.url}
                </span>
              )}
            </div>

            <div className="px-4 py-2 text-xs text-muted border-b border-border">
              {w.reachable ? (
                <>
                  最終 reconcile:{" "}
                  {w.lastReconcile ? (
                    <>
                      {formatDuration(ageMs(w.lastReconcile.at, nowMs))}前 （
                      {w.lastReconcile.error
                        ? `失敗: ${w.lastReconcile.error}`
                        : `部屋 ${w.lastReconcile.roomCount}件 / 起動失敗 ${w.lastReconcile.startFailures}件 / ${w.lastReconcile.durationMs}ms`}
                      ）
                    </>
                  ) : (
                    "未完了"
                  )}
                  {w.reconcileRunning && <span className="ml-2 text-brand">実行中</span>}
                </>
              ) : (
                <span className="text-red-300">{w.error}</span>
              )}
            </div>

            {w.listeners.length > 0 && (
              <div className="divide-y divide-border">
                {w.listeners.map((l) => (
                  <div key={l.roomId} className="px-4 py-2 flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-strong">@{l.tiktokId}</span>
                    <span className={`text-xs ${statusColor(l.status)}`}>{l.status}</span>
                    <span className="text-xs text-muted">{l.message}</span>
                    <span className="text-xs text-muted ml-auto">
                      購読 {l.subscriberCount}人 · 無音 {formatDuration(l.silentForMs)}
                      {l.watchdogTriggerCount > 0 && ` · watchdog ${l.watchdogTriggerCount}回`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {w.reachable && w.listeners.length === 0 && (
              <div className="px-4 py-2 text-xs text-muted">listener なし（待機中）</div>
            )}
          </div>
        ))}
      </div>

      {report && report.guardianAuditLog.length > 0 && (
        <div className="mt-4 rounded border border-border bg-panel">
          <div className="px-4 py-2 border-b border-border text-sm text-strong">
            worker-guardian 自動移送履歴(直近{report.guardianAuditLog.length}件)
          </div>
          <div className="divide-y divide-border">
            {[...report.guardianAuditLog].reverse().map((entry, i) => (
              <div key={i} className="px-4 py-2 text-xs text-muted">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-strong">
                    {new Date(entry.at).toLocaleString("ja-JP")}
                  </span>
                  <span className="text-red-300">worker {entry.deadWorkerIndex} 死亡確定</span>
                  {entry.reason === "no_eligible_targets" ? (
                    <span className="text-yellow-300">移送先候補0件 — 手動対応が必要</span>
                  ) : (
                    <span className="text-green-300">{entry.assignments.length}件を移送</span>
                  )}
                </div>
                {entry.assignments.length > 0 && (
                  <div className="mt-1 text-muted">
                    {entry.assignments.map((a) => `@${a.tiktokId}→worker${a.toWorker}`).join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {report && report.unassignedRooms.length > 0 && (
        <div className="mt-4 rounded border border-border bg-panel">
          <div className="px-4 py-2 border-b border-border text-sm text-strong">workerId 未割当</div>
          {report.unassignedRooms.map((r) => (
            <div key={r.roomId} className="px-4 py-2 text-xs text-muted">
              @{r.tiktokId}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
