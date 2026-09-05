import { describe, it, expect } from "vitest";
import {
  classifyWorkerHealth,
  updateHealthStreaks,
  planReassignment,
  isGuardianDisabled,
  shouldSkipDueToCooldown,
  decideBlockedRoomAction,
  BLOCKED_REASSIGN_GUARD_MS,
  WATCHDOG_TRIGGER_DEAD_THRESHOLD,
  type HealthClassification,
} from "./worker-guardian";
import type { AssignedRoom, WorkerProbe, WorkerStatusPayload } from "./worker-status";
import type { ListenerSnapshot } from "./tiktok-listener";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function listener(overrides: Partial<ListenerSnapshot> = {}): ListenerSnapshot {
  return {
    roomId: "room-a",
    tiktokId: "alice",
    status: "connected",
    message: "接続中",
    updatedAt: NOW.toISOString(),
    subscriberCount: 1,
    silentForMs: 1000,
    watchdogTriggerCount: 0,
    reconnectFailureCount: 0,
    ...overrides,
  };
}

function room(overrides: Partial<AssignedRoom> = {}): AssignedRoom {
  return {
    roomId: "room-a",
    tiktokId: "alice",
    workerId: 0,
    listenerStatus: "connected",
    listenerMessage: "接続中",
    listenerUpdatedAt: NOW.toISOString(),
    streamerCount: 1,
    watchCount: 0,
    eventMonitored: false,
    consecutiveBlockedCount: 0,
    ...overrides,
  };
}

function payload(overrides: Partial<WorkerStatusPayload> = {}): WorkerStatusPayload {
  return {
    workerIndex: 0,
    workerCount: 1,
    ready: true,
    startedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    uptimeMs: 60_000,
    reconcileRunning: false,
    lastReconcile: {
      at: new Date(NOW.getTime() - 10_000).toISOString(),
      durationMs: 120,
      roomCount: 1,
      startFailures: 0,
      error: null,
    },
    listeners: [listener()],
    ...overrides,
  };
}

function okProbe(workerIndex: number, p: WorkerStatusPayload = payload()): WorkerProbe {
  return { workerIndex, url: `http://w${workerIndex}:8080`, ok: true, payload: p };
}

