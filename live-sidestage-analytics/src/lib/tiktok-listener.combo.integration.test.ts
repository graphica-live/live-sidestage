// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// combo ギフトの delta 計算を検証する。Gift.repeatCount に入るのは累計ではなく
// 「前回からの増分」で、合計が最終連打数になるという不変条件を守るのが目的。
//
// deltaの計算元はプロセスのメモリではなくDBの確定値。デプロイ中の新旧Worker並走で
// 2プロセスが同じイベントから別のdeltaを出す(合計が過大になる)のを防ぐため。
// saveComboGift() を直接叩いて検証する — startListener() は同じroomIdに対して
// 既存インスタンスを返すので、同一プロセスで2つのlistenerを並べることはできない。
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "./prisma";
import { saveComboGift, resolveGroupId, startListener, stopListener } from "./tiktok-listener";

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
  return `76766394758${String(100000 + seq).slice(-6)}`;
}

async function createRoom() {
  return prisma.tiktokRoom.create({
    data: { tiktokId: `itest_combo_${suffix()}` },
  });
}

async function cleanupRoom(roomId: string) {
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {});
}

// giftType=1 のcomboティック。TikTokは「その時点の累計」をrepeatCountで送ってくる。
function comboTick(
  groupId: string,
  repeatCount: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    uniqueId: "user_combo",
    nickname: "コンボ",
    giftType: 1,
    giftId: 5655,
    giftName: "Rose",
    diamondCount: 1,
    groupId,
    repeatCount,
    repeatEnd: false,
    msgId: newMsgId(),
    ...overrides,
  };
}

async function totals(roomId: string) {
  const agg = await prisma.gift.aggregate({
    where: { roomId },
    _sum: { repeatCount: true, totalDiamonds: true },
    _count: true,
  });
  return {
    repeat: agg._sum.repeatCount ?? 0,
    diamonds: agg._sum.totalDiamonds ?? 0,
    rows: agg._count,
  };
}

