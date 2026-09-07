// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// chat受信からListenerComment保存までを検証する(saveListenerComment()はexportされて
// いない内部関数のため、実際のイベント発火経由で確認する)。
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "./prisma";
import { startListener, stopListener } from "./tiktok-listener";
import { resolveRoomForStreamer } from "./tiktok-room";

const { MockConnection } = vi.hoisted(() => {
  class MockConnection {
    static instances: MockConnection[] = [];
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};
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

vi.mock("./tiktok-existence", () => ({
  existenceChecker: {
    check: vi.fn().mockResolvedValue({ verdict: "UNVERIFIED", nickname: null, userId: null }),
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
  const tiktokId = `itest_lc_${label}_${suffix()}`;
  const user = await prisma.user.create({
    data: { email: `itest-lc-${label}-${suffix()}@local.test` },
  });
  const streamer = await prisma.streamer.create({
    data: { userId: user.id, tiktokId, verificationCode: `itest-${suffix()}`, verified: true },
  });
  const roomId = await resolveRoomForStreamer(streamer.id);
  await startListener(roomId, tiktokId, [streamer.id]);
  const conn = MockConnection.instances[MockConnection.instances.length - 1];
  expect(conn).toBeDefined();
  return { tiktokId, userId: user.id, streamerId: streamer.id, roomId, conn };
}

async function teardownRoom(ctx: { roomId: string; userId: string }) {
  await stopListener(ctx.roomId);
  await prisma.listenerComment.deleteMany({ where: { roomId: ctx.roomId } });
  await prisma.user.delete({ where: { id: ctx.userId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: ctx.roomId } }).catch(() => {});
}

function chatEvent(msgId: string | null, comment: string) {
  return {
    uniqueId: "listener_a",
    nickname: "リスナーA",
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
      expect(row.uniqueId).toBe("listener_a");
      expect(row.nickname).toBe("リスナーA");
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
