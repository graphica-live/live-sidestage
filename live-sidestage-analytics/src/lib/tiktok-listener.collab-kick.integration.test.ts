// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// コラボ検知(recordCollabGroupChange)による新規room自己割当+即キック、および
// 同一roomへの二重キック防止(created===trueは生涯1回だけ)を検証する。
// tiktok-live-connectorのWebcastPushConnectionをモックし、実際のTikTok接続は行わない。
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { startListener, stopListener, getListenerStatus, ensureAllListenersAlive } from "./tiktok-listener";
import { resolveRoomForStreamer } from "./tiktok-room";

// vi.mockのfactoryはファイル先頭へホイストされるため、参照するオブジェクトは
// vi.hoisted()で明示的にホイストしておく必要がある。tiktok-listener.room.integration.test.ts
// と同型のモックをここでも定義する(2箇所目ができた時点でDRY化を検討する程度でよい)。
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

function groupChangePayload(ownDisplayId: string, partnerDisplayId: string) {
  return {
    messageType: 18,
    source: "SOURCE_TYPE_FRIEND_LIST[REPLY_STATUS_AGREE]",
    businessContent: {
      cohostContent: {
        listChangeBizContent: {
          userInfos: {
            "1": { displayId: ownDisplayId, nickname: "own" },
            "2": { displayId: partnerDisplayId, nickname: "partner" },
          },
        },
      },
    },
  };
}

