// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// ギフトの二重計上防止(msgIdベースのdedup)を検証する。
//
// dedupは2層ある。
//   1. listenerインスタンス内のFIFO(recentGiftMsgIds) — 同一プロセスへの再送を落とす
//   2. saveGift()のDB照会(直近GIFT_DEDUP_WINDOW_MS) — 別プロセスが既に書いた行を見つける
// 1だけではデプロイ中の新旧Worker並走を防げず、2だけでは同一tickの再送を防げないため、
// 両方が要る。ここでは 2 をlistenerの再起動(=キャッシュ空の新インスタンス)で代替検証する。
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

vi.mock("tiktok-live-connector", () => ({
  WebcastPushConnection: vi.fn().mockImplementation(function (uniqueId: string, options: unknown) {
    return new MockConnection(uniqueId, options);
  }),
}));

vi.mock("./overlay", () => ({ emitOverlaySnapshot: vi.fn().mockResolvedValue(undefined) }));

let seq = 0;
function suffix() {
  seq += 1;
  return `${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 8)}`;
}

// msgIdはprotobufのint64相当。resolveMsgId()が"0"や非数値を弾くので、実IDらしい値を使う。
function newMsgId() {
  seq += 1;
  return `76766394758792${String(10000 + seq).slice(-5)}`;
}

async function setupRoom(label: string) {
  const tiktokId = `itest_gdedup_${label}_${suffix()}`;
  const user = await prisma.user.create({
    data: { email: `itest-gdedup-${label}-${suffix()}@local.test` },
  });
  const streamer = await prisma.streamer.create({
    data: {
      userId: user.id,
      tiktokId,
      verificationCode: `itest-${suffix()}`,
      verified: true,
    },
  });
  const roomId = await resolveRoomForStreamer(streamer.id);
  await startListener(roomId, tiktokId, [streamer.id]);
  const conn = MockConnection.instances[MockConnection.instances.length - 1];
  expect(conn).toBeDefined();
  return { tiktokId, userId: user.id, streamerId: streamer.id, roomId, conn };
}

async function teardownRoom(ctx: { roomId: string; userId: string }) {
  await stopListener(ctx.roomId);
  await prisma.user.delete({ where: { id: ctx.userId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: ctx.roomId } }).catch(() => {});
}

// giftType=0(=combo無し)。non-comboの保存パスは無条件にinsertするので、dedupが無いと素通りする。
function nonComboGift(msgId: string | null, createTime: number, overrides: Record<string, unknown> = {}) {
  return {
    uniqueId: "user_dedup",
    nickname: "重複テスト",
    giftType: 0,
    giftId: 5655,
    giftName: "Heart Me",
    repeatCount: 1,
    diamondCount: 1,
    createTime,
    ...(msgId === null ? {} : { msgId }),
    ...overrides,
  };
}

async function giftCount(roomId: string) {
  return prisma.gift.count({ where: { roomId } });
}

