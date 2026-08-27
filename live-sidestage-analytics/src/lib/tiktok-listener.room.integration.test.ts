// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// TikTok接続の重複解消(TiktokRoomによる接続+ギフトデータ共有)のコア動作を検証する。
// tiktok-live-connectorのWebcastPushConnectionをモックし、実際のTikTok接続は行わない。
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { prisma } from "./prisma";
import {
  startListener,
  stopListener,
  getListenerStatus,
  resumeAllListeners,
  ensureAllListenersAlive,
} from "./tiktok-listener";
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
  // notifyOverlayUpdate()はgift受信のたびにemitGiftDrivenOverlayUpdates()を呼ぶ
  // (contribution/coin-list/top-giftをまとめて更新する facade)。既存テストの
  // 「購読者全員に通知される」検証をそのまま活かすため、同じモック関数を共有する。
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

// live-sidestage-event が /api/internal/event-room-lease で立てる監視要求の挙動。
// 会員登録(Streamer)がない配信者でも、イベント期間中だけ接続を維持できることを保証する。
describe("monitorUntilによる期限付き監視", () => {
  const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000);
  const PAST = () => new Date(Date.now() - 60 * 60 * 1000);

  async function createRoom(tiktokId: string, monitorUntil: Date | null) {
    return prisma.tiktokRoom.create({
      data: { tiktokId, monitorUntil },
      select: { id: true },
    });
  }

  it("Streamerが1人もいなくても、monitorUntilが未来なら担当部屋に含まれ接続される", async () => {
    const tiktokId = `itest_lease_active_${Date.now()}`;
    const room = await createRoom(tiktokId, FUTURE());

    await resumeAllListeners();

    expect(getListenerStatus(room.id)).not.toBeNull();

    await stopListener(room.id);
    await cleanupRoom(room.id);
  });

  it("StreamerがおらずmonitorUntilも過去なら担当部屋に含まれない", async () => {
    const tiktokId = `itest_lease_expired_${Date.now()}`;
    const room = await createRoom(tiktokId, PAST());

    await resumeAllListeners();

    expect(getListenerStatus(room.id)).toBeNull();

    await cleanupRoom(room.id);
  });

  it("monitorUntilが切れるとreconcileで切断されるが、部屋と受信済みGiftは残る", async () => {
    const tiktokId = `itest_lease_teardown_${Date.now()}`;
    const room = await createRoom(tiktokId, FUTURE());

    await resumeAllListeners();
    expect(getListenerStatus(room.id)).not.toBeNull();

    await prisma.gift.create({
      data: {
        roomId: room.id,
        uniqueId: "listener_x",
        nickname: "リスナーX",
        giftId: 5,
        giftName: "Finger Heart",
        repeatCount: 1,
        diamondCount: 5,
        totalDiamonds: 5,
        dayKey: "2026-08-21",
        orderId: `itest_lease_order_${Date.now()}`,
      },
    });

    // イベント終了 = 監視要求の期限切れ
    await prisma.tiktokRoom.update({
      where: { id: room.id },
      data: { monitorUntil: PAST() },
    });

    await ensureAllListenersAlive();

    expect(getListenerStatus(room.id)).toBeNull();
    // データは保持したまま監視だけ止める(要件どおり削除はしない)
    expect(await prisma.tiktokRoom.findUnique({ where: { id: room.id } })).not.toBeNull();
    expect(await prisma.gift.count({ where: { roomId: room.id } })).toBe(1);

    await cleanupRoom(room.id);
  });

  it("期限切れ後でも、その部屋を指定したStreamer登録があれば監視が再開される", async () => {
    const tiktokId = `itest_lease_resume_${Date.now()}`;
    const room = await createRoom(tiktokId, PAST());

    await resumeAllListeners();
    expect(getListenerStatus(room.id)).toBeNull();

    const a = await createStreamer(tiktokId, "itest-lease-resume-a");
    const resolved = await resolveRoomForStreamer(a.id);
    expect(resolved).toBe(room.id); // 新規作成ではなく既存の部屋に紐づく

    await ensureAllListenersAlive();

    expect(getListenerStatus(room.id)).not.toBeNull();

    await stopListener(room.id);
    await cleanupStreamer(a.id);
    await cleanupRoom(room.id);
  });
});

