// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// persistState()のCASE式が、TikTok非実在Streamer自動削除(tiktok-room-cleanup.ts)用の
// unhealthySince/notFoundStreak/notFoundFirstAtを意図通り扱うかを直接検証する。
//
// 実際の再接続ループ(scheduleReconnect等)は、reconnectTimerが立っている間は同一理由での
// 再スケジュールを抑制する("connecting"を挟まない限り"retrying"は連投されない)ため、
// モック接続経由でこの遷移サイクルを再現するには実タイマー待ちかfake timerの精密な制御が
// 必要になり、テストの複雑さの割に検証内容が同じにならない。persistState()を直接呼ぶことで、
// 「実際にDBへ書かれるのは"retrying"のみで"error"は書かれない」という実装の実挙動を保ったまま、
// CASE式そのものの正しさ(COALESCEでの初回到達時刻保持・"connecting"での非リセット・
// "connected"復帰での全クリア)を確実に検証する。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./prisma";
import { persistState } from "./tiktok-listener";

const roomIds: string[] = [];

function tiktokId(tag: string) {
  return `itestunh${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom() {
  // monitoringSuspended: true は監視対象から外すための隔離。Streamer 0人の部屋も
  // watchedRoomFilter() の監視対象になったため、これが無いと並行して走る listener 系
  // テストの getMyRooms() がこの部屋をグローバルに claim し、listenerStatus /
  // unhealthySince を上書きして検証を壊す。
  const room = await prisma.tiktokRoom.create({
    data: { tiktokId: tiktokId("r"), monitoringSuspended: true },
    select: { id: true },
  });
  roomIds.push(room.id);
  return room;
}

afterAll(async () => {
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("persistState()のunhealthySince/notFoundStreak扱い", () => {
  it('"retrying"遷移でunhealthySinceがセットされる(DBに実際に書かれるのは"retrying"のみ)', async () => {
    const room = await makeRoom();

    await persistState(room.id, "retrying", "再接続待機中...");

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.listenerStatus).toBe("retrying");
    expect(after.unhealthySince).not.toBeNull();
  });

  it('連続する"retrying"遷移でもunhealthySinceは最初の値のまま変わらない(COALESCE確認)', async () => {
    const room = await makeRoom();

    await persistState(room.id, "retrying", "再接続待機中... (1回目)");
    const first = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    const firstUnhealthySince = first.unhealthySince;
    expect(firstUnhealthySince).not.toBeNull();

    await new Promise((r) => setTimeout(r, 20));
    await persistState(room.id, "retrying", "再接続待機中... (2回目)");
    await persistState(room.id, "retrying", "再接続待機中... (3回目)");

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.unhealthySince).toEqual(firstUnhealthySince);
    expect(after.listenerMessage).toBe("再接続待機中... (3回目)");
  });

  it('"connecting"遷移ではunhealthySinceに一切触れない(再接続タイマーの罠を回避)', async () => {
    const room = await makeRoom();

    await persistState(room.id, "retrying", "再接続待機中...");
    const afterRetrying = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(afterRetrying.unhealthySince).not.toBeNull();

    await new Promise((r) => setTimeout(r, 20));
    await persistState(room.id, "connecting", "接続中...");

    const afterConnecting = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(afterConnecting.listenerStatus).toBe("connecting");
    expect(afterConnecting.unhealthySince).toEqual(afterRetrying.unhealthySince);
  });

  it('"connected"復帰でunhealthySince/notFoundStreak/notFoundFirstAtが全てクリアされる', async () => {
    const room = await makeRoom();

    await persistState(room.id, "retrying", "再接続待機中...");
    // notFoundStreak/notFoundFirstAtはtiktok-room-cleanup.ts側が書くフィールドだが、
    // "connected"復帰時に持ち越されないことを確認するため直接セットしておく。
    await prisma.tiktokRoom.update({
      where: { id: room.id },
      data: { notFoundStreak: 2, notFoundFirstAt: new Date() },
    });

    await persistState(room.id, "connected", "接続済み");

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.listenerStatus).toBe("connected");
    expect(after.unhealthySince).toBeNull();
    expect(after.notFoundStreak).toBe(0);
    expect(after.notFoundFirstAt).toBeNull();
  });

  it('"idle"遷移ではunhealthySince等をリセットしない(デプロイのたびに巻き戻るのを防ぐ)', async () => {
    const room = await makeRoom();

    await persistState(room.id, "retrying", "再接続待機中...");
    const afterRetrying = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(afterRetrying.unhealthySince).not.toBeNull();

    await persistState(room.id, "idle", "停止中");

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.listenerStatus).toBe("idle");
    expect(after.unhealthySince).toEqual(afterRetrying.unhealthySince);
  });
});
