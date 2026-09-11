// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// バトルアイテム使用ログ(TiktokBattleItemUse)の保存・二重計上防止(msgIdベースのdedup)を検証する。
// dedup戦略はGiftのmsgId dedupと同型(tiktok-listener.gift-dedup.integration.test.ts参照)。
//   1. listenerインスタンス内のFIFO(recentBattleItemMsgIds) — 同一プロセスへの再送を落とす
//   2. saveBattleItemUse()のDB照会(直近5分window) — 別プロセスが既に書いた行を見つける
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import type { WebcastLinkMicBattleItemCard } from "TLC-sidestage";
import { prisma } from "./prisma";
import { startListener, stopListener, saveGift, saveBattleItemUse } from "./tiktok-listener";
import { resolveRoomForStreamer } from "./tiktok-room";
import { makeTiktokUid } from "./__fixtures__/gift";

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
    check: vi.fn().mockResolvedValue({ verdict: "UNVERIFIED", nickname: null, principalId: null }),
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
  return `76766394758792${String(10000 + seq).slice(-5)}`;
}

async function setupRoom(label: string) {
  const tiktokHandle = `itest_bidedup_${label}_${suffix()}`;
  const user = await prisma.principal.create({
    data: { email: `itest-bidedup-${label}-${suffix()}@local.test` },
  });
  const streamer = await prisma.streamer.create({
    data: {
      principalId: user.id,
      // TiktokRoom.hostTiktokUid は @unique。ハンドルから導けば room ごとに必ず別値になる。
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
  await prisma.principal.delete({ where: { id: ctx.principalId } }).catch(() => {});
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
      // **生 proto のフィールド名のまま。** targetHostUserId / userId / uniqueId は
      // TikTok 側の名前で、sidestage の識別子統一(tiktokUid / tiktokHandle)の対象外。
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

// non-combo Gift側のテストと同じフィクスチャ形(Different kindテストで使う)。
function nonComboGift(msgId: string | null, createTime: number) {
  return {
    userId: makeTiktokUid("user_dk"),
    uniqueId: "user_dk",
    nickname: "種別分離テスト",
    giftType: 0,
    giftId: 5655,
    giftName: "Heart Me",
    repeatCount: 1,
    diamondCount: 1,
    createTime,
    ...(msgId === null ? {} : { msgId }),
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

async function giftCount(roomId: string) {
  return prisma.gift.count({ where: { roomId } });
}

beforeEach(() => {
  MockConnection.instances.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("バトルアイテム使用ログの保存とmsgId dedup", () => {
  it("cardType=2(glove)のsender/targetHostTiktokUidが正しく保存される", async () => {
    const ctx = await setupRoom("save");
    try {
      const msgId = newMsgId();
      ctx.conn.fire("linkMicBattleItemCard", gloveCardPayload(msgId, Date.now()));

      await vi.waitFor(async () => {
        expect(await battleItemUseCount(ctx.roomId)).toBe(1);
      });
      const row = await prisma.tiktokBattleItemUse.findFirstOrThrow({ where: { roomId: ctx.roomId } });
      expect(row.cardType).toBe(2);
      expect(row.senderTiktokUid).toBe("6900000000000000002");
      expect(row.senderProfilePictureUrl).toBe("https://example.test/100x100.webp");
      // 表示名は行ではなく TikTokUser 側へ書かれる(item-use と同一トランザクション)。
      const senderUser = await prisma.tikTokUser.findUnique({ where: { tiktokUid: row.senderTiktokUid } });
      expect(senderUser?.tiktokHandle).toBe("item_sender");
      expect(senderUser?.nickname).toBe("アイテム送信者");
      expect(row.targetHostTiktokUid).toBe("6800000000000000001");
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
      await startListener(ctx.roomId, ctx.tiktokHandle, [ctx.streamerId]);
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

  it("時刻窓(5分)より古い同一msgIdは弾かない — 将来の再利用でデータを落とさないため", async () => {
    const ctx = await setupRoom("window");
    try {
      const msgId = newMsgId();
      const base = Date.now();

      ctx.conn.fire("linkMicBattleItemCard", gloveCardPayload(msgId, base));
      await vi.waitFor(async () => {
        expect(await battleItemUseCount(ctx.roomId)).toBe(1);
      });

      await stopListener(ctx.roomId);
      await startListener(ctx.roomId, ctx.tiktokHandle, [ctx.streamerId]);
      const fresh = MockConnection.instances[MockConnection.instances.length - 1];

      // 10分後の同一msgId。窓の外なので正当なイベントとして保存される。
      fresh.fire("linkMicBattleItemCard", gloveCardPayload(msgId, base + 10 * 60_000));
      await vi.waitFor(async () => {
        expect(await battleItemUseCount(ctx.roomId)).toBe(2);
      });
    } finally {
      await teardownRoom(ctx);
    }
  });

  // Codex TestCase-review指摘(2026-09-11)により追加。TC-TED-003(Gift側)と同型の境界値検証。
  it("[境界] ちょうど5分前の同一msgIdは重複、5分+1msなら新規として保存される", async () => {
    const ctx = await setupRoom("boundary");
    try {
      const msgId = newMsgId();
      const base = Date.now();
      const message = gloveCardPayload(msgId, base) as unknown as WebcastLinkMicBattleItemCard;

      const first = await saveBattleItemUse(ctx.roomId, message, new Date(base));
      expect(first).toBe("saved");

      const atBoundary = await saveBattleItemUse(ctx.roomId, message, new Date(base + 5 * 60_000));
      expect(atBoundary).toBe("duplicate");
      expect(await battleItemUseCount(ctx.roomId)).toBe(1);

      const pastBoundary = await saveBattleItemUse(ctx.roomId, message, new Date(base + 5 * 60_000 + 1));
      expect(pastBoundary).toBe("saved");
      expect(await battleItemUseCount(ctx.roomId)).toBe(2);
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

      a.conn.fire("linkMicBattleItemCard", gloveCardPayload(msgId, createTime));
      b.conn.fire("linkMicBattleItemCard", gloveCardPayload(msgId, createTime));

      await vi.waitFor(async () => {
        expect(await battleItemUseCount(a.roomId)).toBe(1);
        expect(await battleItemUseCount(b.roomId)).toBe(1);
      });
    } finally {
      await teardownRoom(a);
      await teardownRoom(b);
    }
  });

  // Codex design-review指摘(2026-09-11)により追加。listener経由の「同一tick」テストは
  // インスタンス内FIFOが先に1件を落とすため、advisory lock自体の効果を検証できない。
  // saveBattleItemUse()を直接Promise.allで真に同時実行し、DBレベルのraceを検証する。
  it("[Concurrent duplicate] 同一msgIdへのsaveBattleItemUse()同時呼び出しはDB行1件・saved/duplicateが1件ずつ", async () => {
    const ctx = await setupRoom("concurrent");
    try {
      const msgId = newMsgId();
      const createTime = Date.now();
      const message = gloveCardPayload(msgId, createTime) as unknown as WebcastLinkMicBattleItemCard;

      const [r1, r2] = await Promise.all([
        saveBattleItemUse(ctx.roomId, message, new Date(createTime)),
        saveBattleItemUse(ctx.roomId, message, new Date(createTime)),
      ]);

      expect(await battleItemUseCount(ctx.roomId)).toBe(1);
      const results = [r1, r2].sort();
      expect(results).toEqual(["duplicate", "saved"]);
    } finally {
      await teardownRoom(ctx);
    }
  });

  // Business insert failure: tx.tiktokBattleItemUse.create を1回だけ失敗させても、
  // lockはtx rollbackとともに解放され、同一msgIdでの再試行が正しく通ることを確認する。
  it("[Business insert failure] create失敗後の同一msgId再試行は正常に保存される", async () => {
    const ctx = await setupRoom("insert-failure");
    try {
      const msgId = newMsgId();
      const createTime = Date.now();
      const message = gloveCardPayload(msgId, createTime) as unknown as WebcastLinkMicBattleItemCard;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const realTransaction = prisma.$transaction.bind(prisma);
      const writeSpy = vi
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce(((arg: unknown, opts: unknown) => {
          const run = arg as (tx: unknown) => unknown;
          return (realTransaction as (a: unknown, o: unknown) => unknown)(
            (tx: Record<string, unknown>) =>
              run(
                new Proxy(tx, {
                  get(target, prop) {
                    if (prop === "tiktokBattleItemUse") {
                      return {
                        ...(target[prop as string] as object),
                        create: () => Promise.reject(new Error("simulated battle item insert failure")),
                      };
                    }
                    return target[prop as string];
                  },
                })
              ),
            opts
          );
        }) as never);

      const first = await saveBattleItemUse(ctx.roomId, message, new Date(createTime));
      expect(first).toBe("error");
      expect(await battleItemUseCount(ctx.roomId)).toBe(0);
      writeSpy.mockRestore();

      const second = await saveBattleItemUse(ctx.roomId, message, new Date(createTime));
      expect(second).toBe("saved");
      expect(await battleItemUseCount(ctx.roomId)).toBe(1);

      errorSpy.mockRestore();
    } finally {
      await teardownRoom(ctx);
    }
  });

  // Different kind: 同一(roomId, msgId)をGiftとBattleItemへ同時投入しても、lock keyが
  // "gift:"/"battle_item:" prefixで異なるため互いにブロックされず、両方とも独立して保存される。
  it("[Different kind] 同一(roomId, msgId)のGiftとBattleItemは互いにブロックせず独立して保存される", async () => {
    const ctx = await setupRoom("different-kind");
    try {
      const msgId = newMsgId();
      const createTime = Date.now();
      const giftData = nonComboGift(msgId, createTime);
      const battleMessage = gloveCardPayload(msgId, createTime) as unknown as WebcastLinkMicBattleItemCard;

      const [giftResult, battleResult] = await Promise.all([
        saveGift(ctx.roomId, giftData, 1, new Date(createTime), "tiktok"),
        saveBattleItemUse(ctx.roomId, battleMessage, new Date(createTime)),
      ]);

      expect(giftResult).toBe("saved");
      expect(battleResult).toBe("saved");
      expect(await giftCount(ctx.roomId)).toBe(1);
      expect(await battleItemUseCount(ctx.roomId)).toBe(1);
    } finally {
      await teardownRoom(ctx);
    }
  });
});
