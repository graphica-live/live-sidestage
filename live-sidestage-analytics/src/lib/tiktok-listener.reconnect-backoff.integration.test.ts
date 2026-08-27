// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// scheduleReconnect()の"disconnected"/"error"(user_offline以外)用の指数バックオフ
// (reconnectFailureCount)と、世代チェックによる多重接続防止を検証する。
// バックオフの数式(delay列・上限・jitter)自体はtiktok-listener.backoff.test.ts(DB不要)で
// 直接検証しているので、ここでは状態遷移(インクリメント/リセット/世代チェック)に絞る。
// tiktok-live-connectorのWebcastPushConnectionをモックし、実際のTikTok接続は行わない。
import { describe, it, expect, afterAll, afterEach, vi, beforeEach } from "vitest";
import { prisma } from "./prisma";
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
    const tiktokId = `itest_rb_disc_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-rb-disc-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokId, [a.id]);
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
    const tiktokId = `itest_rb_reset_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-rb-reset-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokId, [a.id]);
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
    const tiktokId = `itest_rb_stale_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-rb-stale-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokId, [a.id]);
    const staleConn = MockConnection.instances[0];
    expect(snapshotFor(roomId)?.reconnectFailureCount).toBe(0);

    // stopListener()はinst.connectionをdisconnectするが、モックのdisconnect()は
    // 実際のソケットを閉じない(disconnectCallsを数えるだけ)。実運用でも
    // disconnect()がCONNECTING中の接続を確実に中断しない状況を模している。
    await stopListener(roomId);
    expect(staleConn.disconnectCalls).toBe(1);

    // 同じ部屋で listener を再作成する(新しい ListenerInstance = 新しい connection)。
    await startListener(roomId, tiktokId, [a.id]);
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
});
