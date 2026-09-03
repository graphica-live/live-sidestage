// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// persistState() の fencing を直接検証する。
//
// なぜ要るか:
//  - persistState は await されずに呼ばれるので、**同一プロセス内でも着弾順が入れ替わる**。
//    30秒 heartbeat の "connected" が、後から発行された "retrying" より遅れて着くと、
//    無条件UPDATEでは古い "connected" が勝ってしまう
//  - デプロイ中は新旧Workerが同じ部屋へ並走する。旧Workerのシャットダウンが書く "idle" が
//    新Workerの "connected" の後に届きうる。壁時計はコンテナ間で単調ではないので
//    listenerUpdatedAt では判定できない
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { persistState, __resetListenerEpochForTest } from "./tiktok-listener";
import { FACTS_CONNECTED, FACTS_IDLE, factsForReconnect } from "./listener-state";

const roomIds: string[] = [];

async function makeRoom() {
  // monitoringSuspended: true は監視対象から外すための隔離。Streamer 0人の部屋も
  // watchedRoomFilter() の監視対象になったため、これが無いと並行して走る listener 系
  // テストの getMyRooms() がこの部屋をグローバルに claim し、listenerStatus /
  // listenerRevision を上書きして fencing の検証を壊す。
  const room = await prisma.tiktokRoom.create({
    data: {
      tiktokId: `itestfence${Math.random().toString(36).slice(2, 10)}`.toLowerCase(),
      monitoringSuspended: true,
    },
    select: { id: true },
  });
  roomIds.push(room.id);
  return room;
}

function readRoom(id: string) {
  return prisma.tiktokRoom.findUniqueOrThrow({ where: { id } });
}

beforeEach(() => {
  // 各テストで世代を固定する。実際の採番(ListenerEpoch の insert)はここでは検証しない。
  __resetListenerEpochForTest(1n);
});

afterAll(async () => {
  __resetListenerEpochForTest(null);
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("persistState() の fencing", () => {
  it("新しいrevisionの書き込みは通る", async () => {
    const room = await makeRoom();

    await persistState(room.id, "connected", FACTS_CONNECTED.message, FACTS_CONNECTED, null, 10n);
    await persistState(room.id, "retrying", "待機中", factsForReconnect("user_offline"), "user_offline", 11n);

    const after = await readRoom(room.id);
    expect(after.listenerStatus).toBe("retrying");
    expect(after.listenerActivity).toBe("offline");
    expect(after.listenerRevision).toBe(11n);
  });

  // 同一プロセス内の着弾順入れ替わり。
  it("古いrevisionの書き込みは棄却される", async () => {
    const room = await makeRoom();

    await persistState(room.id, "retrying", "待機中", factsForReconnect("user_offline"), "user_offline", 20n);
    // 遅れて届いた古い heartbeat。
    await persistState(room.id, "connected", FACTS_CONNECTED.message, FACTS_CONNECTED, null, 19n);

    const after = await readRoom(room.id);
    expect(after.listenerStatus).toBe("retrying");
    expect(after.listenerActivity).toBe("offline");
    expect(after.listenerRevision).toBe(20n);
  });

  it("同じrevisionの再送も棄却される", async () => {
    const room = await makeRoom();

    await persistState(room.id, "connected", FACTS_CONNECTED.message, FACTS_CONNECTED, null, 30n);
    await persistState(room.id, "idle", FACTS_IDLE.message, FACTS_IDLE, null, 30n);

    const after = await readRoom(room.id);
    expect(after.listenerStatus).toBe("connected");
  });

  // デプロイ中の新旧Worker並走。世代番号(epoch)が大きい方が新しいプロセス。
  it("旧世代Workerのidleは新世代のconnectedを潰さない", async () => {
    const room = await makeRoom();

    const oldEpoch = 5n * 1_000_000n;
    const newEpoch = 6n * 1_000_000n;

    // 新Workerが接続を確立。
    await persistState(room.id, "connected", FACTS_CONNECTED.message, FACTS_CONNECTED, null, newEpoch + 1n);
    // 旧Workerのグレースフルシャットダウンが遅れて届く。
    await persistState(room.id, "idle", FACTS_IDLE.message, FACTS_IDLE, null, oldEpoch + 999n);

    const after = await readRoom(room.id);
    expect(after.listenerStatus).toBe("connected");
    expect(after.listenerActivity).toBe("live");
  });

  it("activity/health/reason を書き、listenerStatus の意味は変えない", async () => {
    const room = await makeRoom();

    const facts = factsForReconnect("rate_limited", 600_000);
    await persistState(room.id, "retrying", facts.message, facts, "rate_limited", 40n);

    const after = await readRoom(room.id);
    // tiktok-room-cleanup.ts が依存している値はそのまま。
    expect(after.listenerStatus).toBe("retrying");
    expect(after.unhealthySince).not.toBeNull();
    // 表示用の2軸は分かれている。
    expect(after.listenerActivity).toBe("unknown");
    expect(after.listenerHealth).toBe("error");
    expect(after.listenerReason).toBe("rate_limited");
    expect(after.listenerMessage).toContain("配信認証の混雑");
  });
});
