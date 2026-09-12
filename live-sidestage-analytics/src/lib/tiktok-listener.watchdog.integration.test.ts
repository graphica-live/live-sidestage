// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// checkWatchdogs()の無応答検知バックオフ(watchdogTriggerCount/watchdogBackoffUntil)を検証する。
// tiktok-live-connectorのWebcastPushConnectionをモックし、実際のTikTok接続は行わない。
import { describe, it, expect, afterAll, afterEach, vi, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { makeTiktokUid } from "./__fixtures__/gift";
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
    // ハンドル → tiktokUid の導出。テストファイル側で makeTiktokUid を代入する
    // (vi.hoisted の中では import できないため)。
    static uidFor: (tiktokHandle: string) => string = () => "0";
    // 接続前の hostTiktokUid 照合(precheckApiLive)が読む。既定は「オンライン かつ
    // room の hostTiktokUid と一致する配信者」。
    webClient = {
      fetchRoomInfoFromApiLive: vi.fn(async () => ({
        // createConnection() は `@` 付きで渡してくるので、uid 導出前に剥がす。
        data: {
          liveRoom: { status: 2 },
          user: { id: MockConnection.uidFor(this.tiktokHandle.replace(/^@/, "")) },
        },
      })),
    };
    constructor(
      public tiktokHandle: string,
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

MockConnection.uidFor = makeTiktokUid;

vi.mock("TLC-sidestage", () => ({
  WebcastPushConnection: vi.fn().mockImplementation(function (tiktokHandle: string, options: unknown) {
    return new MockConnection(tiktokHandle, options);
  }),
}));

vi.mock("./tiktok-existence", () => ({
  existenceChecker: {
    check: vi.fn().mockResolvedValue({ verdict: "UNVERIFIED", nickname: null, tiktokUid: null }),
  },
}));

const emitOverlaySnapshotMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./overlay", () => ({
  emitOverlaySnapshot: emitOverlaySnapshotMock,
  emitGiftDrivenOverlayUpdates: emitOverlaySnapshotMock,
}));

// 無応答検知の閾値(WATCHDOG_SILENCE_MS = 60_000)より確実に大きい経過時間。
const SILENCE_MS = 60_000;

async function createStreamer(tiktokHandle: string, emailPrefix: string) {
  const user = await prisma.principal.create({
    data: { email: `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@local.test` },
  });
  return prisma.streamer.create({
    data: {
      principalId: user.id,
      // room の同一性は uid。ハンドルから決定的に導いて「同じハンドル = 同じ配信者」を保つ。
      tiktokUid: makeTiktokUid(tiktokHandle),
      tiktokHandle,
      verificationCode: "x",
      verified: true,
    },
  });
}

async function cleanupStreamer(streamerId: string) {
  const streamer = await prisma.streamer.findUnique({ where: { id: streamerId } });
  if (streamer) await prisma.principal.delete({ where: { id: streamer.principalId } });
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
    const tiktokHandle = `itest_wd_first_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-wd-first-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
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
    const tiktokHandle = `itest_wd_backoff_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-wd-backoff-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
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
    const tiktokHandle = `itest_wd_reset_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-wd-reset-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
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

  it("chat保存ハンドラ経由の受信でもバックオフが即リセットされる", async () => {
    const tiktokHandle = `itest_wd_reset_chat_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-wd-reset-chat-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
    const start = Date.now();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start + SILENCE_MS + 1_000);
    checkWatchdogs();
    vi.useRealTimers();
    await vi.waitFor(() => {
      expect(MockConnection.instances).toHaveLength(2);
    });

    // 専用 conn.on("chat", markAlive) は廃止。保存ハンドラ先頭の markAlive() が効くこと。
    // userId 欠落でも markAlive は dedup/保存より前に走る。
    const conn = MockConnection.instances[1];
    conn.fire("chat", {});

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

  it("websocketData/msgDetectだけでは生存更新せずwatchdogが発動する", async () => {
    const tiktokHandle = `itest_wd_transport_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-wd-transport-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
    const start = Date.now();
    const conn = MockConnection.instances[0];

    // 無応答窓の後半で輸送フレームだけ飛ばす。markAliveしていれば t=61s で silentFor<60s になり発火しない。
    // Date だけ fake のまま fire する（useRealTimers すると lastEventAt が壁時計になり判定が壊れる）。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start + 50_000);
    conn.fire("websocketData", {});
    conn.fire("msgDetect", {});
    vi.setSystemTime(start + SILENCE_MS + 1_000);
    checkWatchdogs();
    vi.useRealTimers();
    await vi.waitFor(() => {
      expect(MockConnection.instances).toHaveLength(2);
    });

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });
});