beforeEach(() => {
  MockConnection.instances.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// giftハンドラ経由。resolveGroupId() → comboWrites → saveComboGift() の配線を通す。
async function withListener(
  fn: (ctx: { roomId: string; conn: InstanceType<typeof MockConnection> }) => Promise<void>
) {
  const room = await createRoom();
  try {
    await startListener(room.id, room.tiktokId, []);
    const conn = MockConnection.instances[MockConnection.instances.length - 1];
    expect(conn).toBeDefined();
    await fn({ roomId: room.id, conn });
  } finally {
    await stopListener(room.id);
    await cleanupRoom(room.id);
  }
}

describe("comboのdelta計算", () => {
  it("累計1→3→5のtickで、増分1+2+2が保存され合計が5になる", async () => {
    const room = await createRoom();
    try {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const now = new Date();
      for (const r of [1, 3, 5]) {
        const result = await saveComboGift(room.id, groupId, comboTick(groupId, r), r, now, "tiktok");
        expect(result).toBe("saved");
      }
      const t = await totals(room.id);
      expect(t.repeat).toBe(5);
      expect(t.rows).toBe(3);
      expect(t.diamonds).toBe(5); // diamondCount=1 × 合計5
      const rows = await prisma.gift.findMany({
        where: { roomId: room.id },
        orderBy: { id: "asc" },
        select: { repeatCount: true },
      });
      expect(rows.map((r) => r.repeatCount)).toEqual([1, 2, 2]);
    } finally {
      await cleanupRoom(room.id);
    }
  });

  it("**並走**: 保存済み合計3の状態で同じ累計5を2プロセスが同時に処理しても合計は5", async () => {
    const room = await createRoom();
    try {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const now = new Date();
      await saveComboGift(room.id, groupId, comboTick(groupId, 1), 1, now, "tiktok");
      await saveComboGift(room.id, groupId, comboTick(groupId, 3), 3, now, "tiktok");
      expect((await totals(room.id)).repeat).toBe(3);

      // 旧Workerと新Workerが同じイベントを同時に受け取った状況。
      // 以前はプロセスごとの「前回値」から引いていたので 5-3=2 と 5-1=4 が同時に入り、
      // msgId dedupは行の重複しか見ないため合計7になりえた。
      const results = await Promise.all([
        saveComboGift(room.id, groupId, comboTick(groupId, 5), 5, now, "tiktok"),
        saveComboGift(room.id, groupId, comboTick(groupId, 5), 5, now, "tiktok"),
      ]);
      expect(results.filter((r) => r === "saved")).toHaveLength(1);
      expect(results.filter((r) => r === "duplicate")).toHaveLength(1);

      const t = await totals(room.id);
      expect(t.repeat).toBe(5);
      expect(t.diamonds).toBe(5);
    } finally {
      await cleanupRoom(room.id);
    }
  });

  it("**並走**: 別々の累計(3と5)が同時に来ても合計は大きい方の5に収束する", async () => {
    const room = await createRoom();
    try {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const now = new Date();
      await Promise.all([
        saveComboGift(room.id, groupId, comboTick(groupId, 3), 3, now, "tiktok"),
        saveComboGift(room.id, groupId, comboTick(groupId, 5), 5, now, "tiktok"),
      ]);
      expect((await totals(room.id)).repeat).toBe(5);
    } finally {
      await cleanupRoom(room.id);
    }
  });

  it("逆順到着(5のあとに3)は無視され、合計は5のまま", async () => {
    const room = await createRoom();
    try {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const now = new Date();
      expect(await saveComboGift(room.id, groupId, comboTick(groupId, 5), 5, now, "tiktok")).toBe("saved");
      expect(await saveComboGift(room.id, groupId, comboTick(groupId, 3), 3, now, "tiktok")).toBe("duplicate");
      const t = await totals(room.id);
      expect(t.repeat).toBe(5);
      expect(t.rows).toBe(1);
    } finally {
      await cleanupRoom(room.id);
    }
  });

  it("同じtickの再送は別msgIdでもdelta=0で弾かれる", async () => {
    const room = await createRoom();
    try {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const now = new Date();
      await saveComboGift(room.id, groupId, comboTick(groupId, 4), 4, now, "tiktok");
      // msgIdは comboTick() が毎回新しい値を作る = msgId dedupは効かない状況。
      expect(await saveComboGift(room.id, groupId, comboTick(groupId, 4), 4, now, "tiktok")).toBe("duplicate");
      expect((await totals(room.id)).repeat).toBe(4);
    } finally {
      await cleanupRoom(room.id);
    }
  });

  it("集計に時間窓が無いので、長時間続くcomboでも過大計上しない", async () => {
    const room = await createRoom();
    try {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const base = Date.now();
      // 1分ごとに累計が1ずつ増えるcomboを20分ぶん。移動SUMだと窓から落ちた古いdeltaを
      // 引けなくなり、合計が累計を追い越す。
      for (let i = 1; i <= 20; i++) {
        await saveComboGift(
          room.id,
          groupId,
          comboTick(groupId, i),
          i,
          new Date(base + i * 60_000),
          "tiktok"
        );
      }
      expect((await totals(room.id)).repeat).toBe(20);
    } finally {
      await cleanupRoom(room.id);
    }
  });

  it("JSTの日付境界をまたいでも合算される(dayKeyで区切らない)", async () => {
    const room = await createRoom();
    try {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      // JST 2026-08-22 23:59:50 と翌 00:00:10。UTCだと 14:59:50 / 15:00:10。
      const before = new Date("2026-08-22T14:59:50.000Z");
      const after = new Date("2026-08-22T15:00:10.000Z");
      await saveComboGift(room.id, groupId, comboTick(groupId, 2), 2, before, "tiktok");
      await saveComboGift(room.id, groupId, comboTick(groupId, 5), 5, after, "tiktok");

      const rows = await prisma.gift.findMany({
        where: { roomId: room.id },
        orderBy: { receivedAt: "asc" },
        select: { repeatCount: true, dayKey: true },
      });
      // dayKeyは行ごとに正しく分かれるが、deltaの計算には使わない。
      expect(rows.map((r) => r.dayKey)).toEqual(["2026-08-22", "2026-08-23"]);
      expect(rows.map((r) => r.repeatCount)).toEqual([2, 3]);
      expect((await totals(room.id)).repeat).toBe(5);
    } finally {
      await cleanupRoom(room.id);
    }
  });

  it("comboの各段が同じorderIdを持っていてもunique制約で落ちない(orderIdはnullで保存する)", async () => {
    const room = await createRoom();
    try {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const orderId = `order_${suffix()}`;
      const now = new Date();
      for (const r of [1, 2, 3]) {
        const result = await saveComboGift(
          room.id,
          groupId,
          comboTick(groupId, r, { orderId }),
          r,
          now,
          "tiktok"
        );
        expect(result).toBe("saved");
      }
      const rows = await prisma.gift.findMany({
        where: { roomId: room.id },
        select: { orderId: true },
      });
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.orderId === null)).toBe(true);
      expect((await totals(room.id)).repeat).toBe(3);
    } finally {
      await cleanupRoom(room.id);
    }
  });

  it("別グループのcomboは互いのdeltaに影響しない", async () => {
    const room = await createRoom();
    try {
      const a = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const b = `1788${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const now = new Date();
      await saveComboGift(room.id, a, comboTick(a, 3), 3, now, "tiktok");
      await saveComboGift(room.id, b, comboTick(b, 2), 2, now, "tiktok");
      await saveComboGift(room.id, a, comboTick(a, 4), 4, now, "tiktok");

      const sumOf = async (g: string) =>
        (
          await prisma.gift.aggregate({
            where: { roomId: room.id, groupId: g },
            _sum: { repeatCount: true },
          })
        )._sum.repeatCount ?? 0;
      expect(await sumOf(a)).toBe(4);
      expect(await sumOf(b)).toBe(2);
    } finally {
      await cleanupRoom(room.id);
    }
  });

  it("同じgroupIdでも部屋が違えば別のcomboとして数える", async () => {
    const roomA = await createRoom();
    const roomB = await createRoom();
    try {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const now = new Date();
      await saveComboGift(roomA.id, groupId, comboTick(groupId, 3), 3, now, "tiktok");
      await saveComboGift(roomB.id, groupId, comboTick(groupId, 3), 3, now, "tiktok");
      expect((await totals(roomA.id)).repeat).toBe(3);
      expect((await totals(roomB.id)).repeat).toBe(3);
    } finally {
      await cleanupRoom(roomA.id);
      await cleanupRoom(roomB.id);
    }
  });

  it("存在しない部屋への保存は例外を投げずerrorを返す", async () => {
    const result = await saveComboGift(
      "00000000-0000-0000-0000-000000000000",
      "1787356661600",
      comboTick("1787356661600", 1),
      1,
      new Date(),
      "tiktok"
    );
    expect(result).toBe("error");
  });
});

describe("resolveGroupId", () => {
  it("protobufの既定値'0'をnullに倒す(全ユーザーが同じcomboキーを共有するのを防ぐ)", () => {
    expect(resolveGroupId({ groupId: "0" })).toBeNull();
    expect(resolveGroupId({ groupId: 0 })).toBeNull();
  });

  it("実IDはそのまま返す。数値で届いても文字列にする", () => {
    expect(resolveGroupId({ groupId: "1787356661600" })).toBe("1787356661600");
    expect(resolveGroupId({ groupId: 1787356661600 })).toBe("1787356661600");
  });

  it("欠落・空文字・非数値はnull", () => {
    expect(resolveGroupId({})).toBeNull();
    expect(resolveGroupId({ groupId: null })).toBeNull();
    expect(resolveGroupId({ groupId: "" })).toBeNull();
    expect(resolveGroupId({ groupId: "abc" })).toBeNull();
    expect(resolveGroupId({ groupId: "-1" })).toBeNull();
  });
});

describe("giftハンドラ経由のcombo", () => {
  it("実groupIdのcomboはDB経路を通り、合計が最終累計に一致する", async () => {
    await withListener(async ({ roomId, conn }) => {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const createTime = Date.now();
      for (const [r, end] of [[1, false], [3, false], [5, true]] as const) {
        conn.fire("gift", { ...comboTick(groupId, r, { repeatEnd: end }), createTime });
      }
      await vi.waitFor(async () => {
        expect((await totals(roomId)).rows).toBe(3);
      });
      const t = await totals(roomId);
      expect(t.repeat).toBe(5);
    });
  });

  it("groupId='0'のcomboはフォールバック経路へ落ち、合計は最終累計のまま", async () => {
    await withListener(async ({ roomId, conn }) => {
      const createTime = Date.now();
      // protobufの既定値。resolveGroupId()がnullに倒すので `uniqueId:giftId` キーで追う。
      for (const [r, end] of [[1, false], [3, false], [5, true]] as const) {
        conn.fire("gift", { ...comboTick("0", r, { repeatEnd: end }), createTime });
      }
      await vi.waitFor(async () => {
        expect((await totals(roomId)).repeat).toBe(5);
      });
      const rows = await prisma.gift.findMany({
        where: { roomId },
        select: { groupId: true },
      });
      // "0" はdedup/comboキーとして使えないのでnullで保存される。
      expect(rows.every((r) => r.groupId === null)).toBe(true);
    });
  });

  it("実groupIdのcomboはmsgId FIFOを通らない — 同じmsgIdでも累計が増えていれば保存する", async () => {
    await withListener(async ({ roomId, conn }) => {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const createTime = Date.now();
      const msgId = newMsgId();
      // 同一msgIdの2tick。FIFOを通していたら2件目が落ちて合計3のままになる。
      conn.fire("gift", { ...comboTick(groupId, 3, { msgId }), createTime });
      await vi.waitFor(async () => {
        expect((await totals(roomId)).repeat).toBe(3);
      });
      conn.fire("gift", { ...comboTick(groupId, 5, { msgId, repeatEnd: true }), createTime });
      await vi.waitFor(async () => {
        expect((await totals(roomId)).repeat).toBe(5);
      });
    });
  });

  it("同じ累計のtickが2回届いても1行しか増えない", async () => {
    await withListener(async ({ roomId, conn }) => {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const createTime = Date.now();
      conn.fire("gift", { ...comboTick(groupId, 2), createTime });
      conn.fire("gift", { ...comboTick(groupId, 2), createTime });
      await vi.waitFor(async () => {
        expect((await totals(roomId)).repeat).toBe(2);
      });
      await new Promise((r) => setTimeout(r, 300));
      const t = await totals(roomId);
      expect(t.rows).toBe(1);
      expect(t.repeat).toBe(2);
    });
  });
});

describe("並列書き込みの負荷", () => {
  it("同一グループへ多数のtickを同時に流しても合計は最終累計に一致する", async () => {
    const room = await createRoom();
    try {
      const groupId = `1787${suffix().replace(/\D/g, "").slice(0, 9)}`;
      const now = new Date();
      const ticks = Array.from({ length: 30 }, (_, i) => i + 1);
      // 順不同で同時に投げる。advisory lockで直列化されるので、
      // どの順で処理されても合計は max(累計) に収束する。
      await Promise.all(
        [...ticks].sort(() => Math.random() - 0.5).map((r) =>
          saveComboGift(room.id, groupId, comboTick(groupId, r), r, now, "tiktok")
        )
      );
      expect((await totals(room.id)).repeat).toBe(30);

      // 無関係なクエリがプール枯渇で落ちていないこと。
      await expect(prisma.tiktokRoom.count()).resolves.toBeGreaterThan(0);
    } finally {
      await cleanupRoom(room.id);
    }
  }, 30_000);
});
