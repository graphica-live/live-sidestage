// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// isReportedOfflineByApiLive()(api-live/user/room/によるEuler署名消費前オフライン事前チェック)を検証する。
// tiktok-live-connectorのWebcastPushConnectionをモックし、実際のTikTok接続は行わない。
//
// 他のintegrationテスト(tiktok-listener.watchdog.integration.test.ts等)が共有するMockConnectionには
// webClientが実装されていないため、そちらではこの事前チェックが常にcatch分岐(フェイルセーフでfalse)
// にしか到達しない。本ファイルはwebClient.fetchRoomInfoFromApiLiveを制御可能なMockConnectionを
// 専用に持ち、Euler署名消費の核心である「status=4ならconn.connect()を一切呼ばない」を直接検証する。
import { describe, it, expect, afterAll, afterEach, vi, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { startListener, stopListener, checkWatchdogs } from "./tiktok-listener";
import { resolveRoomForStreamer } from "./tiktok-room";

const { MockConnection } = vi.hoisted(() => {
  class MockConnection {
    static instances: MockConnection[] = [];
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};
    clientParams: Record<string, string> = {};
    connectCalls = 0;
    disconnectCalls = 0;
    webClient = {
      fetchRoomInfoFromApiLive: vi.fn().mockResolvedValue({ data: { liveRoom: { status: 2 } } }),
    };
    constructor(
      public uniqueId: string,
      public options: unknown
    ) {
      MockConnection.instances.push(this);
    }
    on(event: string, handler: (payload?: unknown) => void) {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }
    removeAllListeners() {
      this.handlers = {};
    }
    async connect() {
      this.connectCalls++;
    }
    disconnect() {
      this.disconnectCalls++;
    }
    fire(event: string, payload?: unknown) {
      for (const h of this.handlers[event] ?? []) h(payload);
    }
  }
  return { MockConnection };
});

vi.mock("TLC-sidestage", () => ({
  WebcastPushConnection: vi.fn().mockImplementation(function (uniqueId: string, options: unknown) {
    return new MockConnection(uniqueId, options);
  }),
}));

const emitOverlaySnapshotMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./overlay", () => ({
  emitOverlaySnapshot: emitOverlaySnapshotMock,
  emitGiftDrivenOverlayUpdates: emitOverlaySnapshotMock,
}));

async function createStreamer(tiktokId: string, emailPrefix: string) {
  const user = await prisma.user.create({
    data: { email: `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@local.test` },
  });
  return prisma.streamer.create({
    data: { userId: user.id, tiktokId, verificationCode: "x", verified: true },
  });
}

async function cleanupStreamer(streamerId: string) {
  const streamer = await prisma.streamer.findUnique({ where: { id: streamerId } });
  if (streamer) await prisma.user.delete({ where: { id: streamer.userId } });
}

async function cleanupRoom(roomId: string) {
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {});
}

async function getListenerReason(roomId: string): Promise<string | null> {
  const room = await prisma.tiktokRoom.findUnique({ where: { id: roomId } });
  return room?.listenerReason ?? null;
}