beforeEach(() => {
  MockConnection.instances.length = 0;
  emitOverlaySnapshotMock.mockClear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("recordCollabGroupChange: 新規コラボroomの自己割当+即キック", () => {
  it("新規発見のコラボ相手roomは自WORKER_INDEXで作成され、即接続される。再送では二重接続しない", async () => {
    const ownTiktokId = `itest_collabkick_own_${Date.now()}`;
    const partnerTiktokId = `itest_collabkick_partner_${Date.now()}`;
    const streamer = await createStreamer(ownTiktokId, "itest-collabkick");
    const ownRoomId = await resolveRoomForStreamer(streamer.id);

    await startListener(ownRoomId, ownTiktokId, [streamer.id]);
    const ownConn = MockConnection.instances[0];

    ownConn.fire("linkLayer", groupChangePayload(ownTiktokId, partnerTiktokId));

    await vi.waitFor(() => {
      expect(MockConnection.instances).toHaveLength(2); // 相手room分の接続が張られる
    });

    const partnerRoom = await prisma.tiktokRoom.findUniqueOrThrow({
      where: { tiktokId: partnerTiktokId },
    });
    // テスト環境は WORKER_COUNT=1 / WORKER_INDEX=0 (.env.local.test)。
    expect(partnerRoom.workerId).toBe(Number(process.env.WORKER_INDEX));
    expect(MockConnection.instances[1].connectCalls).toBe(1);

    // 同一コラボ通知の再送(TikTokは短時間に何度も送りうる)。
    ownConn.fire("linkLayer", groupChangePayload(ownTiktokId, partnerTiktokId));
    await new Promise((r) => setTimeout(r, 50));
    expect(MockConnection.instances).toHaveLength(2); // 増えない = 二重キックなし

    await stopListener(ownRoomId);
    await stopListener(partnerRoom.id);
    await cleanupStreamer(streamer.id);
    await cleanupRoom(ownRoomId);
    await cleanupRoom(partnerRoom.id);
  });

  it("他workerが既に担当しているroomをコラボ検知しても、接続もworkerIdの上書きもしない", async () => {
    const ownTiktokId = `itest_collabkick_own2_${Date.now()}`;
    const otherOwnedTiktokId = `itest_collabkick_otherowned_${Date.now()}`;
    const streamer = await createStreamer(ownTiktokId, "itest-collabkick-otherowned");
    const ownRoomId = await resolveRoomForStreamer(streamer.id);

    // テスト環境はWORKER_COUNT=1/WORKER_INDEX=0。workerId=1は「別workerが担当」を模す。
    const otherRoom = await prisma.tiktokRoom.create({
      data: { tiktokId: otherOwnedTiktokId, workerId: 1 },
    });

    await startListener(ownRoomId, ownTiktokId, [streamer.id]);
    const ownConn = MockConnection.instances[0];

    ownConn.fire("linkLayer", groupChangePayload(ownTiktokId, otherOwnedTiktokId));
    await new Promise((r) => setTimeout(r, 100));

    expect(MockConnection.instances).toHaveLength(1); // 相手分の接続は張られない(既存room=created:false)
    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: otherRoom.id } });
    expect(after.workerId).toBe(1); // 上書きされない

    await stopListener(ownRoomId);
    await cleanupStreamer(streamer.id);
    await cleanupRoom(ownRoomId);
    await cleanupRoom(otherRoom.id);
  });

  it("getWorkerConfig失敗(WORKER_INDEX不正)時は、新規roomを作成しても即キックしない", async () => {
    const ownTiktokId = `itest_collabkick_noindex_own_${Date.now()}`;
    const partnerTiktokId = `itest_collabkick_noindex_partner_${Date.now()}`;
    const streamer = await createStreamer(ownTiktokId, "itest-collabkick-noindex");
    const ownRoomId = await resolveRoomForStreamer(streamer.id);

    await startListener(ownRoomId, ownTiktokId, [streamer.id]);
    const ownConn = MockConnection.instances[0];

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // ""はNumber("")===0で有効な値になってしまうため、Number.isInteger(NaN)===falseで
    // 確実に失敗する不正値を使う。
    vi.stubEnv("WORKER_INDEX", "invalid");
    try {
      ownConn.fire("linkLayer", groupChangePayload(ownTiktokId, partnerTiktokId));
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      vi.unstubAllEnvs();
    }

    expect(MockConnection.instances).toHaveLength(1); // 即キックされない
    const partnerRoom = await prisma.tiktokRoom.findUniqueOrThrow({
      where: { tiktokId: partnerTiktokId },
    });
    expect(partnerRoom.workerId).toBeNull(); // workerId未設定で作成される(次のreconcileのhash割当待ち)
    expect(
      consoleErrorSpy.mock.calls.some((c) => String(c[0]).includes("getWorkerConfig失敗"))
    ).toBe(true);
    consoleErrorSpy.mockRestore();

    await stopListener(ownRoomId);
    await cleanupStreamer(streamer.id);
    await cleanupRoom(ownRoomId);
    await cleanupRoom(partnerRoom.id);
  });

  it("reconcile中(getMyRooms()スナップショット取得後)に作られたlistenerは、その周回ではteardownされず次周回で正規にteardownされる", async () => {
    const orphanTiktokId = `itest_collabkick_orphan_${Date.now()}`;
    // WORKER_COUNT=1/WORKER_INDEX=0のテスト環境でworkerId=1は「担当外」
    // (Streamer紐付けなし・AgencyWatchなし・monitorUntilなしでwatchedRoomFilterにも一致しない)。
    const orphanRoom = await prisma.tiktokRoom.create({
      data: { tiktokId: orphanTiktokId, workerId: 1 },
    });

    // getMyRooms()内の最初のfindMany呼び出し(DBスナップショット取得)の最中に、
    // コラボ即キック相当のstartListenerを割り込ませ、createdAtガードを直接再現する。
    const originalFindMany = prisma.tiktokRoom.findMany.bind(prisma.tiktokRoom);
    const findManySpy = vi.spyOn(prisma.tiktokRoom, "findMany");
    let injected = false;
    (findManySpy as unknown as { mockImplementation: (fn: (...args: unknown[]) => unknown) => void }).mockImplementation(
      async (...args: unknown[]) => {
        if (!injected) {
          injected = true;
          await startListener(orphanRoom.id, orphanTiktokId, []);
        }
        return (originalFindMany as (...args: unknown[]) => unknown)(...args);
      }
    );

    expect(getListenerStatus(orphanRoom.id)).toBeNull(); // まだ起動していない

    await ensureAllListenersAlive();
    expect(getListenerStatus(orphanRoom.id)).not.toBeNull(); // 1周回目はcreatedAtガードで見送られる

    findManySpy.mockRestore();

    await ensureAllListenersAlive(); // 2周回目はDBどおり担当外として正規にteardown
    expect(getListenerStatus(orphanRoom.id)).toBeNull();

    await cleanupRoom(orphanRoom.id);
  });
});