describe("classifyWorkerHealth", () => {
  it("全て正常ならhealthy", () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: okProbe(0),
      assignedRooms: [room()],
      now: NOW,
    });
    expect(c).toBe("healthy");
  });

  it("割当0件のworkerは常にhealthy", () => {
    const c = classifyWorkerHealth({
      workerCount: 2,
      urlCount: 2,
      probe: okProbe(1, payload({ workerIndex: 1, workerCount: 2, listeners: [] })),
      assignedRooms: [],
      now: NOW,
    });
    expect(c).toBe("healthy");
  });

  it("probe不通はunhealthy(割当0件でも)", () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: { workerIndex: 0, url: "http://w0:8080", ok: false, error: "ECONNREFUSED" },
      assignedRooms: [],
      now: NOW,
    });
    expect(c).toBe("unhealthy");
  });

  it("readyでなければunhealthy", () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: okProbe(0, payload({ ready: false })),
      assignedRooms: [room()],
      now: NOW,
    });
    expect(c).toBe("unhealthy");
  });

  it("reconcileが180秒より新しければ古すぎ扱いしない(境界)", () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: okProbe(
        0,
        payload({
          lastReconcile: {
            at: new Date(NOW.getTime() - 180_000).toISOString(),
            durationMs: 10,
            roomCount: 1,
            startFailures: 0,
            error: null,
          },
        })
      ),
      assignedRooms: [room()],
      now: NOW,
    });
    expect(c).toBe("healthy");
  });

  it("reconcileが180秒を超えて古ければunhealthy", () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: okProbe(
        0,
        payload({
          lastReconcile: {
            at: new Date(NOW.getTime() - 181_000).toISOString(),
            durationMs: 10,
            roomCount: 1,
            startFailures: 0,
            error: null,
          },
        })
      ),
      assignedRooms: [room()],
      now: NOW,
    });
    expect(c).toBe("unhealthy");
  });

  it("reconcileがエラーならunhealthy", () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: okProbe(
        0,
        payload({
          lastReconcile: {
            at: new Date(NOW.getTime() - 1000).toISOString(),
            durationMs: 10,
            roomCount: null,
            startFailures: null,
            error: "connection pool timeout",
          },
        })
      ),
      assignedRooms: [room()],
      now: NOW,
    });
    expect(c).toBe("unhealthy");
  });

  it("WORKER_INTERNAL_URLSの件数がWORKER_COUNTと食い違えば判定不能", () => {
    const c = classifyWorkerHealth({
      workerCount: 3,
      urlCount: 1,
      probe: okProbe(0),
      assignedRooms: [room()],
      now: NOW,
    });
    expect(c).toBe("inconclusive");
  });

  it("probe応答のworkerCountが食い違えば判定不能", () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: okProbe(0, payload({ workerCount: 2 })),
      assignedRooms: [room()],
      now: NOW,
    });
    expect(c).toBe("inconclusive");
  });

  it(`watchdogTriggerCountが${WATCHDOG_TRIGGER_DEAD_THRESHOLD}未満ならhealthy`, () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: okProbe(
        0,
        payload({ listeners: [listener({ status: "retrying", watchdogTriggerCount: WATCHDOG_TRIGGER_DEAD_THRESHOLD - 1 })] })
      ),
      assignedRooms: [room()],
      now: NOW,
    });
    expect(c).toBe("healthy");
  });

  it(`割当済み全部屋のwatchdogTriggerCountが${WATCHDOG_TRIGGER_DEAD_THRESHOLD}以上ならunhealthy`, () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: okProbe(
        0,
        payload({ listeners: [listener({ status: "retrying", watchdogTriggerCount: WATCHDOG_TRIGGER_DEAD_THRESHOLD })] })
      ),
      assignedRooms: [room()],
      now: NOW,
    });
    expect(c).toBe("unhealthy");
  });

  it("一部の部屋だけstuckならhealthy(全部stuckのときだけunhealthy)", () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: okProbe(
        0,
        payload({
          listeners: [
            listener({ roomId: "room-a", watchdogTriggerCount: WATCHDOG_TRIGGER_DEAD_THRESHOLD }),
            listener({ roomId: "room-b", tiktokId: "bob", watchdogTriggerCount: 0 }),
          ],
        })
      ),
      assignedRooms: [room(), room({ roomId: "room-b", tiktokId: "bob" })],
      now: NOW,
    });
    expect(c).toBe("healthy");
  });

  it("listenerが存在しない(起動すらできていない)部屋はstuck扱いにする", () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: okProbe(0, payload({ listeners: [] })),
      assignedRooms: [room()],
      now: NOW,
    });
    expect(c).toBe("unhealthy");
  });

  it("配信者オフラインでretryingが続くだけの正常状態はhealthy(statusは判定材料にしない)", () => {
    const c = classifyWorkerHealth({
      workerCount: 1,
      urlCount: 1,
      probe: okProbe(0, payload({ listeners: [listener({ status: "retrying", watchdogTriggerCount: 0 })] })),
      assignedRooms: [room()],
      now: NOW,
    });
    expect(c).toBe("healthy");
  });
});

