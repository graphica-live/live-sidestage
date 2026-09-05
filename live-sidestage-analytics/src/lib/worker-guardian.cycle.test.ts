// unit test(DB不要)。runGuardianCycle()の403フェイルオーバー分岐を、prisma/worker-statusを
// モックして直接検証する。実DBのadvisory lock競合・複数インスタンス同時実行そのものは
// 対象にできないが、検証したいのはPostgresのロック意味論ではなく「migrateBlockedRoom/
// giveUpBlockedRoomが失敗を返したときにruntGuardianCycleがstateをどう更新するか」という
// 呼び出し側の分岐ロジックなので、この形で十分に固定できる(test-autoテストケースレビュー
// でfable-expertが指摘、TC-22〜TC-24に対応)。
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AssignedRoom, WorkerProbe } from "./worker-status";

vi.mock("./settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

const queryRawMock = vi.fn();
const updateManyMock = vi.fn();
const findUniqueMock = vi.fn().mockResolvedValue(null);
const upsertMock = vi.fn().mockResolvedValue(undefined);

vi.mock("./prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: queryRawMock,
        tiktokRoom: { updateMany: updateManyMock },
        appSetting: { findUnique: findUniqueMock, upsert: upsertMock },
      })
    ),
  },
}));

const fetchAssignedRoomsMock = vi.fn();
const probeWorkersMock = vi.fn();

vi.mock("./worker-status", async () => {
  const actual = await vi.importActual<typeof import("./worker-status")>("./worker-status");
  return {
    ...actual,
    fetchAssignedRooms: fetchAssignedRoomsMock,
    probeWorkers: probeWorkersMock,
  };
});

const { getSetting } = await import("./settings");
const {
  runGuardianCycle,
  createInitialState,
  BLOCKED_REASSIGN_THRESHOLD,
  BLOCKED_REASSIGN_GUARD_MS,
} = await import("./worker-guardian");

function room(overrides: Partial<AssignedRoom> = {}): AssignedRoom {
  return {
    roomId: "room-1",
    tiktokId: "tiktok-1",
    workerId: 0,
    listenerStatus: "retrying",
    listenerMessage: null,
    listenerUpdatedAt: null,
    streamerCount: 1,
    watchCount: 0,
    eventMonitored: false,
    consecutiveBlockedCount: BLOCKED_REASSIGN_THRESHOLD,
    weeklyEulerSignUsageCount: null,
    monitoringSuspended: false,
    ...overrides,
  };
}

function healthyProbe(workerIndex: number): WorkerProbe {
  return {
    workerIndex,
    url: `http://worker${workerIndex}`,
    ok: true,
    payload: {
      workerIndex,
      workerCount: 3,
      ready: true,
      startedAt: new Date().toISOString(),
      uptimeMs: 100_000,
      reconcileRunning: false,
      lastReconcile: { at: new Date().toISOString(), durationMs: 10, roomCount: 0, startFailures: 0, error: null },
      listeners: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSetting).mockResolvedValue(null);
  queryRawMock.mockResolvedValue([{ locked: true }]);
  updateManyMock.mockResolvedValue({ count: 1 });
  process.env.WORKER_COUNT = "3";
  process.env.WORKER_INTERNAL_URLS = JSON.stringify(["http://worker0", "http://worker1", "http://worker2"]);
  // worker0(ブロック元)は自分の担当部屋の listener 情報を持たずunhealthy寄りになるが、
  // 再割当先の候補ではない(常にroom.workerIdとして除外される)ので結果に影響しない。
  probeWorkersMock.mockResolvedValue([healthyProbe(0), healthyProbe(1), healthyProbe(2)]);
});

