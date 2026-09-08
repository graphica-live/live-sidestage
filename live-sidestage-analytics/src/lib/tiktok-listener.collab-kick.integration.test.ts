// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// コラボ検知(recordCollabGroupChange)による新規room自己割当+即キック、および
// 同一roomへの二重キック防止(created===trueは生涯1回だけ)を検証する。
// tiktok-live-connectorのWebcastPushConnectionをモックし、実際のTikTok接続は行わない。
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { startListener, stopListener, getListenerStatus, ensureAllListenersAlive } from "./tiktok-listener";
import { resolveRoomForStreamer } from "./tiktok-room";
import { makeTiktokUid } from "./__fixtures__/gift";

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

const emitOverlaySnapshotMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./overlay", () => ({
  emitOverlaySnapshot: emitOverlaySnapshotMock,
  emitGiftDrivenOverlayUpdates: emitOverlaySnapshotMock,
}));

// room の同一性は hostTiktokUid。テストは配信者をハンドルで書いているので、
// ハンドルから決定的に uid を導いて「別ハンドル = 別配信者 = 別 room」を保つ。
const uidOf = (tiktokHandle: string) => makeTiktokUid(tiktokHandle);

/** 指定ハンドルの room を uid で引く(tiktokHandle には unique が無いので where には使えない)。 */
function findRoomByHandle(tiktokHandle: string) {
  return prisma.tiktokRoom.findUnique({ where: { hostTiktokUid: uidOf(tiktokHandle) } });
}

function findRoomByHandleOrThrow(tiktokHandle: string) {
  return prisma.tiktokRoom.findUniqueOrThrow({ where: { hostTiktokUid: uidOf(tiktokHandle) } });
}

