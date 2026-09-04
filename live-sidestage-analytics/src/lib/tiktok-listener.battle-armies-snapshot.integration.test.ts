// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// linkMicArmies/linkMicBattle受信時のTiktokBattleArmiesSnapshot(スコア時系列)書込みを検証する。
//   1. スコアが変化したanchorId分だけ行が追記される(無変化イベントでは増えない)
//   2. 同一battleIdで複数回スコアが変わると、上書きではなく追記で履歴が残る
//   3. スナップショット書込みが失敗しても、TiktokBattle本体の保存・後続処理は失われない
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

vi.mock("./overlay", () => ({
  emitOverlaySnapshot: vi.fn().mockResolvedValue(undefined),
  emitGiftDrivenOverlayUpdates: vi.fn().mockResolvedValue(undefined),
}));

let seq = 0;
function suffix() {
  seq += 1;
  return `${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 8)}`;
}

async function setupRoom(label: string) {
  const tiktokId = `itest_armies_${label}_${suffix()}`;
  const user = await prisma.user.create({
    data: { email: `itest-armies-${label}-${suffix()}@local.test` },
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

function armiesPayload(battleId: string, scores: Record<string, string>) {
  return {
    battleId,
    battleSettings: { startTimeMs: String(Date.now() - 1000), duration: 300 },
    battleItems: Object.fromEntries(
      Object.entries(scores).map(([anchorId, hostScore]) => [anchorId, { anchorIdStr: anchorId, hostScore }])
    ),
  };
}

// BATTLE_ACTION.OPEN=4 / FINISH=5 (tiktok-battle.ts参照)。linkMicBattleはこちらの形。
function battlePayload(battleId: string, action: number, scores: Record<string, string>) {
  return {
    battleId,
    action,
    battleSetting: { startTimeMs: String(Date.now() - 5000), duration: 300 },
    armies: Object.fromEntries(
      Object.entries(scores).map(([anchorId, hostScore]) => [anchorId, { anchorIdStr: anchorId, hostScore }])
    ),
  };
}

async function snapshotRows(roomId: string, battleId: string) {
  return prisma.tiktokBattleArmiesSnapshot.findMany({ where: { roomId, battleId } });
}

beforeEach(() => {
  MockConnection.instances.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("バトルスコア時系列(TiktokBattleArmiesSnapshot)の収集", () => {
  it("linkMicArmiesイベントのhostScoresが行として保存される", async () => {
    const ctx = await setupRoom("basic");
    try {
      const battleId = "7400000000000000001";
      ctx.conn.fire("linkMicArmies", armiesPayload(battleId, { "111": "5000", "222": "4200" }));

      await vi.waitFor(async () => {
        expect(await snapshotRows(ctx.roomId, battleId)).toHaveLength(2);
      });
      const rows = await snapshotRows(ctx.roomId, battleId);
      const byAnchor = Object.fromEntries(rows.map((r) => [r.anchorId, r.score]));
      expect(byAnchor).toEqual({ "111": "5000", "222": "4200" });
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("同一battleIdでスコアが変化するたびに追記され、履歴として両方残る", async () => {
    const ctx = await setupRoom("history");
    try {
      const battleId = "7400000000000000002";
      ctx.conn.fire("linkMicArmies", armiesPayload(battleId, { "111": "1000" }));
      await vi.waitFor(async () => {
        expect(await snapshotRows(ctx.roomId, battleId)).toHaveLength(1);
      });

      ctx.conn.fire("linkMicArmies", armiesPayload(battleId, { "111": "2000" }));
      await vi.waitFor(async () => {
        expect(await snapshotRows(ctx.roomId, battleId)).toHaveLength(2);
      });

      const rows = await snapshotRows(ctx.roomId, battleId);
      expect(rows.map((r) => r.score).sort()).toEqual(["1000", "2000"]);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("同じスコアのイベントが続いても行が増えない(変化点フィルタ)", async () => {
    const ctx = await setupRoom("no-dup");
    try {
      const battleId = "7400000000000000003";
      ctx.conn.fire("linkMicArmies", armiesPayload(battleId, { "111": "3000" }));
      await vi.waitFor(async () => {
        expect(await snapshotRows(ctx.roomId, battleId)).toHaveLength(1);
      });

      ctx.conn.fire("linkMicArmies", armiesPayload(battleId, { "111": "3000" }));
      // 変化が無いことの確認なので、増えていないことを一定時間後に確認する。
      await new Promise((r) => setTimeout(r, 300));
      expect(await snapshotRows(ctx.roomId, battleId)).toHaveLength(1);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("スナップショット書込みが失敗してもTiktokBattle本体の保存は失われない", async () => {
    const ctx = await setupRoom("write-fail");
    try {
      const battleId = "7400000000000000004";
      const spy = vi
        .spyOn(prisma.tiktokBattleArmiesSnapshot, "createMany")
        .mockRejectedValueOnce(new Error("simulated write failure"));

      ctx.conn.fire("linkMicArmies", armiesPayload(battleId, { "111": "9000" }));

      await vi.waitFor(async () => {
        const battle = await prisma.tiktokBattle.findUnique({
          where: { roomId_battleId: { roomId: ctx.roomId, battleId } },
        });
        expect(battle).not.toBeNull();
        expect((battle?.hostScores as Record<string, string> | null)?.["111"]).toBe("9000");
      });

      // 失敗させた1回分の行は残らないが、後続の同一イベントで正常に復帰することを確認。
      spy.mockRestore();
      ctx.conn.fire("linkMicArmies", armiesPayload(battleId, { "111": "9500" }));
      await vi.waitFor(async () => {
        const rows = await snapshotRows(ctx.roomId, battleId);
        expect(rows.some((r) => r.score === "9500")).toBe(true);
      });
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("バトル終了(FINISH)イベントでスナップショット書込みが失敗しても、persistBattle自体はrejectせず終了通知経路まで完走する", async () => {
    const ctx = await setupRoom("end-transition-write-fail");
    try {
      const battleId = "7400000000000000005";
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const writeSpy = vi
        .spyOn(prisma.tiktokBattleArmiesSnapshot, "createMany")
        .mockRejectedValue(new Error("simulated write failure"));

      // OPEN: バトル開始
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 4, { "111": "1000" }));
      await vi.waitFor(async () => {
        const battle = await prisma.tiktokBattle.findUnique({
          where: { roomId_battleId: { roomId: ctx.roomId, battleId } },
        });
        expect(battle?.action).toBe(4);
      });

      // FINISH: バトル終了。スナップショット書込みは常に失敗する設定のまま。
      ctx.conn.fire("linkMicBattle", battlePayload(battleId, 5, { "111": "2000" }));
      await vi.waitFor(async () => {
        const battle = await prisma.tiktokBattle.findUnique({
          where: { roomId_battleId: { roomId: ctx.roomId, battleId } },
        });
        expect(battle?.endedAt).not.toBeNull();
      });

      // 自前のcatch(「armies snapshot write failed」)は呼ばれるが、
      // createWriteQueue側の「queued write failed」(=persistBattle自体がreject)は呼ばれない。
      // これが呼ばれていたら、END遷移の通知・履歴確定が失われている状態を意味する。
      const queueRejectionLogged = errorSpy.mock.calls.some((args) =>
        String(args[0]).includes("queued write failed")
      );
      expect(queueRejectionLogged).toBe(false);
      const snapshotFailureLogged = errorSpy.mock.calls.some((args) =>
        String(args[0]).includes("armies snapshot write failed")
      );
      expect(snapshotFailureLogged).toBe(true);

      writeSpy.mockRestore();
      errorSpy.mockRestore();
    } finally {
      await teardownRoom(ctx);
    }
  });
});