beforeEach(() => {
  MockConnection.instances.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ギフトのmsgId dedup", () => {
  it("同じmsgIdのnon-comboギフトが同一tickに2回届いてもGift行は1件だけ", async () => {
    const ctx = await setupRoom("same-tick");
    try {
      const msgId = newMsgId();
      const createTime = Date.now();

      // awaitを挟まず連続で発火する。saveGift()のDB照会は非同期なので、
      // インスタンス内FIFOが無いと双方が「まだ無い」を見て2行入る。
      ctx.conn.fire("gift", nonComboGift(msgId, createTime));
      ctx.conn.fire("gift", nonComboGift(msgId, createTime));

      await vi.waitFor(async () => {
        expect(await giftCount(ctx.roomId)).toBe(1);
      });
      // 遅れて2件目が入らないことも確認する。
      await new Promise((r) => setTimeout(r, 200));
      expect(await giftCount(ctx.roomId)).toBe(1);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("プロセスが違っても(=インスタンス内FIFOが空でも)DB照会で弾かれる", async () => {
    const ctx = await setupRoom("cross-process");
    try {
      const msgId = newMsgId();
      const createTime = Date.now();

      ctx.conn.fire("gift", nonComboGift(msgId, createTime));
      await vi.waitFor(async () => {
        expect(await giftCount(ctx.roomId)).toBe(1);
      });

      // listenerを張り直すとrecentGiftMsgIdsが空の新インスタンスになる。
      // デプロイ中に新Workerが同じ部屋へ接続した状況と同じ。
      await stopListener(ctx.roomId);
      await startListener(ctx.roomId, ctx.tiktokId, [ctx.streamerId]);
      const fresh = MockConnection.instances[MockConnection.instances.length - 1];
      expect(fresh).not.toBe(ctx.conn);

      fresh.fire("gift", nonComboGift(msgId, createTime));
      await new Promise((r) => setTimeout(r, 300));
      expect(await giftCount(ctx.roomId)).toBe(1);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("時刻窓(5分)より古い同一msgIdは弾かない — 将来の再利用でデータを落とさないため", async () => {
    const ctx = await setupRoom("window");
    try {
      const msgId = newMsgId();
      const base = Date.now();

      ctx.conn.fire("gift", nonComboGift(msgId, base));
      await vi.waitFor(async () => {
        expect(await giftCount(ctx.roomId)).toBe(1);
      });

      await stopListener(ctx.roomId);
      await startListener(ctx.roomId, ctx.tiktokId, [ctx.streamerId]);
      const fresh = MockConnection.instances[MockConnection.instances.length - 1];

      // 10分後の同一msgId。窓の外なので正当なギフトとして保存される。
      fresh.fire("gift", nonComboGift(msgId, base + 10 * 60_000));
      await vi.waitFor(async () => {
        expect(await giftCount(ctx.roomId)).toBe(2);
      });
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("msgIdが取れないギフトは従来どおり2回とも保存される(dedupキーが無いだけで実際に届いている)", async () => {
    const ctx = await setupRoom("no-msgid");
    try {
      const createTime = Date.now();
      // protobufの既定値"0"はresolveMsgId()がnullに倒す。
      ctx.conn.fire("gift", nonComboGift("0", createTime, { orderId: null, groupId: null }));
      await vi.waitFor(async () => {
        expect(await giftCount(ctx.roomId)).toBe(1);
      });
      ctx.conn.fire("gift", nonComboGift(null, createTime, { orderId: null, groupId: null }));

      await vi.waitFor(async () => {
        expect(await giftCount(ctx.roomId)).toBe(2);
      });
      const rows = await prisma.gift.findMany({ where: { roomId: ctx.roomId } });
      expect(rows.every((r) => r.msgId === null)).toBe(true);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("comboの積み増しは弾かれない(段階ごとにmsgIdが別なので)", async () => {
    const ctx = await setupRoom("combo");
    try {
      const groupId = `g_${suffix()}`;
      const createTime = Date.now();
      const combo = (msgId: string, repeatCount: number, repeatEnd: boolean) => ({
        uniqueId: "user_combo",
        nickname: "コンボ",
        giftType: 1,
        giftId: 5655,
        giftName: "Rose",
        diamondCount: 1,
        groupId,
        repeatCount,
        repeatEnd,
        msgId,
        createTime,
      });

      ctx.conn.fire("gift", combo(newMsgId(), 1, false));
      await vi.waitFor(async () => {
        expect(await giftCount(ctx.roomId)).toBe(1);
      });
      ctx.conn.fire("gift", combo(newMsgId(), 3, false));
      await vi.waitFor(async () => {
        expect(await giftCount(ctx.roomId)).toBe(2);
      });
      ctx.conn.fire("gift", combo(newMsgId(), 5, true));
      await vi.waitFor(async () => {
        expect(await giftCount(ctx.roomId)).toBe(3);
      });

      // deltaの合計 = 最終repeatCount。二重計上も取りこぼしも無いことの確認。
      const rows = await prisma.gift.findMany({ where: { roomId: ctx.roomId } });
      expect(rows.reduce((sum, r) => sum + r.repeatCount, 0)).toBe(5);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("同じmsgIdでも部屋が違えば別イベントとして保存される", async () => {
    const a = await setupRoom("room-a");
    const b = await setupRoom("room-b");
    try {
      const msgId = newMsgId();
      const createTime = Date.now();

      a.conn.fire("gift", nonComboGift(msgId, createTime));
      b.conn.fire("gift", nonComboGift(msgId, createTime));

      await vi.waitFor(async () => {
        expect(await giftCount(a.roomId)).toBe(1);
        expect(await giftCount(b.roomId)).toBe(1);
      });
    } finally {
      await teardownRoom(a);
      await teardownRoom(b);
    }
  });
});
