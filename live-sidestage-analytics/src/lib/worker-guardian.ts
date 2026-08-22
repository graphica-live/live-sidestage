import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getSetting } from "./settings";
import {
  fetchAssignedRooms,
  probeWorkers,
  parseWorkerInternalUrls,
  RECONCILE_STALE_MS,
  type AssignedRoom,
  type WorkerProbe,
} from "./worker-status";

// TikTok接続worker(worker1/2/3)のプロセスレベルの死活を監視し、死んだworkerの担当部屋だけを
// 生きてるworkerへ自動で移す(worker-guardian.ts から呼ばれる)。
//
// 部屋の listenerStatus(connected/retrying/...)は検知に使わない。配信者オフライン中の
// "retrying" は何時間でも続く正常状態であり、これをstuckとみなすと「オフラインが少し重なっただけで
// 死亡確定→移送→移送先でも同じことが起きて再度死亡確定」という無限メリーゴーラウンドになる
// (実装前のFableレビューで指摘されたCritical欠陥)。また本番の TIKTOK_PROXY_POOL は未設定であり、
// 部屋ごとのban回避を移送で解決できる構成でもない。したがって検知が救うべき障害は
// 「プロセスそのものの死(クラッシュ・無応答・reconcile停止)」に限定する。

export const GUARDIAN_POLL_INTERVAL_MS = Number(process.env.WORKER_GUARDIAN_POLL_INTERVAL_MS ?? 30_000);
export const CONSECUTIVE_BAD_POLLS_REQUIRED = Number(process.env.WORKER_GUARDIAN_BAD_POLLS_REQUIRED ?? 6);
export const COOLDOWN_MS = Number(process.env.WORKER_GUARDIAN_COOLDOWN_MS ?? 15 * 60_000);

/**
 * watchdogの再接続バックオフ(tiktok-listener.ts、非export)が上限10分に初めて達する
 * triggerCount。BASE(10s) * 2^(n-1) が cap(600s) に最初に達するのは n=7
 * (n=6: 320s, n=7: 640s→capped 600s)。「in-processの自己回復を使い切った」を意味する。
 */
export const WATCHDOG_TRIGGER_DEAD_THRESHOLD = 7;

// 固定の advisory lock キー。他のロック(イベント集計の FNV キー空間)と衝突しても
// 直列化されるだけで無害なので、単一の定数でよい。
const GUARDIAN_LOCK_KEY = 8_241_995_113n;

export const AUDIT_LOG_SETTING_KEY = "workerGuardianAuditLog";
const AUDIT_LOG_MAX_ENTRIES = 50;
export const KILL_SWITCH_SETTING_KEY = "workerGuardianDisabled";

export type HealthClassification = "healthy" | "unhealthy" | "inconclusive";

export type MigrationAssignment = { roomId: string; tiktokId: string; toWorker: number };

export type MigrationAuditEntry = {
  at: string;
  deadWorkerIndex: number;
  reason: "migrated" | "no_eligible_targets";
  assignments: MigrationAssignment[];
};

export type GuardianState = {
  streaks: Map<number, number>;
  lastMigrationAt: number | null;
};

export function createInitialState(): GuardianState {
  return { streaks: new Map(), lastMigrationAt: null };
}

/** kill switch(AppSetting)の値を解釈する。純粋関数。 */
export function isGuardianDisabled(settingValue: string | null): boolean {
  return settingValue === "true";
}

/** 直近の移送から cooldownMs 未満なら true。純粋関数。 */
export function shouldSkipDueToCooldown(
  lastMigrationAt: number | null,
  nowMs: number,
  cooldownMs: number
): boolean {
  if (lastMigrationAt == null) return false;
  return nowMs - lastMigrationAt < cooldownMs;
}

/**
 * 1 worker の不健全判定。純粋関数。
 *
 * 割当0件のworkerは(設定不整合・probe不通・unready・reconcile不調のいずれも無ければ)
 * 常にhealthy — worker2/3が0部屋でも異常ではない、という既存運用実態と一致させる。
 */
