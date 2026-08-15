// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// TikTok接続の重複解消(TiktokRoomによる接続+ギフトデータ共有)のコア動作を検証する。
// tiktok-live-connectorのWebcastPushConnectionをモックし、実際のTikTok接続は行わない。
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { startListener, stopListener, getListenerStatus } from "./tiktok-listener";
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

afterAll(async () => {
  await prisma.$disconnect();
});

describe("TiktokRoomによる接続共有", () => {
  it("同じtiktokIdを2人が登録しても、実際のTikTok接続は1本だけ張られる", async () => {
    const tiktokId = `itest_dedup_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-dedup-a");
    const b = await createStreamer(tiktokId, "itest-dedup-b");

    const roomIdA = await resolveRoomForStreamer(a.id);
    const roomIdB = await resolveRoomForStreamer(b.id);
    expect(roomIdA).toBe(roomIdB); // 同じ部屋に解決される

    await startListener(roomIdA, tiktokId, [a.id]);
    await startListener(roomIdB, tiktokId, [a.id, b.id]); // 2人目が追加購読

    expect(MockConnection.instances).toHaveLength(1);

    await stopListener(roomIdA);
    await cleanupStreamer(a.id);
    await cleanupStreamer(b.id);
    await cleanupRoom(roomIdA);
  });

  it("1件のgiftイベントでGift行は1件だけ作られ、購読者全員のオーバーレイに通知される", async () => {
    const tiktokId = `itest_dedup_gift_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-dedup-gift-a");
    const b = await createStreamer(tiktokId, "itest-dedup-gift-b");
    const roomId = await resolveRoomForStreamer(a.id);
    await resolveRoomForStreamer(b.id);

    await startListener(roomId, tiktokId, [a.id, b.id]);
    const conn = MockConnection.instances[0];
    expect(conn).toBeDefined();

    conn.fire("gift", {
      uniqueId: "user_x",
      nickname: "ユーザーX",
      giftType: 0,
      giftId: 5,
      giftName: "Finger Heart",
      repeatCount: 1,
      diamondCount: 5,
      orderId: `order_${Date.now()}`,
      createTime: Date.now(),
    });

    // ハンドラ内のDB書き込みは非同期(fire-and-forget)なので完了を待つ。
    await vi.waitFor(async () => {
      const gifts = await prisma.gift.findMany({ where: { roomId } });
      expect(gifts).toHaveLength(1);
    });

    const gifts = await prisma.gift.findMany({ where: { roomId } });
    expect(gifts[0].totalDiamonds).toBe(5);

    await vi.waitFor(() => {
      expect(emitOverlaySnapshotMock).toHaveBeenCalledTimes(2);
    });
    const notified = emitOverlaySnapshotMock.mock.calls.map((c) => c[0]).sort();
    expect(notified).toEqual([a.id, b.id].sort());

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupStreamer(b.id);
    await cleanupRoom(roomId);
  });

  it("最後の購読者が離脱すると接続が切断され、getListenerStatusはnullになる", async () => {
    const tiktokId = `itest_dedup_stop_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-dedup-stop-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokId, [a.id]);
    const conn = MockConnection.instances[0];
    expect(getListenerStatus(roomId)).not.toBeNull();

    await stopListener(roomId);

    expect(conn.disconnectCalls).toBeGreaterThan(0);
    expect(getListenerStatus(roomId)).toBeNull();

    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });

  it("tiktokId変更(再登録)で旧roomと新roomが別々に解決される", async () => {
    const oldTiktokId = `itest_dedup_old_${Date.now()}`;
    const newTiktokId = `itest_dedup_new_${Date.now()}`;
    const a = await createStreamer(oldTiktokId, "itest-dedup-move-a");

    const oldRoomId = await resolveRoomForStreamer(a.id);
    await startListener(oldRoomId, oldTiktokId, [a.id]);
    expect(MockConnection.instances).toHaveLength(1);

    await prisma.streamer.update({ where: { id: a.id }, data: { tiktokId: newTiktokId } });
    const newRoomId = await resolveRoomForStreamer(a.id);

    expect(newRoomId).not.toBe(oldRoomId);

    // reconcileループ相当の後処理: 旧roomはもう誰も購読していないので切断する。
    await stopListener(oldRoomId);
    expect(getListenerStatus(oldRoomId)).toBeNull();

    await cleanupStreamer(a.id);
    await cleanupRoom(oldRoomId);
    await cleanupRoom(newRoomId);
  });
});
