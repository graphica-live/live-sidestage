// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// バトル再生の収集側:
//   1. linkMicBattleTask(ボーナスミッション区間)の TiktokBattleBonusMission 書込み
//   2. gift の matchInfo(倍率刻印)を Gift.multiplierType / multiplierValue へ保存
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

let seq = 0;
function suffix() {
  seq += 1;
  return `${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 8)}`;
}

async function setupRoom(label: string) {
  const tiktokId = `itest_task_${label}_${suffix()}`;
  const user = await prisma.user.create({
    data: { email: `itest-task-${label}-${suffix()}@local.test` },
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

function taskStartPayload(battleId: string, overrides: Record<string, unknown> = {}) {
  return {
    battleId,
    battleTaskMessageType: 0,
    taskStart: {
      battleBonusConfig: {
        taskPeriodConfig: { targetType: 1, progressTarget: "3", duration: "30" },
        rewardPeriodConfig: { rewardMultiple: 3, duration: "30" },
      },
    },
    ...overrides,
  };
}

async function missionRows(roomId: string, battleId: string) {
  return prisma.tiktokBattleBonusMission.findMany({ where: { roomId, battleId } });
}

beforeEach(() => {
  MockConnection.instances.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ボーナスミッション区間(TiktokBattleBonusMission)の収集", () => {
  it("taskStart→taskSettle→rewardSettle が1行を順に埋める", async () => {
    const ctx = await setupRoom("lifecycle");
    try {
      const battleId = "7500000000000000001";
      ctx.conn.fire("linkMicBattleTask", taskStartPayload(battleId));
      await vi.waitFor(async () => {
        expect(await missionRows(ctx.roomId, battleId)).toHaveLength(1);
      });
      const created = (await missionRows(ctx.roomId, battleId))[0];
      expect(created.targetType).toBe(1);
      expect(created.progressTarget).toBe(3);
      expect(created.rewardMultiple).toBe(3);
      expect(created.settledAt).toBeNull();

      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 2,
        taskSettle: { taskResult: 2, rewardStartTimestamp: String(Math.floor(Date.now() / 1000)) },
      });
      await vi.waitFor(async () => {
        const [row] = await missionRows(ctx.roomId, battleId);
        expect(row.settledAt).not.toBeNull();
        expect(row.taskResult).toBe(2);
        expect(row.rewardStartedAt).not.toBeNull();
      });

      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 3,
        rewardSettle: { status: 1 },
      });
      await vi.waitFor(async () => {
        const [row] = await missionRows(ctx.roomId, battleId);
        expect(row.rewardEndedAt).not.toBeNull();
      });

      // 行は増えず、常に1行を更新している。
      expect(await missionRows(ctx.roomId, battleId)).toHaveLength(1);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("taskResult=0(中間settle)は確定させず、後続の本settleが同じ行へ着く", async () => {
    const ctx = await setupRoom("interim-settle");
    try {
      const battleId = "7500000000000000008";
      ctx.conn.fire("linkMicBattleTask", taskStartPayload(battleId));
      await vi.waitFor(async () => {
        expect(await missionRows(ctx.roomId, battleId)).toHaveLength(1);
      });

      // 進捗到達直後に飛ぶ中間settle。rewardStartTimestamp は "0" で届く。
      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 2,
        taskSettle: { taskResult: 0, rewardStartTimestamp: "0" },
      });
      await new Promise((r) => setTimeout(r, 300));
      const [interim] = await missionRows(ctx.roomId, battleId);
      expect(interim.settledAt).toBeNull();
      expect(interim.taskResult).toBeNull();

      // 本settle(達成)。中間settleで確定していないので同じ行へ着く。
      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 2,
        taskSettle: { taskResult: 2, rewardStartTimestamp: String(Math.floor(Date.now() / 1000)) },
      });
      await vi.waitFor(async () => {
        const [row] = await missionRows(ctx.roomId, battleId);
        expect(row.settledAt).not.toBeNull();
        expect(row.taskResult).toBe(2);
        expect(row.rewardStartedAt).not.toBeNull();
      });
      expect(await missionRows(ctx.roomId, battleId)).toHaveLength(1);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("taskStartを取りこぼした状態のtaskSettle / rewardSettleは行を作らない", async () => {
    const ctx = await setupRoom("orphan-settle");
    try {
      const battleId = "7500000000000000002";
      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 2,
        taskSettle: { taskResult: 2 },
      });
      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 3,
        rewardSettle: { status: 1 },
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(await missionRows(ctx.roomId, battleId)).toHaveLength(0);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("taskUpdate(高頻度の進捗)は保存しない", async () => {
    const ctx = await setupRoom("task-update");
    try {
      const battleId = "7500000000000000003";
      ctx.conn.fire("linkMicBattleTask", taskStartPayload(battleId));
      await vi.waitFor(async () => {
        expect(await missionRows(ctx.roomId, battleId)).toHaveLength(1);
      });

      for (let i = 0; i < 5; i += 1) {
        ctx.conn.fire("linkMicBattleTask", {
          battleId,
          battleTaskMessageType: 1,
          taskUpdate: { taskProgress: String(i), fromUserUid: "111" },
        });
      }
      await new Promise((r) => setTimeout(r, 300));
      expect(await missionRows(ctx.roomId, battleId)).toHaveLength(1);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("条件(targetType/progressTarget/rewardMultiple)が欠けたtaskStartは保存しない", async () => {
    const ctx = await setupRoom("incomplete-start");
    try {
      const battleId = "7500000000000000004";
      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 0,
        taskStart: { battleBonusConfig: { taskPeriodConfig: { targetType: 1 } } },
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(await missionRows(ctx.roomId, battleId)).toHaveLength(0);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("未確定行が2つ重なった場合、settleは古い方から順(FIFO)に対応づく", async () => {
    const ctx = await setupRoom("fifo");
    try {
      const battleId = "7500000000000000006";
      ctx.conn.fire("linkMicBattleTask", taskStartPayload(battleId));
      await vi.waitFor(async () => {
        expect(await missionRows(ctx.roomId, battleId)).toHaveLength(1);
      });
      // 2つ目の区間が、1つ目のsettleより先に始まってしまった状態。
      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 0,
        taskStart: {
          battleBonusConfig: {
            taskPeriodConfig: { targetType: 2, progressTarget: "500", duration: "30" },
            rewardPeriodConfig: { rewardMultiple: 2, duration: "30" },
          },
        },
      });
      await vi.waitFor(async () => {
        expect(await missionRows(ctx.roomId, battleId)).toHaveLength(2);
      });

      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 2,
        taskSettle: { taskResult: 2 },
      });
      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 2,
        taskSettle: { taskResult: 1 },
      });

      await vi.waitFor(async () => {
        const rows = (await missionRows(ctx.roomId, battleId)).sort(
          (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
        );
        expect(rows.map((r) => r.taskResult)).toEqual([2, 1]);
      });
      // 先に始まった区間(targetType=1)に先着のsettle結果が入っている。
      const rows = (await missionRows(ctx.roomId, battleId)).sort(
        (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
      );
      expect(rows[0].targetType).toBe(1);
      expect(rows[1].targetType).toBe(2);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("rewardSettleがtaskSettleより先に届いた場合は捨てる(rewardEndedAtはnullのまま)", async () => {
    const ctx = await setupRoom("reordered-reward");
    try {
      const battleId = "7500000000000000007";
      ctx.conn.fire("linkMicBattleTask", taskStartPayload(battleId));
      await vi.waitFor(async () => {
        expect(await missionRows(ctx.roomId, battleId)).toHaveLength(1);
      });

      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 3,
        rewardSettle: { status: 1 },
      });
      ctx.conn.fire("linkMicBattleTask", {
        battleId,
        battleTaskMessageType: 2,
        taskSettle: { taskResult: 2 },
      });

      await vi.waitFor(async () => {
        const [row] = await missionRows(ctx.roomId, battleId);
        expect(row.settledAt).not.toBeNull();
      });
      const [row] = await missionRows(ctx.roomId, battleId);
      expect(row.taskResult).toBe(2);
      expect(row.rewardEndedAt).toBeNull();
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("ボーナスミッションの書込みが失敗しても後続イベントの処理は止まらない", async () => {
    const ctx = await setupRoom("write-fail");
    try {
      const battleId = "7500000000000000005";
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const spy = vi
        .spyOn(prisma.tiktokBattleBonusMission, "create")
        .mockRejectedValueOnce(new Error("simulated write failure"));

      ctx.conn.fire("linkMicBattleTask", taskStartPayload(battleId));
      await vi.waitFor(() => {
        expect(
          errorSpy.mock.calls.some((args) =>
            String(args[0]).includes("battle bonus mission save error")
          )
        ).toBe(true);
      });
      // キュー自体のrejection(=後続の書込みが失われる状態)は起きていない。
      expect(
        errorSpy.mock.calls.some((args) => String(args[0]).includes("queued write failed"))
      ).toBe(false);

      spy.mockRestore();
      ctx.conn.fire("linkMicBattleTask", taskStartPayload(battleId));
      await vi.waitFor(async () => {
        expect(await missionRows(ctx.roomId, battleId)).toHaveLength(1);
      });
      errorSpy.mockRestore();
    } finally {
      await teardownRoom(ctx);
    }
  });
});

describe("ギフトの倍率刻印(Gift.multiplierType / multiplierValue)の収集", () => {
  function giftPayload(overrides: Record<string, unknown> = {}) {
    return {
      uniqueId: `listener_${suffix()}`,
      nickname: "テスト視聴者",
      giftId: 5655,
      giftName: "Rose",
      giftType: 2,
      diamondCount: 100,
      repeatCount: 1,
      repeatEnd: true,
      createTime: String(Date.now()),
      msgId: `msg_${suffix()}`,
      ...overrides,
    };
  }

  async function giftRow(roomId: string, uniqueId: string) {
    return prisma.gift.findFirst({ where: { roomId, uniqueId } });
  }

  it("ネストしたmatchInfoの倍率がGift行へ保存される", async () => {
    const ctx = await setupRoom("gift-matchinfo");
    try {
      const payload = giftPayload({ matchInfo: { multiplierType: 1, multiplierValue: "5" } });
      ctx.conn.fire("gift", payload);
      await vi.waitFor(async () => {
        const row = await giftRow(ctx.roomId, String(payload.uniqueId));
        expect(row?.multiplierType).toBe(1);
        expect(row?.multiplierValue).toBe(5);
      });
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("matchInfoが無くフラットな倍率フィールドだけでも保存される(平坦化された場合の保険)", async () => {
    const ctx = await setupRoom("gift-flat");
    try {
      const payload = giftPayload({ multiplierType: 2, multiplierValue: "10" });
      ctx.conn.fire("gift", payload);
      await vi.waitFor(async () => {
        const row = await giftRow(ctx.roomId, String(payload.uniqueId));
        expect(row?.multiplierType).toBe(2);
        expect(row?.multiplierValue).toBe(10);
      });
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("multiplierType=0(倍率なし)は0として保存し、未観測のnullと区別できる", async () => {
    const ctx = await setupRoom("gift-zero");
    try {
      const withZero = giftPayload({ matchInfo: { multiplierType: 0, multiplierValue: 0 } });
      ctx.conn.fire("gift", withZero);
      await vi.waitFor(async () => {
        const row = await giftRow(ctx.roomId, String(withZero.uniqueId));
        expect(row?.multiplierType).toBe(0);
        expect(row?.multiplierValue).toBe(0);
      });

      const withoutMatchInfo = giftPayload();
      ctx.conn.fire("gift", withoutMatchInfo);
      await vi.waitFor(async () => {
        const row = await giftRow(ctx.roomId, String(withoutMatchInfo.uniqueId));
        expect(row).not.toBeNull();
        expect(row?.multiplierType).toBeNull();
        expect(row?.multiplierValue).toBeNull();
      });
    } finally {
      await teardownRoom(ctx);
    }
  });
});
