// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// バトル中の like からタップ点(TiktokBattleTapPoint)を集計する経路を検証する。
//   1. 同じリスナーの like が10回に達した時点で1行だけ立つ(以降は増えない)
//   2. バトル終了まで取りこぼしなく観測できたら TiktokBattle.tapPointsTracked が true になる
//   3. 書込みが1件でも失敗したら tapPointsTracked は false のまま(差し引きを適用させない)
//   4. バトル外の like は集計しない
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

vi.mock("TLC-sidestage", async () => {
  const actual = await vi.importActual<typeof import("TLC-sidestage")>("TLC-sidestage");
  return {
    ...actual,
    WebcastPushConnection: vi.fn().mockImplementation(function (uniqueId: string, options: unknown) {
      return new MockConnection(uniqueId, options);
    }),
  };
});

vi.mock("./tiktok-existence", () => ({
  existenceChecker: {
    check: vi.fn().mockResolvedValue({ verdict: "UNVERIFIED", nickname: null, userId: null }),
  },
}));

vi.mock("./overlay", () => ({
  emitOverlaySnapshot: vi.fn().mockResolvedValue(undefined),
  emitGiftDrivenOverlayUpdates: vi.fn().mockResolvedValue(undefined),
}));

const SELF_ANCHOR = "111";
const OPPONENT_ANCHOR = "222";

let seq = 0;
function suffix() {
  seq += 1;
  return `${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 8)}`;
}

async function setupRoom(label: string) {
  const tiktokId = `itest_tap_${label}_${suffix()}`;
  const user = await prisma.user.create({
    data: { email: `itest-tap-${label}-${suffix()}@local.test` },
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
  await prisma.user.delete({ where: { id: ctx.userId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: ctx.roomId } }).catch(() => {});
}

// BATTLE_ACTION.OPEN=4 / FINISH=5。anchorInfo が無いと自分の anchorId を解決できず集計が始まらない。
function battlePayload(battleId: string, action: number, tiktokId: string) {
  return {
    battleId,
    action,
    battleSetting: { startTimeMs: String(Date.now() - 5000), duration: 300 },
    armies: {
      [SELF_ANCHOR]: { anchorIdStr: SELF_ANCHOR, hostScore: "1000" },
      [OPPONENT_ANCHOR]: { anchorIdStr: OPPONENT_ANCHOR, hostScore: "900" },
    },
    anchorInfo: [
      { user: { userId: SELF_ANCHOR, displayId: tiktokId, nickName: "self" } },
      { user: { userId: OPPONENT_ANCHOR, displayId: "someone_else", nickName: "opponent" } },
    ],
  };
}

function fireLikes(conn: { fire: (e: string, p?: unknown) => void }, uniqueId: string, times: number) {
  for (let i = 0; i < times; i += 1) {
    conn.fire("like", { uniqueId, nickname: uniqueId, likeCount: 1, msgId: `${uniqueId}-${suffix()}-${i}` });
  }
}

async function tapRows(roomId: string, battleId: string) {
  return prisma.tiktokBattleTapPoint.findMany({ where: { roomId, battleId } });
}

async function battleRow(roomId: string, battleId: string) {
  return prisma.tiktokBattle.findUnique({ where: { roomId_battleId: { roomId, battleId } } });
}

beforeEach(() => {
  MockConnection.instances.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("バトル中のタップ点(TiktokBattleTapPoint)の収集", () => {
  it("10タップ到達で1行だけ立ち、以降の like では増えない", async () => {
    const ctx = await setupRoom("threshold");
    try {
      const battleId = "7410000000000000001";
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 4, ctx.tiktokId));

      fireLikes(ctx.conn, "listener_a", 9);
      await new Promise((r) => setTimeout(r, 200));
      expect(await tapRows(ctx.roomId, battleId)).toHaveLength(0);

      fireLikes(ctx.conn, "listener_a", 1);
      await vi.waitFor(async () => {
        expect(await tapRows(ctx.roomId, battleId)).toHaveLength(1);
      });
      const [row] = await tapRows(ctx.roomId, battleId);
      expect(row.points).toBe(3);
      expect(row.anchorId).toBe(SELF_ANCHOR);
      expect(row.uniqueId).toBe("listener_a");

      // 到達済みリスナーの追加 like は行を増やさない(1人1回の上限)。
      fireLikes(ctx.conn, "listener_a", 20);
      await new Promise((r) => setTimeout(r, 200));
      expect(await tapRows(ctx.roomId, battleId)).toHaveLength(1);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("バトル終了まで観測できたら tapPointsTracked が true になる", async () => {
    const ctx = await setupRoom("tracked");
    try {
      const battleId = "7410000000000000002";
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 4, ctx.tiktokId));
      fireLikes(ctx.conn, "listener_b", 10);
      await vi.waitFor(async () => {
        expect(await tapRows(ctx.roomId, battleId)).toHaveLength(1);
      });

      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 5, ctx.tiktokId));
      await vi.waitFor(async () => {
        expect((await battleRow(ctx.roomId, battleId))?.tapPointsTracked).toBe(true);
      });
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("タップ点が0件でも、バトル終了まで観測できていれば tracked になる", async () => {
    const ctx = await setupRoom("tracked-empty");
    try {
      const battleId = "7410000000000000003";
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 4, ctx.tiktokId));
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 5, ctx.tiktokId));
      await vi.waitFor(async () => {
        expect((await battleRow(ctx.roomId, battleId))?.tapPointsTracked).toBe(true);
      });
      expect(await tapRows(ctx.roomId, battleId)).toHaveLength(0);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("タップ点の書込みが失敗したら tapPointsTracked は false のまま", async () => {
    const ctx = await setupRoom("write-fail");
    try {
      const battleId = "7410000000000000004";
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const writeSpy = vi
        .spyOn(prisma.tiktokBattleTapPoint, "createMany")
        .mockRejectedValue(new Error("simulated tap point write failure"));

      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 4, ctx.tiktokId));
      fireLikes(ctx.conn, "listener_c", 10);
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 5, ctx.tiktokId));

      await vi.waitFor(async () => {
        expect((await battleRow(ctx.roomId, battleId))?.endedAt).not.toBeNull();
      });
      // 書込み失敗のログは出るが、確定フラグは立たない(= 逆算側は差し引かない)。
      await new Promise((r) => setTimeout(r, 200));
      expect((await battleRow(ctx.roomId, battleId))?.tapPointsTracked).toBe(false);
      expect(errorSpy.mock.calls.some((args) => String(args[0]).includes("tap point write failed"))).toBe(true);

      writeSpy.mockRestore();
      errorSpy.mockRestore();
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("バトル外の like は集計しない", async () => {
    const ctx = await setupRoom("outside");
    try {
      const battleId = "7410000000000000005";
      fireLikes(ctx.conn, "listener_d", 15);
      await new Promise((r) => setTimeout(r, 200));
      expect(await tapRows(ctx.roomId, battleId)).toHaveLength(0);

      // バトル開始後は改めて0からカウントする(開始前の15回は持ち越さない)。
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 4, ctx.tiktokId));
      fireLikes(ctx.conn, "listener_d", 9);
      await new Promise((r) => setTimeout(r, 200));
      expect(await tapRows(ctx.roomId, battleId)).toHaveLength(0);
    } finally {
      await teardownRoom(ctx);
    }
  });
});
