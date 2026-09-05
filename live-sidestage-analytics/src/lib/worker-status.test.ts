import { describe, it, expect, vi } from "vitest";
import {
  buildWorkerReport,
  parseWorkerInternalUrls,
  probeWorkers,
  type AssignedRoom,
  type WorkerProbe,
  type WorkerStatusPayload,
} from "./worker-status";
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
    weeklyEulerSignUsageCount: null,
    monitoringSuspended: false,
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

function okProbe(workerIndex: number, p: WorkerStatusPayload): WorkerProbe {
  return { workerIndex, url: `http://w${workerIndex}:8080`, ok: true, payload: p };
}

function report(input: Partial<Parameters<typeof buildWorkerReport>[0]> = {}) {
  return buildWorkerReport({
    workerCount: 1,
    urls: ["http://w0:8080"],
    probes: [okProbe(0, payload())],
    rooms: [room()],
    dbError: null,
    now: NOW,
    ...input,
  });
}

function issueTypes(r: ReturnType<typeof buildWorkerReport>): string[] {
  return r.issues.map((i) => i.type);
}

describe("parseWorkerInternalUrls", () => {
  it("JSON配列をパースする", () => {
    expect(parseWorkerInternalUrls('["http://a:8080","http://b:8080"]')).toEqual([
      "http://a:8080",
      "http://b:8080",
    ]);
  });

  it("末尾のスラッシュを落として /status を素直に繋げられるようにする", () => {
    expect(parseWorkerInternalUrls('["http://a:8080/"]')).toEqual(["http://a:8080"]);
  });

  it("未設定・壊れたJSON・配列でない値は空配列にする(管理画面ごと落とさない)", () => {
    expect(parseWorkerInternalUrls(undefined)).toEqual([]);
    expect(parseWorkerInternalUrls("")).toEqual([]);
    expect(parseWorkerInternalUrls("not json")).toEqual([]);
    expect(parseWorkerInternalUrls('{"a":1}')).toEqual([]);
  });

  it("文字列でない要素と空文字は捨てる", () => {
    expect(parseWorkerInternalUrls('["http://a:8080",1,null,""]')).toEqual(["http://a:8080"]);
  });
});