async function createStreamer(tiktokHandle: string, emailPrefix: string) {
  const user = await prisma.user.create({
    data: { email: `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@local.test` },
  });
  return prisma.streamer.create({
    data: {
      principalId: user.id,
      tiktokUid: uidOf(tiktokHandle),
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
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {});
}

function groupChangePayload(
  ownDisplayId: string,
  partnerDisplayId: string,
  options: { source?: string; statuses?: number[] } = {}
) {
  const statuses = options.statuses;
  return {
    messageType: 18,
    source: options.source ?? "SOURCE_TYPE_FRIEND_LIST[REPLY_STATUS_AGREE]",
    ...(statuses
      ? {
          groupChangeContent: {
            groupUser: { userList: statuses.map((status, i) => ({ channelId: `ch${i}`, status })) },
          },
        }
      : {}),
    businessContent: {
      cohostContent: {
        listChangeBizContent: {
          // userInfos のキーは TikTok の不変な数値ID(tiktokUid)。
          userInfos: {
            [uidOf(ownDisplayId)]: { displayId: ownDisplayId, nickname: "own" },
            [uidOf(partnerDisplayId)]: { displayId: partnerDisplayId, nickname: "partner" },
          },
        },
      },
    },
  };
}

function battleOpenPayload(battleId: string, ownDisplayId: string, partnerDisplayId: string) {
  return {
    battleId,
    action: 4, // BATTLE_ACTION.OPEN
    // TikTok の生 payload のキーは userId(sidestage の principalId ではない)。
    anchorInfo: [
      { user: { userId: uidOf(ownDisplayId), displayId: ownDisplayId, nickName: "own" } },
      { user: { userId: uidOf(partnerDisplayId), displayId: partnerDisplayId, nickName: "partner" } },
    ],
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
    const ownTiktokHandle = `itest_collabkick_own_${Date.now()}`;
    const partnerTiktokHandle = `itest_collabkick_partner_${Date.now()}`;
    const streamer = await createStreamer(ownTiktokHandle, "itest-collabkick");
    const ownRoomId = await resolveRoomForStreamer(streamer.id);

    await startListener(ownRoomId, ownTiktokHandle, [streamer.id]);
    const ownConn = MockConnection.instances[0];

    ownConn.fire("linkLayer", groupChangePayload(ownTiktokHandle, partnerTiktokHandle));

    await vi.waitFor(() => {
      expect(MockConnection.instances).toHaveLength(2); // 相手room分の接続が張られる
    });

    const partnerRoom = await findRoomByHandleOrThrow(partnerTiktokHandle);
    // テスト環境は WORKER_COUNT=1 / WORKER_INDEX=0 (.env.local.test)。
    expect(partnerRoom.workerId).toBe(Number(process.env.WORKER_INDEX));
    expect(MockConnection.instances[1].connectCalls).toBe(1);

    // 同一コラボ通知の再送(TikTokは短時間に何度も送りうる)。
    ownConn.fire("linkLayer", groupChangePayload(ownTiktokHandle, partnerTiktokHandle));
    await new Promise((r) => setTimeout(r, 50));
    expect(MockConnection.instances).toHaveLength(2); // 増えない = 二重キックなし

    await stopListener(ownRoomId);
    await stopListener(partnerRoom.id);
    await cleanupStreamer(streamer.id);
    await cleanupRoom(ownRoomId);
    await cleanupRoom(partnerRoom.id);
  });

  it("他workerが既に担当しているroomをコラボ検知しても、接続もworkerIdの上書きもしない", async () => {
    const ownTiktokHandle = `itest_collabkick_own2_${Date.now()}`;
    const otherOwnedTiktokHandle = `itest_collabkick_otherowned_${Date.now()}`;
    const streamer = await createStreamer(ownTiktokHandle, "itest-collabkick-otherowned");
    const ownRoomId = await resolveRoomForStreamer(streamer.id);

    // テスト環境はWORKER_COUNT=1/WORKER_INDEX=0。workerId=1は「別workerが担当」を模す。
    const otherRoom = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: uidOf(otherOwnedTiktokHandle), tiktokHandle: otherOwnedTiktokHandle, workerId: 1 },
    });

    await startListener(ownRoomId, ownTiktokHandle, [streamer.id]);
    const ownConn = MockConnection.instances[0];

    ownConn.fire("linkLayer", groupChangePayload(ownTiktokHandle, otherOwnedTiktokHandle));
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
    const ownTiktokHandle = `itest_collabkick_noindex_own_${Date.now()}`;
    const partnerTiktokHandle = `itest_collabkick_noindex_partner_${Date.now()}`;
    const streamer = await createStreamer(ownTiktokHandle, "itest-collabkick-noindex");
    const ownRoomId = await resolveRoomForStreamer(streamer.id);

    await startListener(ownRoomId, ownTiktokHandle, [streamer.id]);
    const ownConn = MockConnection.instances[0];

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // ""はNumber("")===0で有効な値になってしまうため、Number.isInteger(NaN)===falseで
    // 確実に失敗する不正値を使う。
    vi.stubEnv("WORKER_INDEX", "invalid");
    let partnerRoom: Awaited<ReturnType<typeof findRoomByHandleOrThrow>>;
    try {
      ownConn.fire("linkLayer", groupChangePayload(ownTiktokHandle, partnerTiktokHandle));
      // **固定 sleep にしない。** 他ファイルとの並列実行でCPUが詰まると room 作成が
      // 100ms を超え、unstubAllEnvs() 後(= WORKER_INDEX が正常値に戻った後)に
      // 作られて workerId が入ってしまう。stub を張ったまま着弾を待つ。
      partnerRoom = await vi.waitFor(() => findRoomByHandleOrThrow(partnerTiktokHandle));
    } finally {
      vi.unstubAllEnvs();
    }

    expect(MockConnection.instances).toHaveLength(1); // 即キックされない
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
    const orphanTiktokHandle = `itest_collabkick_orphan_${Date.now()}`;
    // WORKER_COUNT=1/WORKER_INDEX=0のテスト環境でworkerId=1は「担当外」
    // (Streamer紐付けなし・AgencyWatchなし・monitorUntilなしでwatchedRoomFilterにも一致しない)。
    const orphanRoom = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: uidOf(orphanTiktokHandle), tiktokHandle: orphanTiktokHandle, workerId: 1 },
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
          await startListener(orphanRoom.id, orphanTiktokHandle, []);
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

