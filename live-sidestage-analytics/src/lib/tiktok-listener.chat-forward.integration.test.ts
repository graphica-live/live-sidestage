// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// Worker→Web のコメント転送を検証する。
//
// 転送スロット(FORWARD_MAX_CONCURRENCY/FORWARD_MAX_QUEUE)は worker プロセス全体の
// 共有枠で、溢れた分は無言で捨てられる。chat だけ購読者ごとにHTTPを撃っていた頃は
// like/gift に押し出されてコメントが落ちていたため、「購読者が何人でも1リクエスト」を
// ここで固定する。
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";

// isWorkerProcess は WEB_INTERNAL_URL の有無でモジュール読み込み時に決まる。
// import より先に立てる必要があるので vi.hoisted を使う。
vi.hoisted(() => {
  process.env.WEB_INTERNAL_URL = "http://web.internal.test";
  process.env.INTERNAL_API_SECRET = "itest-chat-forward-secret";
});

import { prisma } from "./prisma";
import { makeTiktokUid } from "./__fixtures__/gift";
import { startListener, stopListener } from "./tiktok-listener";
import { resolveRoomForStreamer } from "./tiktok-room";

const { MockConnection } = vi.hoisted(() => {
  class MockConnection {
    static instances: MockConnection[] = [];
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};
    clientParams: Record<string, string> = {};
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

/** 同じ tiktokHandle を購読する Streamer を subscriberCount 人ぶん作り、listener を張る。 */
async function setupRoom(label: string, subscriberCount: number) {
  const tiktokHandle = `itest_chatfwd_${label}_${suffix()}`;
  const principalIds: string[] = [];
  const streamerIds: string[] = [];
  for (let i = 0; i < subscriberCount; i++) {
    const user = await prisma.principal.create({
      data: { email: `itest-chatfwd-${label}-${suffix()}@local.test` },
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
    principalIds.push(user.id);
    streamerIds.push(streamer.id);
  }
  const roomId = await resolveRoomForStreamer(streamerIds[0]);
  await startListener(roomId, tiktokHandle, streamerIds);
  const conn = MockConnection.instances[MockConnection.instances.length - 1];
  expect(conn).toBeDefined();
  return { tiktokHandle, principalIds, streamerIds, roomId, conn };
}

async function teardownRoom(ctx: { roomId: string; principalIds: string[] }) {
  await stopListener(ctx.roomId);
  for (const principalId of ctx.principalIds) {
    await prisma.principal.delete({ where: { id: principalId } }).catch(() => {});
  }
  await prisma.tiktokRoom.delete({ where: { id: ctx.roomId } }).catch(() => {});
}

// TLC の生 payload。キー名は TikTok 側の仕様(userId / uniqueId)で、
// sidestage の語彙(tiktokUid / tiktokHandle)へ変換するのは tiktok-listener.ts の仕事。
function chatEvent(msgId: string | null, comment: string) {
  return {
    userId: makeTiktokUid("listener_a"),
    uniqueId: "listener_a",
    nickname: "リスナーA",
    comment,
    createTime: Date.now(),
    // protobufの既定値 "0" は resolveMsgId() が null に倒す。
    msgId: msgId === null ? "0" : msgId,
  };
}

/** chat の転送だけを拾う(同じ部屋の他イベントが混ざっても数を狂わせない)。 */
function chatCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((call) => {
    const body = JSON.parse(String((call[1] as { body: string }).body));
    return body.chatCommentEvent !== undefined;
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  MockConnection.instances.length = 0;
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

describe("コメントのWorker→Web転送", () => {
  it("購読者が3人でも1コメントの転送は1リクエストで、全員分のstreamerIdを含む", async () => {
    const ctx = await setupRoom("batch", 3);
    try {
      ctx.conn.fire("chat", chatEvent(newMsgId(), "まとめ送信の確認"));

      await vi.waitFor(() => {
        expect(chatCalls(fetchMock)).toHaveLength(1);
      });
      // 遅れて購読者ぶんの追撃が飛ばないことも確認する。
      await new Promise((r) => setTimeout(r, 200));
      const calls = chatCalls(fetchMock);
      expect(calls).toHaveLength(1);

      const body = JSON.parse(String((calls[0][1] as { body: string }).body));
      expect([...body.streamerIds].sort()).toEqual([...ctx.streamerIds].sort());
      expect(body.chatCommentEvent.comment).toBe("まとめ送信の確認");
      // 単数形(streamerId込みの旧形式)は送らない。
      expect(body.chatEvent).toBeUndefined();
      expect(body.chatCommentEvent.streamerId).toBeUndefined();
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("転送が失敗したコメントは1回だけ再送する", async () => {
    const ctx = await setupRoom("retry", 1);
    try {
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      ctx.conn.fire("chat", chatEvent(newMsgId(), "再送の確認"));

      await vi.waitFor(() => {
        expect(chatCalls(fetchMock)).toHaveLength(2);
      });
      // 2回目が成功したらそこで打ち切る(無限再送しない)。
      await new Promise((r) => setTimeout(r, 200));
      expect(chatCalls(fetchMock)).toHaveLength(2);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("Webが5xxを返したときも1回だけ再送する", async () => {
    const ctx = await setupRoom("retry-5xx", 1);
    try {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
      ctx.conn.fire("chat", chatEvent(newMsgId(), "5xx再送の確認"));

      await vi.waitFor(() => {
        expect(chatCalls(fetchMock)).toHaveLength(2);
      });
      await new Promise((r) => setTimeout(r, 200));
      expect(chatCalls(fetchMock)).toHaveLength(2);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("msgIdが無いコメントは再送しない — Web側のdedupが効かず二重に読み上げられるため", async () => {
    const ctx = await setupRoom("no-msgid", 1);
    try {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      ctx.conn.fire("chat", chatEvent(null, "msgId無しの確認"));

      await vi.waitFor(() => {
        expect(chatCalls(fetchMock)).toHaveLength(1);
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(chatCalls(fetchMock)).toHaveLength(1);
    } finally {
      await teardownRoom(ctx);
    }
  });
});
