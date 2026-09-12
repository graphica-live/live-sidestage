// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// scheduleReconnect()の"disconnected"/"error"(user_offline以外)用の指数バックオフ
// (reconnectFailureCount)と、世代チェックによる多重接続防止を検証する。
// バックオフの数式(delay列・上限・jitter)自体はtiktok-listener.backoff.test.ts(DB不要)で
// 直接検証しているので、ここでは状態遷移(インクリメント/リセット/世代チェック)に絞る。
// tiktok-live-connectorのWebcastPushConnectionをモックし、実際のTikTok接続は行わない。
import { describe, it, expect, afterAll, afterEach, vi, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { makeTiktokUid } from "./__fixtures__/gift";
import { startListener, stopListener, getListenerSnapshots } from "./tiktok-listener";
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
    // createConnection() は `@` 付きで渡してくるので、uid 導出前に剥がす。
    webClient = {
      fetchRoomInfoFromApiLive: vi.fn(async () => ({
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

const emitOverlaySnapshotMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./overlay", () => ({
  emitOverlaySnapshot: emitOverlaySnapshotMock,
  emitGiftDrivenOverlayUpdates: emitOverlaySnapshotMock,
}));

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

function snapshotFor(roomId: string) {
  return getListenerSnapshots().find((s) => s.roomId === roomId);
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

describe("scheduleReconnect()の署名取得後失敗バックオフ", () => {
  it("disconnectedでreconnectFailureCountが1増え、再接続がスケジュールされる", async () => {
    const tiktokHandle = `itest_rb_disc_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-rb-disc-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
    expect(MockConnection.instances).toHaveLength(1);
    expect(snapshotFor(roomId)?.reconnectFailureCount).toBe(0);

    MockConnection.instances[0].fire("disconnected");
    expect(snapshotFor(roomId)?.reconnectFailureCount).toBe(1);

    // バックオフの数式自体(delayが10秒前後になること)はtiktok-listener.backoff.test.tsで
    // 直接検証済みなので、ここではスケジュールされた再接続が実際に発火することだけを見る。
    // 上限80秒+jitter最大12秒 = 92秒まで見れば、1回目のdelay(10秒台)は確実に発火している。
    await vi.waitFor(
      () => {
        expect(MockConnection.instances).toHaveLength(2);
      },
      { timeout: 20_000 }
    );

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  }, 30_000);

  it("接続成功でreconnectFailureCountが0にリセットされる", async () => {
    const tiktokHandle = `itest_rb_reset_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-rb-reset-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
    MockConnection.instances[0].fire("disconnected");
    expect(snapshotFor(roomId)?.reconnectFailureCount).toBe(1);

    await vi.waitFor(
      () => {
        expect(MockConnection.instances).toHaveLength(2);
      },
      { timeout: 20_000 }
    );

    // 2本目のconnect()は(モックのデフォルト実装で)即座に成功する。
    await vi.waitFor(() => {
      expect(snapshotFor(roomId)?.reconnectFailureCount).toBe(0);
    });

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  }, 30_000);

  it("stale化した接続からの遅延disconnectedは新しい接続の状態を汚染しない", async () => {
    const tiktokHandle = `itest_rb_stale_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-rb-stale-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
    const staleConn = MockConnection.instances[0];
    expect(snapshotFor(roomId)?.reconnectFailureCount).toBe(0);

    // stopListener()はinst.connectionをdisconnectするが、モックのdisconnect()は
    // 実際のソケットを閉じない(disconnectCallsを数えるだけ)。実運用でも
    // disconnect()がCONNECTING中の接続を確実に中断しない状況を模している。
    await stopListener(roomId);
    expect(staleConn.disconnectCalls).toBe(1);

    // 同じ部屋で listener を再作成する(新しい ListenerInstance = 新しい connection)。
    await startListener(roomId, tiktokHandle, [a.id]);
    expect(MockConnection.instances).toHaveLength(2);
    expect(snapshotFor(roomId)?.reconnectFailureCount).toBe(0);

    // 古い(stale化した)接続が、閉じられたはずの後に遅れてdisconnectedイベントを発火させる。
    // 世代チェック(inst.connection !== conn)が無ければ、これが新しいinstanceの
    // reconnectFailureCountを1にしてしまう。
    staleConn.fire("disconnected");
    expect(snapshotFor(roomId)?.reconnectFailureCount).toBe(0);
    expect(MockConnection.instances).toHaveLength(2);

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });

  it("再接続待機中にroom行が削除されてもunhandled rejectionでプロセスをクラッシュさせない(worker2 P2025回帰)", async () => {
    const tiktokHandle = `itest_rb_deleted_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-rb-deleted-a");
    const roomId = await resolveRoomForStreamer(a.id);

    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      await startListener(roomId, tiktokHandle, [a.id]);
      MockConnection.instances[0].fire("disconnected");
      expect(snapshotFor(roomId)?.reconnectFailureCount).toBe(1);

      // worker2実クラッシュのTOCTOU再現: 再接続がスケジュールされた直後にroom行がDBから消える。
      // scheduleReconnect()のsetTimeoutコールバックがconnectInstance()由来の例外をcatchせず
      // awaitしていると、ここでunhandled rejectionになりプロセスが落ちる。
      await cleanupRoom(roomId);

      // スケジュールされた再接続(バックオフ上限80秒+jitter最大12秒のうち、1回目のdelayは
      // 10秒台)の発火猶予を待つ。プロセスが生きていることの主張は unhandledRejections が
      // 空のまま経過することそのもの。
      await new Promise((resolve) => setTimeout(resolve, 15_000));

      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      await stopListener(roomId).catch(() => {});
      await cleanupStreamer(a.id);
    }
  }, 30_000);

  it("再接続時のDBエラーからも自動的に再試行し、listenerが無期限停止しない(code-review Codex指摘、TC-TLC-011回帰の副作用修正)", async () => {
    const tiktokHandle = `itest_rb_recover_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-rb-recover-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
    MockConnection.instances[0].fire("disconnected");
    expect(snapshotFor(roomId)?.reconnectFailureCount).toBe(1);

    // 一時的なDB障害を模してroom行を削除する。scheduled reconnectがconnectInstance()の
    // 失敗をcatchするだけで再試行を予約しないと、このroomは再接続タイマーなしのまま
    // 無期限に停止する(単に例外を握りつぶすだけの実装が生む新しいサイレント停止)。
    await cleanupRoom(roomId);

    // 1回目の再接続失敗後、reconnectFailureCountがさらに増えて次のリトライが
    // 自動的にスケジュールされていることを確認する。
    await vi.waitFor(
      () => {
        expect(snapshotFor(roomId)?.reconnectFailureCount).toBeGreaterThanOrEqual(2);
      },
      { timeout: 20_000 }
    );

    // DB障害が解消したことを模して、同じidでroom行を復元する。
    await prisma.tiktokRoom.create({
      data: { id: roomId, tiktokHandle, hostTiktokUid: makeTiktokUid(tiktokHandle) },
    });

    // 次にスケジュールされたリトライで接続が成功し、新しいMockConnectionが作られる。
    await vi.waitFor(
      () => {
        expect(MockConnection.instances.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 60_000 }
    );

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  }, 90_000);
});
