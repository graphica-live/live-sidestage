import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { watchedRoomFilter, type ListenerSnapshot } from "./tiktok-listener";

// Worker プロセスの稼働状況を管理画面向けに集約する。
//
// 情報源は2つあり、役割が違う。
//
//   1. DB(TiktokRoom) — 「どの Worker がどの部屋を担当することになっているか」。
//      workerId は初回 hash(roomId) % WORKER_COUNT で決まり永続化されるが、それは既定値に
//      すぎない。worker-guardian の死亡フェイルオーバー移送、コラボ検知worker自身の
//      自己申告(ensureRoomWatchedForCollab)がhashと無関係な値を書くため、DB上の値が正。
//      listenerStatus も持っているが、これは persistState() が best effort で書いた
//      「最後に書き込めた状態」で、定期更新があるのは connected のときだけ(30秒 heartbeat)。
//      retrying/connecting/idle は古い値が残り続けるため、現在状態の正とは扱わない。
//
//   2. 各 Worker の GET /status — 「今そのプロセスが実際に何を保持しているか」。
//      ready / reconcile の生死 / in-memory の listener 一覧が取れる。
//
// 2つを突き合わせることで「DB 上は担当なのに listener が動いていない」「Worker が
// 応答しない」といった、どちらか片方だけでは分からない食い違いを検出する。
//
// どちらかが取れなくても、取れた方だけで可能な範囲を返す(DB 障害時も Worker の死活は分かる)。

/** 定常時の reconcile 間隔(worker.ts の RECONCILE_INTERVAL_MS)の6周ぶん。worker-guardian.ts も再利用する。 */
export const RECONCILE_STALE_MS = 180_000;

/** 各 Worker の /status を待つ上限。3台に対して直列には投げないので、短くてよい。 */
export const PROBE_TIMEOUT_MS = 3000;

export type WorkerLastReconcile = {
  at: string;
  durationMs: number;
  roomCount: number | null;
  startFailures: number | null;
  error: string | null;
};

/** Worker の GET /status が返す形。worker.ts のレスポンスと対応する。 */
export type WorkerStatusPayload = {
  workerIndex: number;
  workerCount: number;
  ready: boolean;
  startedAt: string;
  uptimeMs: number;
  reconcileRunning: boolean;
  lastReconcile: WorkerLastReconcile | null;
  listeners: ListenerSnapshot[];
};

export type WorkerProbe =
  | { workerIndex: number; url: string; ok: true; payload: WorkerStatusPayload }
  | { workerIndex: number; url: string | null; ok: false; error: string };

/** DB 上の「担当予定部屋」。実際に listener が動いているかはここでは分からない。 */
export type AssignedRoom = {
  roomId: string;
  tiktokId: string;
  workerId: number | null;
  listenerStatus: string | null;
  listenerMessage: string | null;
  listenerUpdatedAt: string | null;
  streamerCount: number;
  watchCount: number;
  eventMonitored: boolean;
  consecutiveBlockedCount: number;
};

export type WorkerIssue = {
  type:
    | "invalid_worker_count"
    | "worker_url_count_mismatch"
    | "worker_unreachable"
    | "worker_unready"
    | "worker_count_mismatch"
    | "worker_index_mismatch"
    | "reconcile_stale"
    | "reconcile_failing"
    | "start_failures"
    | "assigned_not_running"
    | "running_not_assigned"
    | "room_out_of_range"
    | "room_unassigned"
    | "listener_not_connected";
  severity: "error" | "warn";
  workerIndex?: number;
  tiktokId?: string;
  detail: string;
};

export type WorkerReport = {
  generatedAt: string;
  workerCount: number | null;
  workers: Array<{
    workerIndex: number;
    url: string | null;
    reachable: boolean;
    error: string | null;
    ready: boolean | null;
    startedAt: string | null;
    uptimeMs: number | null;
    reconcileRunning: boolean | null;
    lastReconcile: WorkerLastReconcile | null;
    reportedWorkerCount: number | null;
    /** そのプロセスが実際に保持している listener。 */
    listeners: ListenerSnapshot[];
    /** DB 上この Worker の担当になっている部屋。listeners と一致するとは限らない。 */
    assignedRooms: AssignedRoom[];
  }>;
  unassignedRooms: AssignedRoom[];
  outOfRangeRooms: AssignedRoom[];
  issues: WorkerIssue[];
  dbError: string | null;
};