export function classifyWorkerHealth(input: {
  workerCount: number;
  urlCount: number;
  probe: WorkerProbe | undefined;
  assignedRooms: AssignedRoom[];
  now: Date;
}): HealthClassification {
  const { workerCount, urlCount, probe, assignedRooms, now } = input;

  // WORKER_COUNT変更作業中などの過渡状態。誤った移送計画を立てるより判定を止める。
  if (urlCount !== workerCount) return "inconclusive";

  if (!probe || !probe.ok) return "unhealthy";

  const p = probe.payload;
  if (p.workerCount !== workerCount) return "inconclusive";
  if (!p.ready) return "unhealthy";
  if (!p.lastReconcile) return "unhealthy";
  if (p.lastReconcile.error) return "unhealthy";

  const reconcileAgeMs = now.getTime() - new Date(p.lastReconcile.at).getTime();
  if (reconcileAgeMs > RECONCILE_STALE_MS) return "unhealthy";

  if (assignedRooms.length === 0) return "healthy";

  const listenerByRoomId = new Map(p.listeners.map((l) => [l.roomId, l]));
  const allStuck = assignedRooms.every((room) => {
    const listener = listenerByRoomId.get(room.roomId);
    // listenerが存在しない(=起動さえできていない)のもstuck扱いにする。
    const triggerCount = listener ? listener.watchdogTriggerCount : Infinity;
    return triggerCount >= WATCHDOG_TRIGGER_DEAD_THRESHOLD;
  });

  return allStuck ? "unhealthy" : "healthy";
}

/**
 * 連続不健全カウントを更新する。純粋関数。
 *
 * 遷移規則: 不健全→+1 / 健全→0にリセット / 判定不能→据え置き(触らない)。
 * deadWorkers は「このサイクルで初めて閾値を跨いだ」workerのみ(2回目以降の連続不健全では
 * 再度は積まない — 死亡確定後は担当部屋が0件になり通常healthyへ落ち着くか、probe不通が
 * 続く限りunhealthyのままだが、移送は既に完了しているので再度積む必要がない)。
 */
export function updateHealthStreaks(
  prevStreaks: Map<number, number>,
  classifications: Map<number, HealthClassification>,
  required: number
): { streaks: Map<number, number>; deadWorkers: number[]; recovered: number[] } {
  const streaks = new Map(prevStreaks);
  const deadWorkers: number[] = [];
  const recovered: number[] = [];

  for (const [workerIndex, classification] of classifications) {
    const prev = streaks.get(workerIndex) ?? 0;
    if (classification === "unhealthy") {
      const next = prev + 1;
      streaks.set(workerIndex, next);
      if (prev < required && next >= required) deadWorkers.push(workerIndex);
    } else if (classification === "healthy") {
      if (prev > 0) recovered.push(workerIndex);
      streaks.set(workerIndex, 0);
    }
    // inconclusive: 何もしない(cloneした prevStreaks の値がそのまま残る)。
  }

  return { streaks, deadWorkers, recovered };
}

/**
 * 死んだworkerの担当部屋を、その回のpollでhealthyなworkerへ least-loaded-first で割り振る。
 * 純粋関数。候補0件なら全件unassignableにする(他の弱ってるworkerへ押し付けない)。
 */
export function planReassignment(input: {
  rooms: { id: string; tiktokId: string }[];
  eligibleTargets: number[];
  currentLoad: Map<number, number>;
}): {
  assignments: MigrationAssignment[];
  unassignable: { roomId: string; tiktokId: string }[];
} {
  const { rooms, eligibleTargets, currentLoad } = input;

  if (eligibleTargets.length === 0) {
    return { assignments: [], unassignable: rooms.map((r) => ({ roomId: r.id, tiktokId: r.tiktokId })) };
  }

  const load = new Map(currentLoad);
  for (const idx of eligibleTargets) if (!load.has(idx)) load.set(idx, 0);

  const sortedRooms = [...rooms].sort((a, b) => a.id.localeCompare(b.id));
  const assignments: MigrationAssignment[] = [];

  for (const room of sortedRooms) {
    let best = eligibleTargets[0];
    let bestLoad = load.get(best) ?? 0;
    for (const idx of eligibleTargets) {
      const l = load.get(idx) ?? 0;
      if (l < bestLoad || (l === bestLoad && idx < best)) {
        best = idx;
        bestLoad = l;
      }
    }
    assignments.push({ roomId: room.id, tiktokId: room.tiktokId, toWorker: best });
    load.set(best, bestLoad + 1);
  }

  return { assignments, unassignable: [] };
}