describe("runGuardianCycle: 403ブロックフェイルオーバー", () => {
  it("閾値超過の部屋を未試行の最小負荷workerへ再割当し、fromWorkerもtriedWorkersへ加える", async () => {
    fetchAssignedRoomsMock.mockResolvedValue([room()]);

    const result = await runGuardianCycle(createInitialState());

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "room-1", workerId: 0 } })
    );
    const s = result.blockedRoomState.get("room-1");
    expect(s?.triedWorkers.has(0)).toBe(true); // fromWorker自身もtried化(実装後レビューHIGH指摘)
    expect(s?.triedWorkers.has(1) || s?.triedWorkers.has(2)).toBe(true);
    expect(s?.gaveUpAt).toBeNull();
  });

  it("migrateBlockedRoomが失敗(advisory lock競合)したときはstateを更新しない", async () => {
    queryRawMock.mockResolvedValue([{ locked: false }]);
    fetchAssignedRoomsMock.mockResolvedValue([room()]);

    const result = await runGuardianCycle(createInitialState());

    expect(result.blockedRoomState.has("room-1")).toBe(false);
  });

  it("migrateBlockedRoomが失敗(WHERE不一致、既に他所へ移動済み)したときもstateを更新しない", async () => {
    updateManyMock.mockResolvedValue({ count: 0 });
    fetchAssignedRoomsMock.mockResolvedValue([room()]);

    const result = await runGuardianCycle(createInitialState());

    expect(result.blockedRoomState.has("room-1")).toBe(false);
  });

  it("healthy workerを一巡済みの部屋はgive_upし、成功時のみgaveUpAtを立てる", async () => {
    fetchAssignedRoomsMock.mockResolvedValue([room()]);
    const initial = createInitialState();
    initial.blockedRoomState.set("room-1", {
      triedWorkers: new Set([0, 1, 2]),
      lastReassignedAt: Date.now() - BLOCKED_REASSIGN_GUARD_MS - 1,
      gaveUpAt: null,
    });

    const result = await runGuardianCycle(initial);

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "room-1", workerId: 0 },
        data: expect.objectContaining({ monitoringSuspended: true }),
      })
    );
    expect(result.blockedRoomState.get("room-1")?.gaveUpAt).not.toBeNull();
  });

  it("give_up処理がWHERE不一致で失敗したときはgaveUpAtを立てない", async () => {
    updateManyMock.mockResolvedValue({ count: 0 });
    fetchAssignedRoomsMock.mockResolvedValue([room()]);
    const initial = createInitialState();
    initial.blockedRoomState.set("room-1", {
      triedWorkers: new Set([0, 1, 2]),
      lastReassignedAt: Date.now() - BLOCKED_REASSIGN_GUARD_MS - 1,
      gaveUpAt: null,
    });

    const result = await runGuardianCycle(initial);

    expect(result.blockedRoomState.get("room-1")?.gaveUpAt).toBeNull();
  });

  it("gaveUpAt済みの部屋は同じ閾値超過が続いても再割当/give_upを二度と試みない(無限ループ防止)", async () => {
    fetchAssignedRoomsMock.mockResolvedValue([room()]);
    const initial = createInitialState();
    initial.blockedRoomState.set("room-1", {
      triedWorkers: new Set([1, 2]),
      lastReassignedAt: Date.now() - BLOCKED_REASSIGN_GUARD_MS - 1,
      gaveUpAt: Date.now() - 1_000,
    });

    const result = await runGuardianCycle(initial);

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(result.blockedRoomState.get("room-1")?.gaveUpAt).not.toBeNull();
  });

  it("完全に復帰した(connected & count=0)部屋のstateは削除され、新しいepisodeとして再スタートできる", async () => {
    fetchAssignedRoomsMock.mockResolvedValue([
      room({ listenerStatus: "connected", consecutiveBlockedCount: 0 }),
    ]);
    const initial = createInitialState();
    initial.blockedRoomState.set("room-1", {
      triedWorkers: new Set([1, 2]),
      lastReassignedAt: Date.now() - BLOCKED_REASSIGN_GUARD_MS - 1,
      gaveUpAt: Date.now() - 1_000,
    });

    const result = await runGuardianCycle(initial);

    expect(result.blockedRoomState.has("room-1")).toBe(false);
  });

  it("blocked kill switch(workerGuardianBlockedReassignDisabled)有効時は死活監視と独立して403処理だけ止まる", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) =>
      key === "workerGuardianBlockedReassignDisabled" ? "true" : null
    );
    fetchAssignedRoomsMock.mockResolvedValue([room()]);

    await runGuardianCycle(createInitialState());

    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
