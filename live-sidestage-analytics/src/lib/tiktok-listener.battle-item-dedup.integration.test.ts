// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// バトルアイテム使用ログ(TiktokBattleItemUse)の保存・二重計上防止(msgIdベースのdedup)を検証する。
// dedup戦略はGiftのmsgId dedupと同型(tiktok-listener.gift-dedup.integration.test.ts参照)。
//   1. listenerインスタンス内のFIFO(recentBattleItemMsgIds) — 同一プロセスへの再送を落とす
//   2. saveBattleItemUse()のDB照会(直近5分window) — 別プロセスが既に書いた行を見つける
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

vi.mock("tiktok-live-connector", async () => {
  const actual = await vi.importActual<typeof import("tiktok-live-connector")>("tiktok-live-connector");
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

// msgIdはprotobufのint64相当。resolveMsgId()が"0"や非数値を弾くので、実IDらしい値を使う。
function newMsgId() {
  seq += 1;
  return `76766394758792${String(10000 + seq).slice(-5)}`;
}

async function setupRoom(label: string) {
  const tiktokId = `itest_bidedup_${label}_${suffix()}`;
  const user = await prisma.user.create({
    data: { email: `itest-bidedup-${label}-${suffix()}@local.test` },
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

// legacy client経由で届く形(simplifyObjectでcommonがトップレベル展開済み)を模す。
// gloveCard/comment/senderEnvelope等のネストはconnector側で一切変換されないので生protoの
// キャメルケース形状のまま。
function gloveCardPayload(msgId: string | null, createTime: number, overrides: Record<string, unknown> = {}) {
  return {
    battleId: "7123456789012345678",
    cardType: 2, // GLOVE
    createTime,
    ...(msgId === null ? {} : { msgId }),
    gloveCard: {
      targetHostUserId: "6800000000000000001",
      comment: {
        commentKey: "pm_mt_boost_send_crit_comment",
        commentTemplate: "{0:user} sent 1 boosting glove",
        senderEnvelope: {
          senderWrapper: {
            sender: {
              userId: "6900000000000000002",
              uniqueId: "item_sender",
              nickname: "アイテム送信者",
              profilePicture: { url: ["https://example.test/100x100.webp"] },
            },
          },
        },
      },
    },
    ...overrides,
  };
}

function powerUpSummaryPayload(createTime: number) {
  return {
    battleId: "7123456789012345678",
    cardType: 4, // POWER_UP_SUMMARY — senderが無い周期通知、保存対象外
    createTime,
    powerupSummaryCard: {},
  };
}

async function battleItemUseCount(roomId: string) {
  return prisma.tiktokBattleItemUse.count({ where: { roomId } });
}

beforeEach(() => {
  MockConnection.instances.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("バトルアイテム使用ログの保存とmsgId dedup", () => {
  it("cardType=2(glove)のsender/targetHostUserIdが正しく保存される", async () => {
    const ctx = await setupRoom("save");
    try {
      const msgId = newMsgId();
      ctx.conn.fire("linkMicBattleItemCard", gloveCardPayload(msgId, Date.now()));

      await vi.waitFor(async () => {
        expect(await battleItemUseCount(ctx.roomId)).toBe(1);
      });
      const row = await prisma.tiktokBattleItemUse.findFirstOrThrow({ where: { roomId: ctx.roomId } });
      expect(row.cardType).toBe(2);
      expect(row.senderUserId).toBe("6900000000000000002");
      expect(row.senderUniqueId).toBe("item_sender");
      expect(row.senderNickname).toBe("アイテム送信者");
      expect(row.senderProfilePictureUrl).toBe("https://example.test/100x100.webp");
      expect(row.targetHostUserId).toBe("6800000000000000001");
      expect(row.battleId).toBe("7123456789012345678");
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("cardType=4(POWER_UP_SUMMARY)は保存されない(senderが無い周期通知)", async () => {
    const ctx = await setupRoom("summary-skip");
    try {
      ctx.conn.fire("linkMicBattleItemCard", powerUpSummaryPayload(Date.now()));
      await new Promise((r) => setTimeout(r, 200));
      expect(await battleItemUseCount(ctx.roomId)).toBe(0);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("同じmsgIdのアイテム使用が同一tickに2回届いても1件だけ保存される", async () => {
    const ctx = await setupRoom("same-tick");
    try {
      const msgId = newMsgId();
      const createTime = Date.now();

      ctx.conn.fire("linkMicBattleItemCard", gloveCardPayload(msgId, createTime));
      ctx.conn.fire("linkMicBattleItemCard", gloveCardPayload(msgId, createTime));

      await vi.waitFor(async () => {
        expect(await battleItemUseCount(ctx.roomId)).toBe(1);
      });
      await new Promise((r) => setTimeout(r, 200));
      expect(await battleItemUseCount(ctx.roomId)).toBe(1);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("プロセスが違っても(=インスタンス内FIFOが空でも)DB照会で弾かれる", async () => {
    const ctx = await setupRoom("cross-process");
    try {
      const msgId = newMsgId();
      const createTime = Date.now();

      ctx.conn.fire("linkMicBattleItemCard", gloveCardPayload(msgId, createTime));
      await vi.waitFor(async () => {
        expect(await battleItemUseCount(ctx.roomId)).toBe(1);
      });

      await stopListener(ctx.roomId);
      await startListener(ctx.roomId, ctx.tiktokId, [ctx.streamerId]);
      const fresh = MockConnection.instances[MockConnection.instances.length - 1];
      expect(fresh).not.toBe(ctx.conn);

      fresh.fire("linkMicBattleItemCard", gloveCardPayload(msgId, createTime));
      await new Promise((r) => setTimeout(r, 300));
      expect(await battleItemUseCount(ctx.roomId)).toBe(1);
    } finally {
      await teardownRoom(ctx);
    }
  });

  it("msgIdが取れないイベントは従来どおり2回とも保存される(dedupキーが無いだけで実際に届いている)", async () => {
    const ctx = await setupRoom("no-msgid");
    try {
      const createTime = Date.now();
      // protobufの既定値"0"はresolveMsgId()がnullに倒す。
      ctx.conn.fire("linkMicBattleItemCard", gloveCardPayload("0", createTime));
      await vi.waitFor(async () => {
        expect(await battleItemUseCount(ctx.roomId)).toBe(1);
      });
      ctx.conn.fire("linkMicBattleItemCard", gloveCardPayload(null, createTime));

      await vi.waitFor(async () => {
        expect(await battleItemUseCount(ctx.roomId)).toBe(2);
      });
      const rows = await prisma.tiktokBattleItemUse.findMany({ where: { roomId: ctx.roomId } });
      expect(rows.every((r) => r.msgId === null)).toBe(true);
    } finally {
      await teardownRoom(ctx);
    }
  });
});