async function appendAuditLog(tx: Prisma.TransactionClient, entry: MigrationAuditEntry): Promise<void> {
  const row = await tx.appSetting.findUnique({ where: { key: AUDIT_LOG_SETTING_KEY } });
  let list: MigrationAuditEntry[] = [];
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  list.push(entry);
  const trimmed = list.slice(-AUDIT_LOG_MAX_ENTRIES);
  await tx.appSetting.upsert({
    where: { key: AUDIT_LOG_SETTING_KEY },
    create: { key: AUDIT_LOG_SETTING_KEY, value: JSON.stringify(trimmed) },
    update: { value: JSON.stringify(trimmed) },
  });
}

/**
 * 死亡確定したworker1件ぶんの移送を実行する。書き込みフェーズ全体を
 * pg_try_advisory_xact_lock(非ブロッキング、tx-scoped)で囲む — Railwayのデプロイで
 * guardianインスタンスが瞬間的に2つ並走しても、書き込みは片方だけが行う。
 * event集計ワーカーの advisory lock と同じ方式(tiktok-listener.ts:744 の combo-gift 書き込みは
 * ブロッキング版 pg_advisory_xact_lock で別物)。
 *
 * ロック取得後、対象部屋を再読込してから updateMany する(死亡確定からここまでの間に
 * 既に他所へ動いていた部屋を誤って奪わないよう、WHERE workerId = deadWorkerIndex を条件に含める)。
 * audit log の追記も同じ tx クライアントで行う — グローバルな setSetting() を使うと
 * tx 内の変更と競合して lost update になりうるため。
 */
