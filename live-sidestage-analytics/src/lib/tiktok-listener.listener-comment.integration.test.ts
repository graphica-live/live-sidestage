// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// chat受信からListenerComment保存までを検証する(saveListenerComment()はexportされて
// いない内部関数のため、実際のイベント発火経由で確認する)。
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "./prisma";
import { makeListenerIdentity, makeTiktokUid } from "./__fixtures__/gift";
import { startListener, stopListener } from "./tiktok-listener";
import { resolveRoomForStreamer } from "./tiktok-room";

const { MockConnection } = vi.hoisted(() => {
  class MockConnection {
    static instances: MockConnection[] = [];
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};
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

vi.mock("./overlay", () => ({
  emitOverlaySnapshot: vi.fn().mockResolvedValue(undefined),
  emitGiftDrivenOverlayUpdates: vi.fn().mockResolvedValue(undefined),
}));

let seq = 0;
function suffix() {
  seq += 1;
  return `${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 8)}`;
}

// msgIdはprotobufのint64相当。resolveMsgId()が"0"や非数値を弾くので、実IDらしい値を使う。
function newMsgId() {
  seq += 1;
  return `76766394758793${String(10000 + seq).slice(-5)}`;
}

async function setupRoom(label: string) {
  const tiktokHandle = `itest_lc_${label}_${suffix()}`;
  const user = await prisma.user.create({
    data: { email: `itest-lc-${label}-${suffix()}@local.test` },
  });
  const streamer = await prisma.streamer.create({
    data: {
      principalId: user.id,
      // room の同一性は uid。ハンドルから決定的に導いて「同じハンドル = 同じ配信者」を保つ。
      tiktokUid: makeTiktokUid(tiktokHandle),
      tiktokHandle,
      verificationCode: `itest-${suffix()}`,
      verified: true,
    },
  });
  const roomId = await resolveRoomForStreamer(streamer.id);
  await startListener(roomId, tiktokHandle, [streamer.id]);
  const conn = MockConnection.instances[MockConnection.instances.length - 1];
  expect(conn).toBeDefined();
  return { tiktokHandle, principalId: user.id, streamerId: streamer.id, roomId, conn };
}

async function teardownRoom(ctx: { roomId: string; principalId: string }) {
  await stopListener(ctx.roomId);
  await prisma.listenerComment.deleteMany({ where: { roomId: ctx.roomId } });
  await prisma.user.delete({ where: { id: ctx.principalId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: ctx.roomId } }).catch(() => {});
}

const LISTENER_A = makeListenerIdentity("listener_a");

// TLC の生 payload。キー名は TikTok 側の仕様(userId / uniqueId)で、
// sidestage の語彙(tiktokUid / tiktokHandle)へ変換するのは tiktok-listener.ts の仕事。
function chatEvent(msgId: string | null, comment: string) {
  return {
    userId: LISTENER_A.tiktokUid,
    uniqueId: LISTENER_A.tiktokHandle,
    nickname: LISTENER_A.nickname,
    comment,
    createTime: Date.now(),
    msgId: msgId === null ? "0" : msgId,
  };
}

beforeEach(() => {
  MockConnection.instances.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("chat受信からListenerComment保存", () => {
  it("chatイベントを受信するとListenerCommentへ保存される", async () => {
    const ctx = await setupRoom("save");
    try {
      ctx.conn.fire("chat", chatEvent(newMsgId(), "保存されるはずのコメント"));

      await vi.waitFor(async () => {
        const row = await prisma.listenerComment.findFirst({
          where: { roomId: ctx.roomId, comment: "保存されるはずのコメント" },
        });
        expect(row).not.toBeNull();
      });

      const row = await prisma.listenerComment.findFirstOrThrow({
        where: { roomId: ctx.roomId, comment: "保存されるはずのコメント" },
      });
      // ListenerComment は表示名を持たない(tiktokUid だけ)。表示名の正本は TikTokUser。
      expect(row.tiktokUid).toBe(LISTENER_A.tiktokUid);
      const user = await prisma.tikTokUser.findUniqueOrThrow({
        where: { tiktokUid: LISTENER_A.tiktokUid },
      });
      expect(user.tiktokHandle).toBe(LISTENER_A.tiktokHandle);
      expect(user.nickname).toBe(LISTENER_A.nickname);
      expect(row.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("エモートのみ(空文字)コメントも空文字のまま保存される", async () => {
    const ctx = await setupRoom("empty");
    try {
      const msgId = newMsgId();
      ctx.conn.fire("chat", chatEvent(msgId, ""));

      await vi.waitFor(async () => {
        const row = await prisma.listenerComment.findFirst({
          where: { roomId: ctx.roomId, msgId },
        });
        expect(row).not.toBeNull();
      });

      const row = await prisma.listenerComment.findFirstOrThrow({ where: { roomId: ctx.roomId, msgId } });
      expect(row.comment).toBe("");
    } finally {
      await teardownRoom(ctx);
    }
  });
});
