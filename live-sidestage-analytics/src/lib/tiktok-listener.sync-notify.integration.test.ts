// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// Batch02: 貢献ランキング/ギフト履歴/バトル履歴のWorker→Web syncTrigger転送を検証する。
// - ギフト保存(DB commit)成功後にのみgift-history/rankingのsyncTriggerが仕掛かること
// - 購読者が複数でも1件のtrigger(giftId/battleId単位)につき1リクエストであること
//   (streamerIdごとの個別HTTPリクエストにしない、というdesign-review反映2の要件)
// - バトルは"ended"だけでなく"score_updated"でもbattle-history syncTriggerが発火すること
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";

// isWorkerProcess は WEB_INTERNAL_URL の有無でモジュール読み込み時に決まる。
vi.hoisted(() => {
  process.env.WEB_INTERNAL_URL = "http://web.internal.test";
  process.env.INTERNAL_API_SECRET = "itest-sync-notify-secret";
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

vi.mock("TLC-sidestage", async () => {
  const actual = await vi.importActual<typeof import("TLC-sidestage")>("TLC-sidestage");
  return {
    ...actual,
    WebcastPushConnection: vi.fn().mockImplementation(function (tiktokHandle: string, options: unknown) {
      return new MockConnection(tiktokHandle, options);
    }),
  };
});

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

function newMsgId() {
  seq += 1;
  return `76766394758791${String(10000 + seq).slice(-5)}`;
}

/** 同じ tiktokHandle を購読する Streamer を subscriberCount 人ぶん作り、listener を張る。 */
async function setupRoom(label: string, subscriberCount: number) {
  const tiktokHandle = `itest_syncnotify_${label}_${suffix()}`;
  const principalIds: string[] = [];
  const streamerIds: string[] = [];
  for (let i = 0; i < subscriberCount; i++) {
    const user = await prisma.principal.create({
      data: { email: `itest-syncnotify-${label}-${suffix()}@local.test` },
    });
    const streamer = await prisma.streamer.create({
      data: {
        principalId: user.id,
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

function nonComboGift(msgId: string, createTime: number) {
  return {
    userId: makeTiktokUid("user_sync"),
    uniqueId: "user_sync",
    nickname: "同期テスト",
    giftType: 0,
    giftId: 5655,
    giftName: "Heart Me",
    repeatCount: 1,
    diamondCount: 1,
    createTime,
    msgId,
  };
}

/** BATTLE_ACTION.OPEN=4 / FINISH=5 (tiktok-battle.ts参照)。linkMicBattleの形。 */
function battlePayload(battleId: string, action: number, scores: Record<string, string>) {
  return {
    battleId,
    action,
    battleSetting: { startTimeMs: String(Date.now() - 5000), duration: 300 },
    armies: Object.fromEntries(
      Object.entries(scores).map(([tiktokUid, hostScore]) => [tiktokUid, { anchorIdStr: tiktokUid, hostScore }])
    ),
  };
}

function syncCalls(fetchMock: ReturnType<typeof vi.fn>, syncTrigger: string) {
  return fetchMock.mock.calls.filter((call) => {
    const body = JSON.parse(String((call[1] as { body: string }).body));
    return body.syncTrigger === syncTrigger;
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

describe("ギフト履歴/ランキングのWorker→Web syncTrigger転送", () => {
  it("ギフト保存成功後にgift-history syncTriggerが送られ、購読者が複数でも1リクエストにまとまる", async () => {
    const ctx = await setupRoom("gift-history", 3);
    try {
      ctx.conn.fire("gift", nonComboGift(newMsgId(), Date.now()));

      await vi.waitFor(() => {
        expect(syncCalls(fetchMock, "gift-history")).toHaveLength(1);
      });
      await new Promise((r) => setTimeout(r, 200));
      const calls = syncCalls(fetchMock, "gift-history");
      expect(calls).toHaveLength(1);

      const body = JSON.parse(String((calls[0][1] as { body: string }).body));
      expect([...body.streamerIds].sort()).toEqual([...ctx.streamerIds].sort());
      expect(typeof body.giftId).toBe("string");
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("ギフト保存成功後にranking syncTriggerも送られる(drop許容側)", async () => {
    const ctx = await setupRoom("ranking", 2);
    try {
      ctx.conn.fire("gift", nonComboGift(newMsgId(), Date.now()));

      await vi.waitFor(() => {
        expect(syncCalls(fetchMock, "ranking")).toHaveLength(1);
      });
      const calls = syncCalls(fetchMock, "ranking");
      const body = JSON.parse(String((calls[0][1] as { body: string }).body));
      expect([...body.streamerIds].sort()).toEqual([...ctx.streamerIds].sort());
      expect(body.roomId).toBe(ctx.roomId);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("gift-history syncTriggerの転送が失敗しても有限回(3回)でリトライを打ち切る", async () => {
    const ctx = await setupRoom("gift-history-retry", 1);
    try {
      fetchMock.mockImplementation(async (url: string, opts: { body: string }) => {
        const body = JSON.parse(opts.body);
        if (body.syncTrigger === "gift-history") {
          return { ok: false, status: 500, text: async () => "boom" };
        }
        return { ok: true, status: 200, text: async () => "" };
      });
      ctx.conn.fire("gift", nonComboGift(newMsgId(), Date.now()));

      await vi.waitFor(
        () => {
          expect(syncCalls(fetchMock, "gift-history")).toHaveLength(3);
        },
        { timeout: 10000 }
      );
      // 打ち切り後、追撃が飛ばないこと。
      await new Promise((r) => setTimeout(r, 500));
      expect(syncCalls(fetchMock, "gift-history")).toHaveLength(3);
    } finally {
      await teardownRoom(ctx);
    }
  }, 15000);
});

describe("バトル履歴のWorker→Web syncTrigger転送", () => {
  it("バトル終了(ended)でbattle-history syncTriggerが送られ、購読者が複数でも1リクエストにまとまる", async () => {
    const ctx = await setupRoom("battle-ended", 2);
    try {
      const battleId = `7400000000000${suffix().replace(/\D/g, "").slice(0, 6)}`;
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 4, { "111": "1000" }));
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 5, { "111": "2000" }));

      await vi.waitFor(() => {
        expect(syncCalls(fetchMock, "battle-history")).toHaveLength(1);
      });
      const calls = syncCalls(fetchMock, "battle-history");
      const body = JSON.parse(String((calls[0][1] as { body: string }).body));
      expect([...body.streamerIds].sort()).toEqual([...ctx.streamerIds].sort());
      expect(body.battleId).toBe(battleId);
      expect(body.roomId).toBe(ctx.roomId);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("ended後のスコア訂正(score_updated)でもbattle-history syncTriggerが追加で発火する", async () => {
    const ctx = await setupRoom("battle-score-updated", 1);
    try {
      const battleId = `7400000000000${suffix().replace(/\D/g, "").slice(0, 6)}`;
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 4, { "111": "1000" }));
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 5, { "111": "2000" }));

      await vi.waitFor(() => {
        expect(syncCalls(fetchMock, "battle-history")).toHaveLength(1);
      });

      // END後にスコアが変わって再送信される(訂正)。
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 5, { "111": "3000" }));

      await vi.waitFor(() => {
        expect(syncCalls(fetchMock, "battle-history")).toHaveLength(2);
      });
    } finally {
      await teardownRoom(ctx);
    }
  });
});