describe("updateHealthStreaks", () => {
  const REQUIRED = 6;

  it("単発の不健全では死亡確定しない", () => {
    const { streaks, deadWorkers } = updateHealthStreaks(
      new Map(),
      new Map<number, HealthClassification>([[0, "unhealthy"]]),
      REQUIRED
    );
    expect(deadWorkers).toEqual([]);
    expect(streaks.get(0)).toBe(1);
  });

  it(`連続${REQUIRED - 1}回では死亡確定せず、${REQUIRED}回目で確定する`, () => {
    let streaks = new Map<number, number>();
    let deadWorkers: number[] = [];
    for (let i = 0; i < REQUIRED - 1; i++) {
      const result = updateHealthStreaks(streaks, new Map([[0, "unhealthy"]]), REQUIRED);
      streaks = result.streaks;
      deadWorkers = result.deadWorkers;
    }
    expect(deadWorkers).toEqual([]);
    expect(streaks.get(0)).toBe(REQUIRED - 1);

    const last = updateHealthStreaks(streaks, new Map([[0, "unhealthy"]]), REQUIRED);
    expect(last.deadWorkers).toEqual([0]);
  });

  it("死亡確定後も不健全が続く場合、2回目以降は再度dead判定を積まない", () => {
    let streaks = new Map<number, number>([[0, REQUIRED]]);
    const result = updateHealthStreaks(streaks, new Map([[0, "unhealthy"]]), REQUIRED);
    expect(result.deadWorkers).toEqual([]);
    expect(result.streaks.get(0)).toBe(REQUIRED + 1);
  });

  it("健全になればstreakは0にリセットされる", () => {
    const { streaks } = updateHealthStreaks(new Map([[0, 3]]), new Map([[0, "healthy"]]), REQUIRED);
    expect(streaks.get(0)).toBe(0);
  });

  it("健全からさらに健全ならrecoveredに含めない", () => {
    const { recovered } = updateHealthStreaks(new Map([[0, 0]]), new Map([[0, "healthy"]]), REQUIRED);
    expect(recovered).toEqual([]);
  });

  it("不健全からの回復はrecoveredに含める", () => {
    const { recovered, streaks } = updateHealthStreaks(new Map([[0, 4]]), new Map([[0, "healthy"]]), REQUIRED);
    expect(recovered).toEqual([0]);
    expect(streaks.get(0)).toBe(0);
  });

  it("判定不能(inconclusive)ではstreakを据え置く", () => {
    const { streaks, deadWorkers, recovered } = updateHealthStreaks(
      new Map([[0, 3]]),
      new Map([[0, "inconclusive"]]),
      REQUIRED
    );
    expect(streaks.get(0)).toBe(3);
    expect(deadWorkers).toEqual([]);
    expect(recovered).toEqual([]);
  });
});

describe("planReassignment", () => {
  it("候補0件なら全部unassignableにし、書き込み対象は空", () => {
    const { assignments, unassignable } = planReassignment({
      rooms: [{ id: "room-a", tiktokId: "alice" }],
      eligibleTargets: [],
      currentLoad: new Map(),
    });
    expect(assignments).toEqual([]);
    expect(unassignable).toEqual([{ roomId: "room-a", tiktokId: "alice" }]);
  });

  it("least-loadedへ割り振る", () => {
    const { assignments } = planReassignment({
      rooms: [{ id: "room-a", tiktokId: "alice" }],
      eligibleTargets: [1, 2],
      currentLoad: new Map([
        [1, 3],
        [2, 0],
      ]),
    });
    expect(assignments).toEqual([{ roomId: "room-a", tiktokId: "alice", toWorker: 2 }]);
  });

  it("同数ならworkerIndexが小さい方を選ぶ(タイブレーク)", () => {
    const { assignments } = planReassignment({
      rooms: [{ id: "room-a", tiktokId: "alice" }],
      eligibleTargets: [2, 1],
      currentLoad: new Map([
        [1, 0],
        [2, 0],
      ]),
    });
    expect(assignments[0].toWorker).toBe(1);
  });

  it("複数部屋を分配し、割り振るたびにloadを増やして偏らせない", () => {
    const { assignments } = planReassignment({
      rooms: [
        { id: "room-a", tiktokId: "alice" },
        { id: "room-b", tiktokId: "bob" },
      ],
      eligibleTargets: [1, 2],
      currentLoad: new Map([
        [1, 0],
        [2, 0],
      ]),
    });
    const targets = assignments.map((a) => a.toWorker).sort();
    expect(targets).toEqual([1, 2]);
  });
});