beforeEach(async () => {
  MockConnection.instances.length = 0;
  emitOverlaySnapshotMock.mockClear();
  // 各テストがWebcastPushConnectionのmockImplementationを個別に差し替えるため、
  // 前のテストの上書き(例: status:4固定)がテスト間で残らないよう既定実装へ戻す。
  const { WebcastPushConnection } = await import("TLC-sidestage");
  (WebcastPushConnection as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }).mockImplementation(
    function (uniqueId: unknown, options: unknown) {
      return new MockConnection(uniqueId as string, options);
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("isReportedOfflineByApiLive()によるEuler署名消費前のオフライン事前チェック", () => {
  it("TC-TLC-001: api-live/user/room/がstatus=4を返すとき、conn.connect()を呼ばずuser_offline経路へ倒れる", async () => {
    const tiktokId = `itest_offline_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-offline-a");
    const roomId = await resolveRoomForStreamer(a.id);

    // startListener()内でconnectInstance()経由でMockConnectionが生成された直後にstatus:4を返すよう
    // モックの戻り値を差し替える必要があるため、コンストラクタ内で即座に上書きできるよう
    // WebcastPushConnectionのモック実装側でstatus:4固定にする。
    const { WebcastPushConnection } = await import("TLC-sidestage");
    (WebcastPushConnection as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }).mockImplementation(
      function (uniqueId: unknown, options: unknown) {
        const conn = new MockConnection(uniqueId as string, options);
        conn.webClient.fetchRoomInfoFromApiLive.mockResolvedValue({ data: { liveRoom: { status: 4 } } });
        return conn;
      }
    );

    await startListener(roomId, tiktokId, [a.id]);

    expect(MockConnection.instances).toHaveLength(1);
    expect(MockConnection.instances[0].connectCalls).toBe(0);
    expect(await getListenerReason(roomId)).toBe("user_offline");

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });

  it("TC-TLC-002: api-live/user/room/がstatus!=4(オンライン)を返すとき、通常どおりconn.connect()を呼ぶ", async () => {
    const tiktokId = `itest_online_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-online-a");
    const roomId = await resolveRoomForStreamer(a.id);

    // beforeEachではデフォルトのWebcastPushConnectionモック実装(status:2固定)のまま使う。
    await startListener(roomId, tiktokId, [a.id]);

    expect(MockConnection.instances).toHaveLength(1);
    expect(MockConnection.instances[0].connectCalls).toBe(1);

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });

  it("TC-TLC-002b: liveRoomフィールド自体が欠損する応答でも、判定不能としてconn.connect()を呼ぶ", async () => {
    const tiktokId = `itest_missing_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-missing-a");
    const roomId = await resolveRoomForStreamer(a.id);

    const { WebcastPushConnection } = await import("TLC-sidestage");
    (WebcastPushConnection as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }).mockImplementation(
      function (uniqueId: unknown, options: unknown) {
        const conn = new MockConnection(uniqueId as string, options);
        conn.webClient.fetchRoomInfoFromApiLive.mockResolvedValue({ data: {} });
        return conn;
      }
    );

    await startListener(roomId, tiktokId, [a.id]);

    expect(MockConnection.instances).toHaveLength(1);
    expect(MockConnection.instances[0].connectCalls).toBe(1);

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });

  it("TC-TLC-003: api-live/user/room/が例外を投げたとき、console.warnを出しつつオンライン扱いへフェイルセーフしconn.connect()を呼ぶ", async () => {
    const tiktokId = `itest_error_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-error-a");
    const roomId = await resolveRoomForStreamer(a.id);

    const { WebcastPushConnection } = await import("TLC-sidestage");
    (WebcastPushConnection as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }).mockImplementation(
      function (uniqueId: unknown, options: unknown) {
        const conn = new MockConnection(uniqueId as string, options);
        conn.webClient.fetchRoomInfoFromApiLive.mockRejectedValue(new Error("network error"));
        return conn;
      }
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await startListener(roomId, tiktokId, [a.id]);

    expect(MockConnection.instances).toHaveLength(1);
    expect(MockConnection.instances[0].connectCalls).toBe(1);
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes("api-live/user/room/ pre-check failed"))
    ).toBe(true);
    warnSpy.mockRestore();

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });

  it("TC-TLC-004: 事前チェックのHTTP待機中にstopListener()が呼ばれたら、待機完了後もconn.connect()を呼ばない", async () => {
    const tiktokId = `itest_stop_race_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-stop-race-a");
    const roomId = await resolveRoomForStreamer(a.id);

    let resolveOffline: ((v: unknown) => void) | undefined;
    const pending = new Promise((resolve) => {
      resolveOffline = resolve;
    });

    const { WebcastPushConnection } = await import("TLC-sidestage");
    (WebcastPushConnection as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }).mockImplementation(
      function (uniqueId: unknown, options: unknown) {
        const conn = new MockConnection(uniqueId as string, options);
        conn.webClient.fetchRoomInfoFromApiLive.mockReturnValue(pending);
        return conn;
      }
    );

    const startPromise = startListener(roomId, tiktokId, [a.id]);

    // MockConnectionが生成されisReportedOfflineByApiLiveの呼び出しが始まるまで待つ。
    // 固定時間のsetTimeoutは他ファイルとの並列実行によるCPU負荷でタイミングがずれ、
    // 生成前にstopListener()を呼んでしまう不安定要因になるため、ポーリングで待つ。
    await vi.waitFor(() => {
      expect(MockConnection.instances).toHaveLength(1);
    });

    await stopListener(roomId);

    // stopListener()完了後にHTTP応答(status:4、オフライン)が返る。
    resolveOffline?.({ data: { liveRoom: { status: 4 } } });
    await startPromise;

    expect(MockConnection.instances[0].connectCalls).toBe(0);

    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });

  it("TC-TLC-009: watchdog強制再接続がゾンビroomを掴んだ場合も、事前チェックがconn.connect()を止める", async () => {
    const tiktokId = `itest_wd_offline_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-wd-offline-a");
    const roomId = await resolveRoomForStreamer(a.id);

    // 初回接続はオンライン扱い(既定実装)で成功させる。
    await startListener(roomId, tiktokId, [a.id]);
    expect(MockConnection.instances).toHaveLength(1);
    expect(MockConnection.instances[0].connectCalls).toBe(1);

    // 無応答検知の閾値(60秒)を超過させ、watchdogが強制再接続する時点からは
    // api-live/user/room/がstatus:4(オフライン)を返すゾンビ状態をシミュレートする。
    const { WebcastPushConnection } = await import("TLC-sidestage");
    (WebcastPushConnection as unknown as { mockImplementation: (fn: (...a: unknown[]) => unknown) => void }).mockImplementation(
      function (uniqueId: unknown, options: unknown) {
        const conn = new MockConnection(uniqueId as string, options);
        conn.webClient.fetchRoomInfoFromApiLive.mockResolvedValue({ data: { liveRoom: { status: 4 } } });
        return conn;
      }
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000 + 1_000);
    checkWatchdogs();
    vi.useRealTimers();

    await vi.waitFor(() => {
      expect(MockConnection.instances).toHaveLength(2);
    });

    // watchdogが生成した2つ目のMockConnectionはオフライン事前チェックで止まり、connect()を呼ばない。
    expect(MockConnection.instances[1].connectCalls).toBe(0);
    expect(await getListenerReason(roomId)).toBe("user_offline");

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });
});
