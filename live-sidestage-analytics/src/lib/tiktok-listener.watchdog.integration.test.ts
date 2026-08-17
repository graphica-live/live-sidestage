// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// checkWatchdogs()の無応答検知バックオフ(watchdogTriggerCount/watchdogBackoffUntil)を検証する。
// tiktok-live-connectorのWebcastPushConnectionをモックし、実際のTikTok接続は行わない。
import { describe, it, expect, afterAll, afterEach, vi, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { startListener, stopListener, checkWatchdogs } from "./tiktok-listener";
import { resolveRoomForStreamer } from "./tiktok-room";

// vi.mockのfactoryはファイル先頭へホイストされるため、参照するオブジェクトは
// vi.hoisted()で明示的にホイストしておく必要がある。
const { MockConnection } = vi.hoisted(() => {
  class MockConnection {
    static instances: MockConnection[] = [];
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};
    clientParams: Record<string, string> = {};
    connectCalls = 0;
    disconnectCalls = 0;
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
    // テストからTikTok側イベントの発火をシミュレートするためのヘルパー(モック専用API)。
    fire(event: string, payload?: unknown) {
      for (const h of this.handlers[event] ?? []) h(payload);
    }
  }
  return { MockConnection };
});

vi.mock("tiktok-live-connector", () => ({
  WebcastPushConnection: vi.fn().mockImplementation(function (uniqueId: string, options: unknown) {
    return new MockConnection(uniqueId, options);
  }),
}));

const emitOverlaySnapshotMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./overlay", () => ({ emitOverlaySnapshot: emitOverlaySnapshotMock }));

// 無応答検知の閾値(WATCHDOG_SILENCE_MS = 60_000)より確実に大きい経過時間。
const SILENCE_MS = 60_000;

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

beforeEach(() => {
  MockConnection.instances.length = 0;
  emitOverlaySnapshotMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("checkWatchdogs()の無応答検知バックオフ", () => {
  it("初回のwatchdog強制再接続は即座に発火する", async () => {
    const tiktokId = `itest_wd_first_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-wd-first-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokId, [a.id]);
    expect(MockConnection.instances).toHaveLength(1);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + SILENCE_MS + 1_000);
    checkWatchdogs();
    vi.useRealTimers();

    await vi.waitFor(() => {
      expect(MockConnection.instances).toHaveLength(2);
    });

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });

  it("実イベントが来ないまま無応答検知・発動が連続すると、次の強制再接続までの間隔が指数的に伸びる", async () => {
    const tiktokId = `itest_wd_backoff_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-wd-backoff-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokId, [a.id]);
    const start = Date.now();

    // 1回目の発動: SILENCE_MS超過直後 → instances 1→2
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start + SILENCE_MS + 1_000);
    checkWatchdogs();
    vi.useRealTimers();
    await vi.waitFor(() => {
      expect(MockConnection.instances).toHaveLength(2);
    });

    // 発動直後(バックオフ10秒以内)は再発動しない
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start + SILENCE_MS + 1_000 + 5_000);
    checkWatchdogs();
    vi.useRealTimers();
    expect(MockConnection.instances).toHaveLength(2);
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes("skipping forced reconnect"))
    ).toBe(true);
    warnSpy.mockRestore();

    // 10秒バックオフを超えた時刻では2回目の発動が起きる → instances 2→3
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start + SILENCE_MS + 1_000 + 10_001);
    checkWatchdogs();
    vi.useRealTimers();
    await vi.waitFor(() => {
      expect(MockConnection.instances).toHaveLength(3);
    });

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });

  it("実イベントを受信するとバックオフが即リセットされる", async () => {
    const tiktokId = `itest_wd_reset_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-wd-reset-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokId, [a.id]);
    const start = Date.now();

    // 1回目の発動でwatchdogTriggerCountを1にする → instances 1→2
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start + SILENCE_MS + 1_000);
    checkWatchdogs();
    vi.useRealTimers();
    await vi.waitFor(() => {
      expect(MockConnection.instances).toHaveLength(2);
    });

    // 実イベント(like)受信 → markAlive()でリセットされるはず
    const conn = MockConnection.instances[1];
    conn.fire("like", {});

    // バックオフがリセットされていなければ、次の10秒はまだskipされるはずの時刻。
    // リセットされていれば、SILENCE_MS超過分だけ進めた時点で即座に再発動する。
    const now2 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now2 + SILENCE_MS + 1_000);
    checkWatchdogs();
    vi.useRealTimers();

    await vi.waitFor(() => {
      expect(MockConnection.instances).toHaveLength(3);
    });

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });
});