describe("isGuardianDisabled", () => {
  it('"true"のときだけ無効', () => {
    expect(isGuardianDisabled("true")).toBe(true);
    expect(isGuardianDisabled("false")).toBe(false);
    expect(isGuardianDisabled(null)).toBe(false);
    expect(isGuardianDisabled("")).toBe(false);
  });
});

describe("shouldSkipDueToCooldown", () => {
  it("直近の移送が無ければクールダウンなし", () => {
    expect(shouldSkipDueToCooldown(null, NOW.getTime(), 900_000)).toBe(false);
  });

  it("クールダウン期間内ならtrue", () => {
    const lastMigrationAt = NOW.getTime() - 100_000;
    expect(shouldSkipDueToCooldown(lastMigrationAt, NOW.getTime(), 900_000)).toBe(true);
  });

  it("クールダウン期間を過ぎていればfalse", () => {
    const lastMigrationAt = NOW.getTime() - 1_000_000;
    expect(shouldSkipDueToCooldown(lastMigrationAt, NOW.getTime(), 900_000)).toBe(false);
  });
});

describe("decideBlockedRoomAction", () => {
  const now = NOW.getTime();

  it("未試行のworkerがあれば最小負荷を選ぶ", () => {
    const decision = decideBlockedRoomAction({
      eligibleTargets: [1, 2, 3],
      currentLoad: new Map([
        [1, 5],
        [2, 1],
        [3, 3],
      ]),
      state: undefined,
      now,
    });
    expect(decision).toEqual({ action: "reassign", toWorker: 2 });
  });

  it("再割当直後のガード期間内はskip(振動防止)", () => {
    const decision = decideBlockedRoomAction({
      eligibleTargets: [1, 2],
      currentLoad: new Map([[1, 0], [2, 0]]),
      state: { triedWorkers: new Set([1]), lastReassignedAt: now - 60_000, gaveUpAt: null },
      now,
    });
    expect(decision).toEqual({ action: "skip" });
  });

  it("ガード期間経過後は未試行のworkerへ再割当する", () => {
    const decision = decideBlockedRoomAction({
      eligibleTargets: [1, 2],
      currentLoad: new Map([[1, 0], [2, 0]]),
      state: { triedWorkers: new Set([1]), lastReassignedAt: now - BLOCKED_REASSIGN_GUARD_MS - 1, gaveUpAt: null },
      now,
    });
    expect(decision).toEqual({ action: "reassign", toWorker: 2 });
  });

  it("全healthy workerを試し終えたらgive_up", () => {
    const decision = decideBlockedRoomAction({
      eligibleTargets: [1, 2],
      currentLoad: new Map([[1, 0], [2, 0]]),
      state: { triedWorkers: new Set([1, 2]), lastReassignedAt: now - BLOCKED_REASSIGN_GUARD_MS - 1, gaveUpAt: null },
      now,
    });
    expect(decision).toEqual({ action: "give_up" });
  });

  it("healthy worker自体が0件ならskip(この部屋固有の問題ではない)", () => {
    const decision = decideBlockedRoomAction({
      eligibleTargets: [],
      currentLoad: new Map(),
      state: undefined,
      now,
    });
    expect(decision).toEqual({ action: "skip" });
  });

  it("gaveUpAtが立っている部屋はガード期間・未試行workerの有無に関わらず永久にskip", () => {
    // 実装後レビューHIGH指摘: AgencyWatch/イベントmonitorUntilが有効な部屋は
    // monitoringSuspended:trueが接続を止めないため、give_up後も403が続き閾値へ
    // 再到達しうる。gaveUpAtが残っている限りは未試行workerが復活していても
    // 再割当を再開しない(無限の再割当ループを防ぐ)。
    const decision = decideBlockedRoomAction({
      eligibleTargets: [1, 2, 3],
      currentLoad: new Map([[1, 0], [2, 0], [3, 0]]),
      state: { triedWorkers: new Set(), lastReassignedAt: now - BLOCKED_REASSIGN_GUARD_MS - 1, gaveUpAt: now - 1_000 },
      now,
    });
    expect(decision).toEqual({ action: "skip" });
  });
});
