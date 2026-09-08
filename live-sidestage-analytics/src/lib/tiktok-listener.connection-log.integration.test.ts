// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// RoomConnectionInterval(接続区間ログ)のopen/close計装を検証する。
// tiktok-live-connectorのWebcastPushConnectionをモックし、実際のTikTok接続は行わない。
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "./prisma";
import { makeTiktokUid } from "./__fixtures__/gift";
import { startListener, stopListener } from "./tiktok-listener";
import { resolveRoomForStreamer } from "./tiktok-room";

const { MockConnection } = vi.hoisted(() => {
  class MockConnection {
    static instances: MockConnection[] = [];
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};
    clientParams: Record<string, string> = {};
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
    async connect() {}
    disconnect() {}
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

async function createStreamer(tiktokHandle: string, emailPrefix: string) {
  const user = await prisma.user.create({
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
  if (streamer) await prisma.user.delete({ where: { id: streamer.principalId } });
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
    const tiktokHandle = `itest_connlog_basic_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-connlog-basic-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
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
    const tiktokHandle = `itest_connlog_stop_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-connlog-stop-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
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
    const tiktokHandle = `itest_connlog_double_${Date.now()}`;
    const a = await createStreamer(tiktokHandle, "itest-connlog-double-a");
    const roomId = await resolveRoomForStreamer(a.id);

    await startListener(roomId, tiktokHandle, [a.id]);
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