async function migrateDeadWorker(
  deadWorkerIndex: number,
  orphanedRoomIds: string[],
  eligibleTargets: number[],
  currentLoad: Map<number, number>
): Promise<MigrationAuditEntry | null> {
  return prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${GUARDIAN_LOCK_KEY}::bigint) AS locked
    `;
    if (!locked) {
      console.warn("[worker-guardian] 別インスタンスが移送処理中 — このサイクルはスキップ");
      return null;
    }

    const now = new Date();

    // ロック取得後に再読込。死亡確定からここまでの間に別途動いた部屋を除外する。
    const freshRooms = await tx.tiktokRoom.findMany({
      where: { id: { in: orphanedRoomIds }, workerId: deadWorkerIndex },
      select: { id: true, tiktokId: true },
    });

    if (freshRooms.length === 0) {
      // 既に何も担当していない(前サイクルで移送済み等)。何もせず終える。
      return null;
    }

    const plan = planReassignment({
      rooms: freshRooms.map((r) => ({ id: r.id, tiktokId: r.tiktokId })),
      eligibleTargets,
      currentLoad,
    });

    if (plan.assignments.length === 0) {
      const entry: MigrationAuditEntry = {
        at: now.toISOString(),
        deadWorkerIndex,
        reason: "no_eligible_targets",
        assignments: [],
      };
      console.error(
        `[worker-guardian] worker${deadWorkerIndex}死亡だが移送先候補0件 — 手動対応が必要(部屋${plan.unassignable.length}件)`
      );
      await appendAuditLog(tx, entry);
      return entry;
    }

    const roomIdsByTarget = new Map<number, string[]>();
    for (const a of plan.assignments) {
      const list = roomIdsByTarget.get(a.toWorker) ?? [];
      list.push(a.roomId);
      roomIdsByTarget.set(a.toWorker, list);
    }
    for (const [toWorker, roomIds] of roomIdsByTarget) {
      await tx.tiktokRoom.updateMany({
        where: { id: { in: roomIds }, workerId: deadWorkerIndex },
        data: { workerId: toWorker },
      });
    }

    const entry: MigrationAuditEntry = {
      at: now.toISOString(),
      deadWorkerIndex,
      reason: "migrated",
      assignments: plan.assignments,
    };
    console.error(
      `[worker-guardian] worker${deadWorkerIndex}の部屋${plan.assignments.length}件を移送した: ` +
        plan.assignments.map((a) => `@${a.tiktokId}→worker${a.toWorker}`).join(", ")
    );
    await appendAuditLog(tx, entry);
    return entry;
  });
}

/** 1サイクルぶんの検知+(必要なら)移送を実行し、次サイクルへ渡す状態を返す。 */
export async function runGuardianCycle(state: GuardianState): Promise<GuardianState> {
  const disabledSetting = await getSetting(KILL_SWITCH_SETTING_KEY).catch((err) => {
    console.error("[worker-guardian] kill switch の読み取りに失敗:", err);
    return null;
  });
  if (isGuardianDisabled(disabledSetting)) {
    console.log(`[worker-guardian] kill switch有効(${KILL_SWITCH_SETTING_KEY}=true) — このサイクルはスキップ`);
    return state;
  }

  const now = new Date();
  const rawWorkerCount = Number(process.env.WORKER_COUNT);
  const workerCount = Number.isInteger(rawWorkerCount) && rawWorkerCount >= 1 ? rawWorkerCount : null;
  const urls = parseWorkerInternalUrls(process.env.WORKER_INTERNAL_URLS);

  if (!workerCount) {
    console.error("[worker-guardian] WORKER_COUNTが不正 — このサイクルは判定不能としてスキップ");
    return state;
  }

  let rooms: AssignedRoom[];
  try {
    rooms = await fetchAssignedRooms(now);
  } catch (err) {
    console.error("[worker-guardian] DB取得に失敗 — このサイクルは判定不能としてスキップ:", err);
    return state;
  }

  const probes = await probeWorkers(urls, process.env.INTERNAL_API_SECRET);
  const probeByIndex = new Map(probes.map((p) => [p.workerIndex, p]));

  const classifications = new Map<number, HealthClassification>();
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
    const assignedRooms = rooms.filter((r) => r.workerId === workerIndex);
    classifications.set(
      workerIndex,
      classifyWorkerHealth({
        workerCount,
        urlCount: urls.length,
        probe: probeByIndex.get(workerIndex),
        assignedRooms,
        now,
      })
    );
  }

  const { streaks, deadWorkers, recovered } = updateHealthStreaks(
    state.streaks,
    classifications,
    CONSECUTIVE_BAD_POLLS_REQUIRED
  );

  for (const idx of recovered) {
    console.log(`[worker-guardian] worker${idx}が回復した(移送済みの部屋は自動で戻さない)`);
  }

  if (deadWorkers.length === 0) {
    return { streaks, lastMigrationAt: state.lastMigrationAt };
  }

  for (const idx of deadWorkers) {
    console.error(
      `[worker-guardian] worker${idx}を死亡と判定した(${CONSECUTIVE_BAD_POLLS_REQUIRED}回連続不健全)`
    );
  }

  if (shouldSkipDueToCooldown(state.lastMigrationAt, now.getTime(), COOLDOWN_MS)) {
    console.warn(
      `[worker-guardian] クールダウン中(前回移送から${Math.round(
        (now.getTime() - (state.lastMigrationAt ?? 0)) / 1000
      )}秒)のため今回は移送しない`
    );
    return { streaks, lastMigrationAt: state.lastMigrationAt };
  }

  const eligibleTargets = [...classifications.entries()]
    .filter(([, c]) => c === "healthy")
    .map(([idx]) => idx);

  let migrated = false;
  for (const deadIndex of deadWorkers) {
    const orphanedRoomIds = rooms.filter((r) => r.workerId === deadIndex).map((r) => r.roomId);
    if (orphanedRoomIds.length === 0) continue;

    const currentLoad = new Map<number, number>();
    for (const idx of eligibleTargets) {
      currentLoad.set(idx, rooms.filter((r) => r.workerId === idx).length);
    }

    const entry = await migrateDeadWorker(deadIndex, orphanedRoomIds, eligibleTargets, currentLoad).catch(
      (err) => {
        console.error(`[worker-guardian] worker${deadIndex}の移送処理で例外:`, err);
        return null;
      }
    );
    if (entry?.reason === "migrated") migrated = true;
  }

  return { streaks, lastMigrationAt: migrated ? now.getTime() : state.lastMigrationAt };
}