/**
 * WORKER_INTERNAL_URLS を配列にする。JSON 配列の文字列を想定し、壊れていれば空配列を返す
 * (設定ミスで管理画面ごと落とさない。URL 数の不足は issue として可視化する)。
 */
export function parseWorkerInternalUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .map((v) => v.replace(/\/+$/, ""));
  } catch {
    return [];
  }
}

/** 監視対象の部屋を DB から取る。条件は watchedRoomFilter() が単一の正。 */
export async function fetchAssignedRooms(now: Date = new Date()): Promise<AssignedRoom[]> {
  const rooms = await prisma.tiktokRoom.findMany({
    where: watchedRoomFilter(now),
    // Streamer.apiKey などを持ってこないよう列は明示する。
    select: {
      id: true,
      tiktokId: true,
      workerId: true,
      listenerStatus: true,
      listenerMessage: true,
      listenerUpdatedAt: true,
      monitorUntil: true,
      consecutiveBlockedCount: true,
      _count: { select: { streamers: true, watches: true } },
    },
    orderBy: [{ workerId: "asc" }, { tiktokId: "asc" }],
  });

  return rooms.map((r) => ({
    roomId: r.id,
    tiktokId: r.tiktokId,
    workerId: r.workerId,
    listenerStatus: r.listenerStatus,
    listenerMessage: r.listenerMessage,
    listenerUpdatedAt: r.listenerUpdatedAt?.toISOString() ?? null,
    streamerCount: r._count.streamers,
    watchCount: r._count.watches,
    eventMonitored: r.monitorUntil != null && r.monitorUntil > now,
    consecutiveBlockedCount: r.consecutiveBlockedCount,
  }));
}

/** 管理画面からの手動 worker 移動の履歴。worker-guardian.ts の自動移送(MigrationAuditEntry)とは別枠。 */
export type ManualReassignAuditEntry = {
  at: string;
  roomId: string;
  tiktokId: string;
  fromWorker: number | null;
  toWorker: number;
  operator: string | null;
};

export const MANUAL_REASSIGN_AUDIT_LOG_SETTING_KEY = "worker_manual_reassign_audit_log";
const MANUAL_REASSIGN_AUDIT_LOG_MAX_ENTRIES = 50;

/** 保存済みの手動移動履歴を読む。読めなくても画面を落とさないよう呼び出し側で catch する。 */
export async function fetchManualReassignAuditLog(): Promise<ManualReassignAuditEntry[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: MANUAL_REASSIGN_AUDIT_LOG_SETTING_KEY } });
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendManualReassignAuditLog(
  tx: Prisma.TransactionClient,
  entry: ManualReassignAuditEntry
): Promise<void> {
  const row = await tx.appSetting.findUnique({ where: { key: MANUAL_REASSIGN_AUDIT_LOG_SETTING_KEY } });
  let list: ManualReassignAuditEntry[] = [];
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  list.push(entry);
  const trimmed = list.slice(-MANUAL_REASSIGN_AUDIT_LOG_MAX_ENTRIES);
  await tx.appSetting.upsert({
    where: { key: MANUAL_REASSIGN_AUDIT_LOG_SETTING_KEY },
    create: { key: MANUAL_REASSIGN_AUDIT_LOG_SETTING_KEY, value: JSON.stringify(trimmed) },
    update: { value: JSON.stringify(trimmed) },
  });
}

export type ReassignResult =
  | { status: "ok"; roomId: string; tiktokId: string; fromWorker: number | null }
  | { status: "not_found" }
  | { status: "conflict"; actualWorkerId: number | null };