// gift の dedup キーは (roomId, orderId) だが、本番では orderId が 99.85% 空で制約が効いていない。
// 代わりに使える msgId を、まず観測できる状態にするための保存経路を検証する。
// unique 制約はまだ張らない — 実データで一意性と充足率を確かめてから昇格させる。
describe("giftのmsgId/giftType保存", () => {
  async function fireGiftAndRead(
    tiktokId: string,
    emailPrefix: string,
    payload: Record<string, unknown>
  ) {
    const a = await createStreamer(tiktokId, emailPrefix);
    const roomId = await resolveRoomForStreamer(a.id);
    await startListener(roomId, tiktokId, [a.id]);
    const conn = MockConnection.instances[0];
    expect(conn).toBeDefined();

    conn.fire("gift", payload);

    await vi.waitFor(async () => {
      const gifts = await prisma.gift.findMany({ where: { roomId } });
      expect(gifts).toHaveLength(1);
    });
    const gifts = await prisma.gift.findMany({ where: { roomId } });

    await stopListener(roomId);
    await cleanupStreamer(a.id);
    await cleanupRoom(roomId);
    return gifts[0];
  }

  it("有効なmsgIdとgiftTypeがそのまま保存される", async () => {
    const gift = await fireGiftAndRead(
      `itest_msgid_ok_${Date.now()}`,
      "itest-msgid-ok",
      {
        uniqueId: "user_msgid",
        nickname: "msgIdユーザー",
        giftType: 1,
        giftId: 5,
        giftName: "Rose",
        repeatCount: 1,
        diamondCount: 1,
        msgId: "7412345678901234567",
        createTime: Date.now(),
      }
    );

    expect(gift.msgId).toBe("7412345678901234567");
    expect(gift.giftType).toBe(1);
  });

  it('msgId="0" はnullで保存される(既定値を実IDとして残さない)', async () => {
    // "0" をそのまま入れると、将来 (roomId, msgId) にunique制約を張った瞬間に
    // 無関係なギフト同士が衝突して P2002 で捨てられる。
    const gift = await fireGiftAndRead(
      `itest_msgid_zero_${Date.now()}`,
      "itest-msgid-zero",
      {
        uniqueId: "user_zero",
        nickname: "ゼロユーザー",
        giftType: 0,
        giftId: 6,
        giftName: "Finger Heart",
        repeatCount: 1,
        diamondCount: 5,
        msgId: "0",
        createTime: Date.now(),
      }
    );

    expect(gift.msgId).toBeNull();
    expect(gift.giftType).toBe(0);
  });

  it("msgIdが無いギフトも従来どおり保存される", async () => {
    const gift = await fireGiftAndRead(
      `itest_msgid_none_${Date.now()}`,
      "itest-msgid-none",
      {
        uniqueId: "user_none",
        nickname: "msgId無しユーザー",
        giftId: 7,
        giftName: "Rosa",
        repeatCount: 2,
        diamondCount: 10,
        createTime: Date.now(),
      }
    );

    expect(gift.msgId).toBeNull();
    expect(gift.giftType).toBeNull();
    expect(gift.totalDiamonds).toBe(20);
  });
});

// worker.ts の readiness は「startListenerの失敗が0件」を条件にする。その前提として、
// DBに到達できない状況では startListener が握りつぶさず例外を投げる必要がある。
// (TikTok側の接続失敗は connectAndAttach が捕まえて再接続へ回すので例外にならない)
describe("readinessの前提: DB起因の失敗はstartListenerから伝播する", () => {
  it("DB上に存在しない部屋のstartListenerは例外になる", async () => {
    const missingRoomId = `itest-missing-room-${Date.now()}`;

    await expect(
      startListener(missingRoomId, `itest_missing_${Date.now()}`, [])
    ).rejects.toThrow();

    await stopListener(missingRoomId).catch(() => undefined);
  });
});