describe("probeWorkers", () => {
  it("正常応答をpayloadとして返す", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload()), { status: 200 }));
    const probes = await probeWorkers(["http://w0:8080"], "secret", 1000, fetchImpl as never);
    expect(probes[0].ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://w0:8080/status",
      expect.objectContaining({ headers: { "x-internal-secret": "secret" } })
    );
  });

  it("HTTPエラーをerrorとして返す", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const probes = await probeWorkers(["http://w0:8080"], "secret", 1000, fetchImpl as never);
    expect(probes[0]).toMatchObject({ ok: false, error: "HTTP 401" });
  });

  it("例外(接続不可・タイムアウト)をerrorとして返す", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const probes = await probeWorkers(["http://w0:8080"], "secret", 1000, fetchImpl as never);
    expect(probes[0]).toMatchObject({ ok: false, error: "ECONNREFUSED" });
  });

  it("1台の失敗が他台の結果をブロックしない", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith("http://w0")) throw new Error("down");
      return new Response(JSON.stringify(payload({ workerIndex: 1 })), { status: 200 });
    });
    const probes = await probeWorkers(
      ["http://w0:8080", "http://w1:8080"],
      "secret",
      1000,
      fetchImpl as never
    );
    expect(probes[0].ok).toBe(false);
    expect(probes[1].ok).toBe(true);
  });

  it("INTERNAL_API_SECRETが無ければ叩かずにerrorにする", async () => {
    const fetchImpl = vi.fn();
    const probes = await probeWorkers(["http://w0:8080"], undefined, 1000, fetchImpl as never);
    expect(probes[0].ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("buildWorkerReport", () => {
  it("全て正常なら issue を出さない", () => {
    expect(report().issues).toEqual([]);
  });

  it("Web の WORKER_COUNT が不正なら invalid_worker_count", () => {
    expect(issueTypes(report({ workerCount: null }))).toContain("invalid_worker_count");
    expect(issueTypes(report({ workerCount: 0 }))).toContain("invalid_worker_count");
  });

  it("URL の件数が WORKER_COUNT と違えば worker_url_count_mismatch", () => {
    const r = report({ workerCount: 3, urls: ["http://w0:8080"] });
    expect(issueTypes(r)).toContain("worker_url_count_mismatch");
  });

  it("応答しない Worker を worker_unreachable として報告し、DB上の担当は残す", () => {
    const r = report({
      probes: [{ workerIndex: 0, url: "http://w0:8080", ok: false, error: "ECONNREFUSED" }],
    });
    expect(issueTypes(r)).toContain("worker_unreachable");
    expect(r.workers[0].reachable).toBe(false);
    // DBが読めている限り、担当予定の部屋は表示できる
    expect(r.workers[0].assignedRooms).toHaveLength(1);
  });

  it("URL が無い index も枠として出し、応答なし扱いにする", () => {
    const r = report({ workerCount: 2, urls: ["http://w0:8080"], rooms: [] });
    expect(r.workers).toHaveLength(2);
    expect(r.workers[1].reachable).toBe(false);
    expect(r.workers[1].url).toBeNull();
  });

  it("unready の Worker を worker_unready として報告する", () => {
    const r = report({ probes: [okProbe(0, payload({ ready: false }))] });
    expect(issueTypes(r)).toContain("worker_unready");
  });

  it("Worker 側の WORKER_COUNT が Web と食い違えば worker_count_mismatch", () => {
    const r = report({ probes: [okProbe(0, payload({ workerCount: 3 }))] });
    expect(issueTypes(r)).toContain("worker_count_mismatch");
  });

  it("URL の順序と WORKER_INDEX がずれていれば worker_index_mismatch", () => {
    const r = report({ probes: [okProbe(0, payload({ workerIndex: 2 }))] });
    expect(issueTypes(r)).toContain("worker_index_mismatch");
  });

  it("reconcile が未完了なら warn、閾値を超えて古ければ error", () => {
    const never = report({ probes: [okProbe(0, payload({ lastReconcile: null }))] });
    expect(never.issues.find((i) => i.type === "reconcile_stale")?.severity).toBe("warn");

    const stale = report({
      probes: [
        okProbe(
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
      ],
    });
    expect(stale.issues.find((i) => i.type === "reconcile_stale")?.severity).toBe("error");
  });

  it("180秒ちょうどはまだ stale にしない(境界)", () => {
    const r = report({
      probes: [
        okProbe(
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
      ],
    });
    expect(issueTypes(r)).not.toContain("reconcile_stale");
  });

  it("reconcile が失敗し続けている場合は reconcile_failing(時刻は新しいので stale にはならない)", () => {
    const r = report({
      probes: [
        okProbe(
          0,
          payload({
            lastReconcile: {
              at: new Date(NOW.getTime() - 5_000).toISOString(),
              durationMs: 10,
              roomCount: null,
              startFailures: null,
              error: "connection pool timeout",
            },
          })
        ),
      ],
    });
    expect(issueTypes(r)).toContain("reconcile_failing");
    expect(issueTypes(r)).not.toContain("reconcile_stale");
  });

  it("起動できていない部屋があれば start_failures", () => {
    const r = report({
      probes: [
        okProbe(
          0,
          payload({
            lastReconcile: {
              at: new Date(NOW.getTime() - 5_000).toISOString(),
              durationMs: 10,
              roomCount: 2,
              startFailures: 1,
              error: null,
            },
          })
        ),
      ],
    });
    expect(issueTypes(r)).toContain("start_failures");
  });

  it("DB上の担当なのに listener が無ければ assigned_not_running", () => {
    const r = report({ probes: [okProbe(0, payload({ listeners: [] }))] });
    expect(issueTypes(r)).toContain("assigned_not_running");
  });

  it("担当外の listener が動いていれば running_not_assigned", () => {
    const r = report({
      probes: [okProbe(0, payload({ listeners: [listener({ roomId: "room-x", tiktokId: "x" })] }))],
      rooms: [],
    });
    expect(issueTypes(r)).toContain("running_not_assigned");
  });

  it("DBが読めなかったときは突き合わせをせず、Workerの応答だけ返す", () => {
    const r = report({
      probes: [okProbe(0, payload({ listeners: [listener({ roomId: "room-x" })] }))],
      rooms: [],
      dbError: "connection refused",
    });
    expect(issueTypes(r)).not.toContain("running_not_assigned");
    expect(issueTypes(r)).not.toContain("assigned_not_running");
    expect(r.dbError).toBe("connection refused");
    expect(r.workers[0].listeners).toHaveLength(1);
  });

  it("WORKER_COUNT の範囲外に割り当てられた部屋は room_out_of_range", () => {
    const r = report({
      workerCount: 1,
      rooms: [room(), room({ roomId: "room-b", tiktokId: "bob", workerId: 5 })],
    });
    expect(issueTypes(r)).toContain("room_out_of_range");
    expect(r.outOfRangeRooms).toHaveLength(1);
  });

  it("workerId 未割当の部屋は room_unassigned(warn)として別枠で返す", () => {
    const r = report({
      rooms: [room(), room({ roomId: "room-b", tiktokId: "bob", workerId: null })],
    });
    expect(r.issues.find((i) => i.type === "room_unassigned")?.severity).toBe("warn");
    expect(r.unassignedRooms).toHaveLength(1);
  });

  it("connected でない listener は listener_not_connected(warn)", () => {
    const r = report({
      probes: [okProbe(0, payload({ listeners: [listener({ status: "retrying" })] }))],
    });
    const issue = r.issues.find((i) => i.type === "listener_not_connected");
    expect(issue?.severity).toBe("warn");
    expect(issue?.tiktokId).toBe("alice");
  });

  it("縮退後に残った範囲外 index の Worker が応答しても枠として表示する", () => {
    const r = report({
      workerCount: 1,
      urls: ["http://w0:8080"],
      probes: [okProbe(0, payload()), okProbe(1, payload({ workerIndex: 1, workerCount: 2 }))],
    });
    expect(r.workers.map((w) => w.workerIndex)).toEqual([0, 1]);
  });

  it("担当部屋を workerId ごとに振り分ける", () => {
    const r = report({
      workerCount: 2,
      urls: ["http://w0:8080", "http://w1:8080"],
      probes: [
        okProbe(0, payload({ workerCount: 2 })),
        okProbe(
          1,
          payload({
            workerIndex: 1,
            workerCount: 2,
            listeners: [listener({ roomId: "room-b", tiktokId: "bob" })],
          })
        ),
      ],
      rooms: [room(), room({ roomId: "room-b", tiktokId: "bob", workerId: 1 })],
    });
    expect(r.workers[0].assignedRooms.map((x) => x.tiktokId)).toEqual(["alice"]);
    expect(r.workers[1].assignedRooms.map((x) => x.tiktokId)).toEqual(["bob"]);
    expect(r.issues).toEqual([]);
  });
});