// 管理画面からの手動 worker 移動。worker-guardian.ts の自動フェイルオーバー
// (migrateBlockedRoom/migrateDeadWorker)と同じ2点を踏襲する。
//
// (1) $transaction + updateMany の where に現在の workerId(expectedWorkerId)を含めて
//     楽観的排他を取る。無しだと「管理者がworker0→1のつもりでボタンを押す間に
//     worker-guardianが既にworker2へ移送していた」場合、管理者の意図と違う相手を
//     上書きし、監査ログにも古いfromWorkerが残って実態と食い違う。
// (2) consecutiveBlockedCount を 0 にリセットする。リセットしないと、直後の
//     runGuardianCycle が「まだ403連続超過」とみなし続け、手動で退避させた
//     直後に別workerへ再移送する/give_upで監視そのものを止めてしまう。
// (3) 監査ログの追記を同じ tx で行う(worker-guardian.tsの appendAuditLog と同じ理由 —
//     tx外の setSetting() は tx内の変更と競合して lost update になりうる)。
export async function reassignRoomWorker(
  roomId: string,
  toWorkerIndex: number,
  workerCount: number,
  expectedWorkerId: number | null,
  operator: string | null
): Promise<ReassignResult> {
  if (!Number.isInteger(toWorkerIndex) || toWorkerIndex < 0 || toWorkerIndex >= workerCount) {
    throw new Error(`toWorkerIndex は 0 以上 ${workerCount} 未満の整数である必要がある`);
  }

  return prisma.$transaction(async (tx) => {
    const room = await tx.tiktokRoom.findUnique({
      where: { id: roomId },
      select: { tiktokId: true, workerId: true },
    });
    if (!room) return { status: "not_found" };

    if (room.workerId !== expectedWorkerId) {
      return { status: "conflict", actualWorkerId: room.workerId };
    }

    const { count } = await tx.tiktokRoom.updateMany({
      where: { id: roomId, workerId: expectedWorkerId },
      data: { workerId: toWorkerIndex, consecutiveBlockedCount: 0 },
    });
    if (count === 0) return { status: "conflict", actualWorkerId: room.workerId };

    await appendManualReassignAuditLog(tx, {
      at: new Date().toISOString(),
      roomId,
      tiktokId: room.tiktokId,
      fromWorker: expectedWorkerId,
      toWorker: toWorkerIndex,
      operator,
    });

    return { status: "ok", roomId, tiktokId: room.tiktokId, fromWorker: expectedWorkerId };
  });
}

/**
 * 各 Worker の /status を並列に叩く。1台の不調が他をブロックしないよう allSettled で受ける。
 * fetchImpl はテストから差し替えるためだけの引数。
 */
