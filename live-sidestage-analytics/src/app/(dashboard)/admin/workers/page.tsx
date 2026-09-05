"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// 型のみの import なので、prisma を含む worker-status.ts / worker-guardian.ts の実体はクライアントに入らない。
import type {
  AssignedRoom,
  WorkerIssue,
  WorkerReport,
  ManualReassignAuditEntry,
} from "@/lib/worker-status";
import type { MigrationAuditEntry } from "@/lib/worker-guardian";
import { sortAssignedRooms, type RoomSortKey, type RoomSortDir } from "./sort-rooms";

type WorkerReportWithAudit = WorkerReport & {
  guardianAuditLog: MigrationAuditEntry[];
  manualReassignAuditLog: ManualReassignAuditEntry[];
  adminRoomList: AssignedRoom[];
};

// Worker の /status は reconcile 間隔(30秒)と listener heartbeat(30秒)で更新される。
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

// 部屋の担当 worker を手動で切り替えるコントロール。移動先は現在の担当以外から選ばせる。
//
// currentWorker は「画面表示時点の担当」をそのまま expectedWorkerId として API へ渡す
// (楽観的排他)。worker-guardian が同じ瞬間に自動フェイルオーバーで動かしていた場合、
// API は 409 を返す — その場合は再取得して選び直す必要がある(黙って上書きしない)。
function ReassignControl({
  roomId,
  currentWorker,
  workerCount,
  onReassigned,
}: {
  roomId: string;
  currentWorker: number | null;
  workerCount: number | null;
  onReassigned: () => void;
}) {
  const options =
    workerCount != null
      ? Array.from({ length: workerCount }, (_, i) => i).filter((i) => i !== currentWorker)
      : [];
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 4000);
    return () => clearTimeout(t);
  }, [done]);

  if (options.length === 0) return null;
  const selected = target ?? options[0];

  const handleMove = async () => {
    const confirmMsg =
      currentWorker == null
        ? `worker ${selected} へ割り当てる?`
        : `worker ${currentWorker} → worker ${selected} へ移動する?`;
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    setErr("");
    setDone(false);
    try {
      const res = await fetch("/api/admin/workers/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, toWorkerIndex: selected, expectedWorkerId: currentWorker }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message = (data as { error?: string } | null)?.error ?? "移動に失敗しました";
        setErr(res.status === 409 ? `${message}(表示を更新してから再試行)` : message);
        return;
      }
      setDone(true);
      onReassigned();
    } catch {
      setErr("移動に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex items-center gap-1">
      <select
        className="text-xs rounded border border-border bg-transparent px-1 py-0.5"
        value={selected}
        onChange={(e) => setTarget(Number(e.target.value))}
        disabled={busy}
      >
        {options.map((i) => (
          <option key={i} value={i}>
            worker {i}へ
          </option>
        ))}
      </select>
      <button
        onClick={handleMove}
        disabled={busy}
        className="text-xs px-2 py-0.5 rounded border border-border text-strong hover:bg-row-hover disabled:opacity-50"
      >
        {currentWorker == null ? "割当" : "移動"}
      </button>
      {err && <span className="text-xs text-red-400 break-all">{err}</span>}
      {done && !err && (
        <span className="text-xs text-green-400">受付済み（反映まで最大30秒）</span>
      )}
    </span>
  );
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

// 新しい監視対象TikTok IDを追加するフォーム。Streamer登録・AgencyWatch追加と同じ
// fail-closedな実在確認をAPI側で通す(存在しないIDは400で拒否される)。
function AddWatchForm({ onAdded }: { onAdded: () => void }) {
  const [tiktokId, setTiktokId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  const handleAdd = async () => {
    const trimmed = tiktokId.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr("");
    setDone("");
    try {
      const res = await fetch("/api/admin/workers/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiktokId: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr((data as { error?: string } | null)?.error ?? "追加に失敗しました");
        return;
      }
      setDone(`@${(data as { tiktokId: string }).tiktokId} を追加しました（反映まで最大30秒）`);
      setTiktokId("");
      onAdded();
    } catch {
      setErr("追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 px-4 py-3 rounded border border-border bg-panel">
      <div className="text-sm font-bold text-strong mb-2">監視対象IDを追加</div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={tiktokId}
          onChange={(e) => setTiktokId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder="TikTok ID（@任意）"
          disabled={busy}
          className="text-sm rounded border border-border bg-transparent px-2 py-1 min-w-0 flex-1"
        />
        <button
          onClick={handleAdd}
          disabled={busy || tiktokId.trim().length === 0}
          className="text-sm px-3 py-1 rounded border border-border text-strong hover:bg-row-hover disabled:opacity-50"
        >
          {busy ? "確認中..." : "追加"}
        </button>
      </div>
      {err && <div className="mt-1 text-xs text-red-400 break-all">{err}</div>}
      {done && !err && <div className="mt-1 text-xs text-green-400">{done}</div>}
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

  const [sortKey, setSortKey] = useState<RoomSortKey>("tiktokId");
  const [sortDir, setSortDir] = useState<RoomSortDir>("asc");
  // 完全削除・監視解除の二重クリック防止。実行中の roomId のみボタンを無効化する。
  const [actioningRoomId, setActioningRoomId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

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

  const sortedRoomList = useMemo(
    () => sortAssignedRooms(report?.adminRoomList ?? [], sortKey, sortDir),
    [report?.adminRoomList, sortKey, sortDir]
  );

  const toggleSort = (key: RoomSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleSuspend = useCallback(
    async (room: AssignedRoom) => {
      const lines = [`@${room.tiktokId} の監視を一時停止しますか?`];
      if (room.watchCount > 0 || room.eventMonitored) {
        lines.push("事務所監視(AgencyWatch)またはイベント監視が有効なため、接続が止まらない場合があります。");
      }
      if (room.streamerCount > 0) {
        lines.push(
          `登録ユーザー${room.streamerCount}件がいるため、Web/モバイルへログイン中のアクセス(セッション検証のたび)だけでほぼ即座に再開します。`
        );
      }
      lines.push(
        "これは恒久停止ではありません。ログイン中ユーザーのWeb/モバイルからのアクセス(セッション検証のたび)・同じTikTok IDでの新規登録/設定・OBSオーバーレイ表示・Workerのコラボ検知のいずれかで自動的に監視が再開します(既存仕様)。"
      );
      if (!window.confirm(lines.join("\n"))) return;

      setActioningRoomId(room.roomId);
      setActionError("");
      try {
        const res = await fetch("/api/admin/tiktok-rooms", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: room.roomId, action: "suspend" }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setActionError(body?.error ?? "監視解除に失敗しました");
          return;
        }
        await load();
      } catch {
        setActionError("監視解除に失敗しました");
      } finally {
        setActioningRoomId(null);
      }
    },
    [load]
  );

  const handleDelete = useCallback(
    async (room: AssignedRoom) => {
      const lines = [`@${room.tiktokId} を完全削除しますか? この操作は取り消せません。`];
      if (room.streamerCount > 0) {
        lines.push(
          `登録ユーザー${room.streamerCount}件はログイン・APIキーは維持されますが、この部屋との紐付け(roomId)が外れ、ギフト履歴・オーバーレイ表示は失われます。さらに、そのユーザーが次にアクセスすると同じTikTok IDの空の部屋が自動的に再作成され、監視も再開します。`
        );
      }
      if (room.watchCount > 0) {
        lines.push(`事務所監視(AgencyWatch)${room.watchCount}件も削除され、事務所の一覧から消えます。`);
      }
      if (!window.confirm(lines.join("\n"))) return;

      setActioningRoomId(room.roomId);
      setActionError("");
      try {
        const res = await fetch(`/api/admin/tiktok-rooms?id=${encodeURIComponent(room.roomId)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setActionError(body?.error ?? "削除に失敗しました");
          return;
        }
        await load();
      } catch {
        setActionError("削除に失敗しました");
      } finally {
        setActioningRoomId(null);
      }
    },
    [load]
  );

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

      <AddWatchForm onAdded={load} />

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
                    <ReassignControl
                      roomId={l.roomId}
                      currentWorker={w.workerIndex}
                      workerCount={report?.workerCount ?? null}
                      onReassigned={load}
                    />
                  </div>
                ))}
              </div>
            )}

            {w.reachable && w.listeners.length === 0 && (
              <div className="px-4 py-2 text-xs text-muted">listener なし（待機中）</div>
            )}

            {/* DB上の担当一覧。listener が動いていない/worker が応答不能でもここには出るので、
                手動移動が最も必要な障害時(worker死亡・起動失敗)でも操作できる。 */}
            {w.assignedRooms.length > 0 && (
              <div className="divide-y divide-border border-t border-border">
                <div className="px-4 py-1.5 text-[11px] text-muted">DB上の担当（手動移動はここから）</div>
                {w.assignedRooms.map((r) => {
                  const live = w.listeners.find((l) => l.roomId === r.roomId);
                  return (
                    <div key={r.roomId} className="px-4 py-2 flex items-center gap-3 flex-wrap">
                      <span className="text-sm text-strong">@{r.tiktokId}</span>
                      {live ? (
                        <span className={`text-xs ${statusColor(live.status)}`}>{live.status}</span>
                      ) : (
                        <span className="text-xs text-red-400">listener未起動</span>
                      )}
                      {r.consecutiveBlockedCount > 0 && (
                        <span className="text-xs text-yellow-400">
                          403連続{r.consecutiveBlockedCount}回
                        </span>
                      )}
                      <span className="ml-auto">
                        <ReassignControl
                          roomId={r.roomId}
                          currentWorker={w.workerIndex}
                          workerCount={report?.workerCount ?? null}
                          onReassigned={load}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
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

      {actionError && (
        <div className="mt-4 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {report && report.adminRoomList.length > 0 && (
        <div className="mt-4 rounded border border-border bg-panel overflow-x-auto">
          <div className="px-4 py-2 border-b border-border text-sm text-strong">
            監視対象一覧({report.adminRoomList.length}件)
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="text-left px-4 py-2 font-normal">
                  <button onClick={() => toggleSort("tiktokId")} className="hover:text-strong">
                    tiktokId {sortKey === "tiktokId" && (sortDir === "asc" ? "▲" : "▼")}
                  </button>
                </th>
                <th className="text-left px-4 py-2 font-normal">
                  <button onClick={() => toggleSort("listenerUpdatedAt")} className="hover:text-strong">
                    listener最終更新 {sortKey === "listenerUpdatedAt" && (sortDir === "asc" ? "▲" : "▼")}
                  </button>
                  <span className="block text-[10px] opacity-70">
                    connected以外でも更新されうる(最後にconnectedした時刻ではない)
                  </span>
                </th>
                <th className="text-left px-4 py-2 font-normal">
                  <button
                    onClick={() => toggleSort("weeklyEulerSignUsageCount")}
                    className="hover:text-strong"
                  >
                    週間署名消費 {sortKey === "weeklyEulerSignUsageCount" && (sortDir === "asc" ? "▲" : "▼")}
                  </button>
                  <span className="block text-[10px] opacity-70">成功/失敗含む・現在のroomId基準</span>
                </th>
                <th className="text-left px-4 py-2 font-normal">監視状態</th>
                <th className="text-left px-4 py-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedRoomList.map((r) => (
                <tr key={r.roomId}>
                  <td className="px-4 py-2 text-strong">@{r.tiktokId}</td>
                  <td className="px-4 py-2 text-muted">
                    {formatDuration(ageMs(r.listenerUpdatedAt, nowMs))}前
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {r.weeklyEulerSignUsageCount ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {r.monitoringSuspended ? (
                      <span className="text-yellow-600 dark:text-yellow-400">一時停止中</span>
                    ) : (
                      <span className="text-green-600 dark:text-green-400">監視中</span>
                    )}
                    {r.watchCount > 0 && <span className="ml-2">事務所監視{r.watchCount}件</span>}
                    {r.eventMonitored && <span className="ml-2">イベント監視中</span>}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSuspend(r)}
                        disabled={actioningRoomId === r.roomId || r.monitoringSuspended}
                        className="px-2 py-1 rounded border border-border text-strong hover:bg-row-hover disabled:opacity-50"
                      >
                        監視解除
                      </button>
                      <button
                        onClick={() => handleDelete(r)}
                        disabled={actioningRoomId === r.roomId}
                        className="px-2 py-1 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        完全削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report && report.unassignedRooms.length > 0 && (
        <div className="mt-4 rounded border border-border bg-panel">
          <div className="px-4 py-2 border-b border-border text-sm text-strong">workerId 未割当</div>
          <div className="divide-y divide-border">
            {report.unassignedRooms.map((r) => (
              <div key={r.roomId} className="px-4 py-2 text-xs text-muted flex items-center gap-3 flex-wrap">
                <span>@{r.tiktokId}</span>
                <span className="ml-auto">
                  <ReassignControl
                    roomId={r.roomId}
                    currentWorker={null}
                    workerCount={report?.workerCount ?? null}
                    onReassigned={load}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report && report.manualReassignAuditLog.length > 0 && (
        <div className="mt-4 rounded border border-border bg-panel">
          <div className="px-4 py-2 border-b border-border text-sm text-strong">
            手動移動履歴(直近{report.manualReassignAuditLog.length}件)
          </div>
          <div className="divide-y divide-border">
            {[...report.manualReassignAuditLog].reverse().map((entry, i) => (
              <div key={i} className="px-4 py-2 text-xs text-muted flex items-center gap-2 flex-wrap">
                <span className="text-strong">{new Date(entry.at).toLocaleString("ja-JP")}</span>
                <span>
                  @{entry.tiktokId} worker{entry.fromWorker ?? "未割当"} → worker{entry.toWorker}
                </span>
                {entry.operator && <span className="text-muted">by {entry.operator}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