describe("linkLayer: コラボ発見のキックはStreamer購読または特別監視のroomに限る(2026-09-06、連鎖爆発の再発防止)", () => {
  it("subscriberIds空・specialWatch falseのroomでは、linkLayerのコラボ承諾があっても相手roomを作成しない", async () => {
    const ownTiktokHandle = `itest_noguard_own_${Date.now()}`;
    const partnerTiktokHandle = `itest_noguard_partner_${Date.now()}`;
    // resolveRoomForStreamerを経由せず、Streamer紐付けなしのroomを直接作る。
    const ownRoom = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: uidOf(ownTiktokHandle), tiktokHandle: ownTiktokHandle },
    });

    await startListener(ownRoom.id, ownTiktokHandle, []); // subscriberIds空、specialWatch既定false
    const ownConn = MockConnection.instances[0];

    ownConn.fire("linkLayer", groupChangePayload(ownTiktokHandle, partnerTiktokHandle));

    // 発火しないことの確認は「一定時間後も存在しない」でしか確かめられないため、
    // 実処理が非同期で完走するのを待つ目的で他の副作用のない待機を挟む。
    await new Promise((resolve) => setTimeout(resolve, 200));
    const partnerRoom = await findRoomByHandle(partnerTiktokHandle);
    expect(partnerRoom).toBeNull();

    await stopListener(ownRoom.id);
    await cleanupRoom(ownRoom.id);
  });

  it("specialWatch trueのroomなら、subscriberIds空でもlinkLayerのコラボ承諾で相手roomを作成する", async () => {
    const ownTiktokHandle = `itest_specialwatch_own_${Date.now()}`;
    const partnerTiktokHandle = `itest_specialwatch_partner_${Date.now()}`;
    const ownRoom = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: uidOf(ownTiktokHandle), tiktokHandle: ownTiktokHandle, specialWatch: true },
    });

    await startListener(ownRoom.id, ownTiktokHandle, [], true); // subscriberIds空、specialWatch true
    const ownConn = MockConnection.instances[0];

    ownConn.fire("linkLayer", groupChangePayload(ownTiktokHandle, partnerTiktokHandle));

    await vi.waitFor(async () => {
      const partnerRoom = await findRoomByHandle(partnerTiktokHandle);
      expect(partnerRoom).not.toBeNull();
    });

    const partnerRoom = await findRoomByHandleOrThrow(partnerTiktokHandle);
    expect(partnerRoom.watchSource).toBe("collab");

    await stopListener(ownRoom.id);
    await stopListener(partnerRoom.id);
    await cleanupRoom(ownRoom.id);
    await cleanupRoom(partnerRoom.id);
  });
});

describe("linkLayer: 待機者(status:1)の有無で採用可否を切り替える(2026-09-07)", () => {
  it("待機者が居る招待送信イベントでは相手roomを作成しない", async () => {
    const ownTiktokHandle = `itest_waiting_own_${Date.now()}`;
    const partnerTiktokHandle = `itest_waiting_partner_${Date.now()}`;
    const streamer = await createStreamer(ownTiktokHandle, "itest-waiting");
    const ownRoomId = await resolveRoomForStreamer(streamer.id);

    await startListener(ownRoomId, ownTiktokHandle, [streamer.id]);
    const ownConn = MockConnection.instances[0];

    ownConn.fire(
      "linkLayer",
      groupChangePayload(ownTiktokHandle, partnerTiktokHandle, {
        source: "SOURCE_TYPE_RECOMMEND_LIST",
        statuses: [3, 1],
      })
    );

    // 作成されないことは「一定時間観測し続けて現れない」でしか確かめられない。固定待ちだと
    // 遅いCIで作成が待ち時間の後ろへずれた場合に見逃すため、pollで繰り返し確認する。
    await expect
      .poll(async () => findRoomByHandle(partnerTiktokHandle), {
        timeout: 2000,
        interval: 50,
      })
      .toBeNull();

    await stopListener(ownRoomId);
    await cleanupStreamer(streamer.id);
    await cleanupRoom(ownRoomId);
  });

  it("待機者0なら承諾以外のsource(live_end)でも相手roomをcollabとして作成する", async () => {
    const ownTiktokHandle = `itest_nowaiting_own_${Date.now()}`;
    const partnerTiktokHandle = `itest_nowaiting_partner_${Date.now()}`;
    const streamer = await createStreamer(ownTiktokHandle, "itest-nowaiting");
    const ownRoomId = await resolveRoomForStreamer(streamer.id);

    await startListener(ownRoomId, ownTiktokHandle, [streamer.id]);
    const ownConn = MockConnection.instances[0];

    ownConn.fire(
      "linkLayer",
      groupChangePayload(ownTiktokHandle, partnerTiktokHandle, { source: "live_end", statuses: [3, 3] })
    );

    await vi.waitFor(async () => {
      expect(await findRoomByHandle(partnerTiktokHandle)).not.toBeNull();
    });
    const partnerRoom = await findRoomByHandleOrThrow(partnerTiktokHandle);
    expect(partnerRoom.watchSource).toBe("collab");

    await stopListener(ownRoomId);
    await stopListener(partnerRoom.id);
    await cleanupStreamer(streamer.id);
    await cleanupRoom(ownRoomId);
    await cleanupRoom(partnerRoom.id);
  });
});