export async function probeWorkers(
  urls: string[],
  secret: string | undefined,
  timeoutMs: number = PROBE_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch
): Promise<WorkerProbe[]> {
  const results = await Promise.allSettled(
    urls.map(async (url, workerIndex): Promise<WorkerProbe> => {
      if (!secret) {
        return { workerIndex, url, ok: false, error: "INTERNAL_API_SECRET が未設定" };
      }
      try {
        const res = await fetchImpl(`${url}/status`, {
          headers: { "x-internal-secret": secret },
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
        if (!res.ok) {
          return { workerIndex, url, ok: false, error: `HTTP ${res.status}` };
        }
        return { workerIndex, url, ok: true, payload: (await res.json()) as WorkerStatusPayload };
      } catch (err) {
        return {
          workerIndex,
          url,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  return results.map((r, workerIndex) =>
    r.status === "fulfilled"
      ? r.value
      : {
          workerIndex,
          url: urls[workerIndex] ?? null,
          ok: false,
          error: String(r.reason).slice(0, 200),
        }
  );
}

/**
 * 手動移動の直後に toWorker/fromWorker へ即時 reconcile を依頼する(worker.ts の
 * POST /internal/reconcile-now)。ベストエフォート — 呼び出し元をブロックしない・
 * 失敗は例外を投げずログのみ。**commit 後にのみ呼ぶこと**(commit 前に呼ぶと
 * Worker が古い workerId を読んで空振りする)。届かなくても既存の最大30秒
 * reconcile 周期へ自然に劣化するだけなので、失敗を呼び出し元へ伝播させない。
 * fetchImpl はテストから差し替えるためだけの引数。
 */
export function notifyWorkersOfManualReassign(input: {
  fromWorker: number | null;
  toWorker: number;
  urls: string[];
  secret: string | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): void {
  const { fromWorker, toWorker, urls, secret, timeoutMs = PROBE_TIMEOUT_MS, fetchImpl = fetch } = input;
  if (!secret) {
    console.warn(
      "[worker-status] manual reassign 即時通知をスキップ(INTERNAL_API_SECRET未設定) — 最大30秒のreconcileフォールバックへ委譲"
    );
    return;
  }

  const targets = new Set<number>([toWorker]);
  if (fromWorker != null) targets.add(fromWorker);

  for (const workerIndex of targets) {
    const url = urls[workerIndex];
    if (!url) continue; // WORKER_INTERNAL_URLS 件数不足(既知の劣化状態)はスキップ
    fetchImpl(`${url}/internal/reconcile-now`, {
      method: "POST",
      headers: { "x-internal-secret": secret },
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((err) => {
      console.warn(
        `[worker-status] manual reassign 即時通知に失敗(worker${workerIndex}) — 最大30秒のreconcileフォールバックへ委譲:`,
        err instanceof Error ? err.message : String(err)
      );
    });
  }
}

/**
 * DB と Worker の応答を突き合わせてレポートを作る。副作用も時刻依存もない純粋関数
 * (now を受け取る)ので、境界値のテストが素直に書ける。
 */
export function buildWorkerReport(input: {
  workerCount: number | null;
  urls: string[];
  probes: WorkerProbe[];
  rooms: AssignedRoom[];
  dbError: string | null;
  now: Date;
}): WorkerReport {
  const { workerCount, urls, probes, rooms, dbError, now } = input;
  const issues: WorkerIssue[] = [];

  const validCount = workerCount != null && Number.isInteger(workerCount) && workerCount >= 1;
  if (!validCount) {
    issues.push({
      type: "invalid_worker_count",
      severity: "error",
      detail: `Web の WORKER_COUNT が不正: ${String(workerCount)}`,
    });
  }

  if (validCount && urls.length !== workerCount) {
    issues.push({
      type: "worker_url_count_mismatch",
      severity: "error",
      detail: `WORKER_INTERNAL_URLS の件数(${urls.length})が WORKER_COUNT(${workerCount})と一致しない`,
    });
  }

  // 担当 worker が決まっている部屋を workerId ごとに分ける。
  const unassignedRooms = rooms.filter((r) => r.workerId == null);
  const outOfRangeRooms = validCount
    ? rooms.filter((r) => r.workerId != null && r.workerId >= workerCount!)
    : [];

  for (const room of unassignedRooms) {
    issues.push({
      type: "room_unassigned",
      severity: "warn",
      tiktokId: room.tiktokId,
      detail: "workerId 未割当。次の reconcile でどれかの Worker が引き取る",
    });
  }
  for (const room of outOfRangeRooms) {
    issues.push({
      type: "room_out_of_range",
      severity: "error",
      tiktokId: room.tiktokId,
      detail: `workerId=${room.workerId} は WORKER_COUNT=${workerCount} の範囲外。担当する Worker が存在しない`,
    });
  }

  // 表示する worker の枠は「WORKER_COUNT」と「応答があった index」の和集合にする。
  // 縮退直後に残っている古い Worker も見えるようにするため。
  const indexes = new Set<number>();
  if (validCount) {
    for (let i = 0; i < workerCount!; i++) indexes.add(i);
  }
  for (const p of probes) indexes.add(p.workerIndex);

  const workers = [...indexes]
    .sort((a, b) => a - b)
    .map((workerIndex) => {
      const probe = probes.find((p) => p.workerIndex === workerIndex);
      const assignedRooms = rooms.filter((r) => r.workerId === workerIndex);
      const url = urls[workerIndex] ?? null;

      if (!probe || !probe.ok) {
        issues.push({
          type: "worker_unreachable",
          severity: "error",
          workerIndex,
          detail: probe?.ok === false ? probe.error : "URL が設定されていない",
        });
        return {
          workerIndex,
          url,
          reachable: false,
          error: probe?.ok === false ? probe.error : "URL が設定されていない",
          ready: null,
          startedAt: null,
          uptimeMs: null,
          reconcileRunning: null,
          lastReconcile: null,
          reportedWorkerCount: null,
          listeners: [],
          assignedRooms,
        };
      }

      const p = probe.payload;

      if (!p.ready) {
        issues.push({
          type: "worker_unready",
          severity: "error",
          workerIndex,
          detail: "起動時に担当部屋の listener を揃えられていない(/healthz は 503)",
        });
      }
      if (validCount && p.workerCount !== workerCount) {
        issues.push({
          type: "worker_count_mismatch",
          severity: "error",
          workerIndex,
          detail: `Worker 側の WORKER_COUNT=${p.workerCount} が Web 側の ${workerCount} と食い違う`,
        });
      }
      if (p.workerIndex !== workerIndex) {
        issues.push({
          type: "worker_index_mismatch",
          severity: "error",
          workerIndex,
          detail: `URL の順序では ${workerIndex} 番だが、応答した Worker は WORKER_INDEX=${p.workerIndex}`,
        });
      }

      if (!p.lastReconcile) {
        issues.push({
          type: "reconcile_stale",
          severity: "warn",
          workerIndex,
          detail: "reconcile がまだ1度も完了していない",
        });
      } else {
        const ageMs = now.getTime() - new Date(p.lastReconcile.at).getTime();
        if (ageMs > RECONCILE_STALE_MS) {
          issues.push({
            type: "reconcile_stale",
            severity: "error",
            workerIndex,
            detail: `最後の reconcile から ${Math.round(ageMs / 1000)}秒経過している`,
          });
        }
        if (p.lastReconcile.error) {
          issues.push({
            type: "reconcile_failing",
            severity: "error",
            workerIndex,
            detail: `直近の reconcile が失敗: ${p.lastReconcile.error}`,
          });
        }
        if ((p.lastReconcile.startFailures ?? 0) > 0) {
          issues.push({
            type: "start_failures",
            severity: "error",
            workerIndex,
            detail: `${p.lastReconcile.startFailures}件の部屋で listener を起動できていない`,
          });
        }
      }

      // DB の担当と実 listener の突き合わせ。DB が読めなかった場合は比較しない。
      if (!dbError) {
        const runningRoomIds = new Set(p.listeners.map((l) => l.roomId));
        for (const room of assignedRooms) {
          if (!runningRoomIds.has(room.roomId)) {
            issues.push({
              type: "assigned_not_running",
              severity: "error",
              workerIndex,
              tiktokId: room.tiktokId,
              detail: "DB 上はこの Worker の担当だが listener が存在しない",
            });
          }
        }
        const assignedRoomIds = new Set(assignedRooms.map((r) => r.roomId));
        for (const listener of p.listeners) {
          if (!assignedRoomIds.has(listener.roomId)) {
            issues.push({
              type: "running_not_assigned",
              severity: "warn",
              workerIndex,
              tiktokId: listener.tiktokId,
              detail: "listener は動いているが DB 上この Worker の担当ではない(次の reconcile で解放される)",
            });
          }
        }
      }

      for (const listener of p.listeners) {
        if (listener.status !== "connected") {
          issues.push({
            type: "listener_not_connected",
            severity: "warn",
            workerIndex,
            tiktokId: listener.tiktokId,
            detail: `${listener.status}: ${listener.message}`,
          });
        }
      }

      return {
        workerIndex,
        url,
        reachable: true,
        error: null,
        ready: p.ready,
        startedAt: p.startedAt,
        uptimeMs: p.uptimeMs,
        reconcileRunning: p.reconcileRunning,
        lastReconcile: p.lastReconcile,
        reportedWorkerCount: p.workerCount,
        listeners: p.listeners,
        assignedRooms,
      };
    });

  return {
    generatedAt: now.toISOString(),
    workerCount,
    workers,
    unassignedRooms,
    outOfRangeRooms,
    issues,
    dbError,
  };
}
