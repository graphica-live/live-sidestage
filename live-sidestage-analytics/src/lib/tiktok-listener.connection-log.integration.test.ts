// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// RoomConnectionInterval(接続区間ログ)のopen/close計装を検証する。
// tiktok-live-connectorのWebcastPushConnectionをモックし、実際のTikTok接続は行わない。
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "./prisma";
import { startListener, stopListener } from "./tiktok-listener";
import { resolveRoomForStreamer } from "./tiktok-room";

const { MockConnection } = vi.hoisted(() => {
  class MockConnection {
    static instances: MockConnection[] = [];
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};
    clientParams: Record<string, string> = {};
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
    async connect() {}
    disconnect() {}
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
  await prisma.roomConnectionInterval.deleteMany({ where: { roomId } });
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {});
}

beforeEach(() => {
  MockConnection.instances.length = 0;
  emitOverlaySnapshotMock.mockClear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("RoomConnectionInterval計装", () => {
  it("接続確立でopen、disconnectedイベントでcloseする(理由も残す)", async () => {
    const tiktokId = `itest_connlog_basic_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-connlog-basic-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokId, [a.id]);
    await vi.waitFor(async () => {
      const rows = await prisma.roomConnectionInterval.findMany({ where: { roomId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].endedAt).toBeNull();
    });

    const conn = MockConnection.instances[0];
    conn.fire("disconnected");

    await vi.waitFor(async () => {
      const rows = await prisma.roomConnectionInterval.findMany({ where: { roomId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].endedAt).not.toBeNull();
      expect(rows[0].disconnectReason).toBe("disconnected");
    });

    await stopListener(roomId, "unwatched");
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });

  it("接続中にstopListenerで意図的に止めた場合もcloseする(updateStateを経由しない唯一の切断経路)", async () => {
    const tiktokId = `itest_connlog_stop_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-connlog-stop-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokId, [a.id]);
    await vi.waitFor(async () => {
      const rows = await prisma.roomConnectionInterval.findMany({ where: { roomId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].endedAt).toBeNull();
    });

    await stopListener(roomId, "unwatched");

    const rows = await prisma.roomConnectionInterval.findMany({ where: { roomId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].endedAt).not.toBeNull();
    expect(rows[0].disconnectReason).toBe("unwatched");

    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });

  it("disconnected後にstopListenerを呼んでも二重にcloseしない(冪等)", async () => {
    const tiktokId = `itest_connlog_double_${Date.now()}`;
    const a = await createStreamer(tiktokId, "itest-connlog-double-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokId, [a.id]);
    await vi.waitFor(async () => {
      expect(await prisma.roomConnectionInterval.count({ where: { roomId } })).toBe(1);
    });

    const conn = MockConnection.instances[0];
    conn.fire("disconnected");
    await vi.waitFor(async () => {
      const rows = await prisma.roomConnectionInterval.findMany({ where: { roomId } });
      expect(rows[0].endedAt).not.toBeNull();
    });
    const closedAtFirstClose = (await prisma.roomConnectionInterval.findFirstOrThrow({ where: { roomId } }))
      .endedAt;

    // disconnectedで既にidle化していないinst.state.statusは"retrying"のまま。
    // stopListenerはconnectionIntervalIdがnull化済みなので二重closeしない。
    await stopListener(roomId, "unwatched");

    const rows = await prisma.roomConnectionInterval.findMany({ where: { roomId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].endedAt?.getTime()).toBe(closedAtFirstClose?.getTime());
    expect(rows[0].disconnectReason).toBe("disconnected");

    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
  });
});