describe("linkMicBattle action:4: コラボ検知の取りこぼしを埋める補助トリガー", () => {
  it("相手roomが未監視ならbattle_start経由で作成し、opponentWatchへ記録する", async () => {
    const ownTiktokHandle = `itest_battlewatch_own_${Date.now()}`;
    const partnerTiktokHandle = `itest_battlewatch_partner_${Date.now()}`;
    const battleId = `itest_battle_${Date.now()}`;
    const streamer = await createStreamer(ownTiktokHandle, "itest-battlewatch");
    const ownRoomId = await resolveRoomForStreamer(streamer.id);

    await startListener(ownRoomId, ownTiktokHandle, [streamer.id]);
    const ownConn = MockConnection.instances[0];

    ownConn.fire("linkMicBattle", battleOpenPayload(battleId, ownTiktokHandle, partnerTiktokHandle));

    await vi.waitFor(async () => {
      const partnerRoom = await findRoomByHandle(partnerTiktokHandle);
      expect(partnerRoom).not.toBeNull();
    });
    const partnerRoom = await findRoomByHandleOrThrow(partnerTiktokHandle);
    expect(partnerRoom.watchSource).toBe("battle_start");

    await vi.waitFor(async () => {
      const battle = await prisma.tiktokBattle.findUniqueOrThrow({
        where: { roomId_battleId: { roomId: ownRoomId, battleId } },
      });
      const opponentWatch = battle.opponentWatch as Record<string, { source: string }>;
      expect(opponentWatch[uidOf(partnerTiktokHandle)]?.source).toBe("battle_start");
    });

    await stopListener(ownRoomId);
    await stopListener(partnerRoom.id);
    await cleanupStreamer(streamer.id);
    await cleanupRoom(ownRoomId);
    await cleanupRoom(partnerRoom.id);
  });

  it("相手roomが既にcollab経由で監視中なら、watchSourceを上書きせずopponentWatchへcollabと記録する", async () => {
    const ownTiktokHandle = `itest_battlewatch_kept_own_${Date.now()}`;
    const partnerTiktokHandle = `itest_battlewatch_kept_partner_${Date.now()}`;
    const battleId = `itest_battle_kept_${Date.now()}`;
    const streamer = await createStreamer(ownTiktokHandle, "itest-battlewatch-kept");
    const ownRoomId = await resolveRoomForStreamer(streamer.id);
    const partnerRoom = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: uidOf(partnerTiktokHandle), tiktokHandle: partnerTiktokHandle, watchSource: "collab" },
    });

    await startListener(ownRoomId, ownTiktokHandle, [streamer.id]);
    const ownConn = MockConnection.instances[0];

    ownConn.fire("linkMicBattle", battleOpenPayload(battleId, ownTiktokHandle, partnerTiktokHandle));

    await vi.waitFor(async () => {
      const battle = await prisma.tiktokBattle.findUnique({
        where: { roomId_battleId: { roomId: ownRoomId, battleId } },
      });
      expect(battle).not.toBeNull();
      const opponentWatch = battle!.opponentWatch as Record<string, { source: string }>;
      expect(opponentWatch[uidOf(partnerTiktokHandle)]?.source).toBe("collab");
    });

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: partnerRoom.id } });
    expect(after.watchSource).toBe("collab"); // 上書きされない

    await stopListener(ownRoomId);
    await cleanupStreamer(streamer.id);
    await cleanupRoom(ownRoomId);
    await cleanupRoom(partnerRoom.id);
  });
});
